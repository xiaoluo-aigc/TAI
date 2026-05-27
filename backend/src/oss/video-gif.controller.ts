import {
  BadGatewayException,
  BadRequestException,
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  ServiceUnavailableException,
  Req,
  Logger,
  HttpException,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OssService } from './oss.service';
import { CreditsService } from '../credits/credits.service';
import { ApiResponseStatus } from '../credits/dto/credits.dto';
import { ServiceType } from '../credits/credits.config';
import {
  createAsyncTask,
  getAsyncTaskResult,
  updateAsyncTask,
} from '../ai/services/async-video-task.store';

type ConvertVideoToGifDto = {
  videoUrl: string;
  projectId?: string;
  startSeconds?: number;
  durationSeconds?: number;
  fps?: number;
  width?: number;
};

const MIN_FPS = 2;
const MAX_FPS = 20;
const MIN_WIDTH = 160;
const MAX_WIDTH = 960;

@ApiTags('video-gif')
@Controller('video-gif')
export class VideoGifController {
  private readonly logger = new Logger(VideoGifController.name);

  constructor(
    private readonly oss: OssService,
    private readonly creditsService: CreditsService,
  ) {}

  @Post('convert')
  @ApiOperation({ summary: 'Convert video to GIF using ffmpeg' })
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  async convert(@Body() dto: ConvertVideoToGifDto, @Req() req: any): Promise<{
    success: boolean;
    gifUrl: string;
    gifKey: string;
    duration: number;
    startSeconds: number;
    durationSeconds: number;
    fps: number;
    width: number;
  }> {
    try {
      return await this.runConvertJob(dto, req);
    } catch (err: any) {
      const message = err?.message || 'Video to GIF conversion failed';
      if (message.includes('ffmpeg not installed') || message.includes('ffprobe not installed')) {
        throw new ServiceUnavailableException(message);
      }
      if (err instanceof HttpException) {
        throw err;
      }
      throw new BadGatewayException(message);
    }
  }

  @Post('convert-async')
  @ApiOperation({ summary: 'Create async video-to-GIF task' })
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  async convertAsync(@Body() dto: ConvertVideoToGifDto, @Req() req: any): Promise<{
    success: boolean;
    taskId: string;
    status: 'pending';
    message: string;
  }> {
    const normalized = this.normalizeConvertRequest(dto);
    const userId = this.getUserId(req);
    if (!userId) {
      throw new BadRequestException('需要用户认证');
    }

    await this.creditsService.getOrCreateAccount(userId);
    const idempotencyKey = this.extractIdempotencyKey(req);
    const deductResult = await this.creditsService.preDeductCredits({
      userId,
      serviceType: 'video-to-gif',
      model: 'ffmpeg-gif',
      outputImageCount: 1,
      requestParams: {
        fps: normalized.fps,
        width: normalized.width,
        startSeconds: normalized.startSeconds,
        durationSeconds: normalized.requestedDurationSeconds,
      },
      ipAddress: req?.ip,
      userAgent: req?.headers?.['user-agent'],
      idempotencyKey,
    });

    const taskId = `async-video-gif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createAsyncTask(taskId);
    updateAsyncTask(taskId, {
      result: {
        status: 'queued',
        taskId,
        taskInfo: { stage: 'queued', progress: 0 },
      },
    });

    void this.processAsyncConvertTask(taskId, dto, req, userId, deductResult.apiUsageId).catch((error) => {
      this.logger.error(
        `[Async] Video GIF task ${taskId} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });

    return {
      success: true,
      taskId,
      status: 'pending',
      message: '视频转 GIF 任务已提交，请通过 taskId 轮询查询进度',
    };
  }

  @Get('task/:taskId')
  @ApiOperation({ summary: 'Get async video-to-GIF task status' })
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  async getTaskStatus(@Param('taskId') rawTaskId: string): Promise<any> {
    const taskId = typeof rawTaskId === 'string' ? rawTaskId.trim() : '';
    if (!taskId) {
      throw new BadRequestException('taskId 不能为空');
    }

    const task = getAsyncTaskResult(taskId);
    if (!task) {
      throw new BadRequestException('视频转 GIF 任务不存在或已过期');
    }

    if (task.status === 'failed') {
      return {
        status: 'failed',
        error: task.error || '视频转 GIF 失败',
        stage: task.result?.taskInfo?.stage || 'failed',
        progress: typeof task.result?.taskInfo?.progress === 'number' ? task.result.taskInfo.progress : 100,
      };
    }

    if (task.status === 'completed') {
      return {
        status: 'succeeded',
        gifUrl: task.result?.gifUrl,
        gifKey: task.result?.gifKey,
        duration: task.result?.taskInfo?.duration,
        startSeconds: task.result?.taskInfo?.startSeconds,
        durationSeconds: task.result?.taskInfo?.durationSeconds,
        fps: task.result?.taskInfo?.fps,
        width: task.result?.taskInfo?.width,
        progress: 100,
      };
    }

    return {
      status: task.status === 'processing' ? 'processing' : 'pending',
      stage: task.result?.taskInfo?.stage || 'queued',
      progress: typeof task.result?.taskInfo?.progress === 'number' ? task.result.taskInfo.progress : 0,
    };
  }

  private getUserId(req: any): string | null {
    return req?.user?.id || req?.user?.sub || null;
  }

  private extractIdempotencyKey(req: any): string | undefined {
    const raw = req?.headers?.['idempotency-key'] || req?.headers?.['x-idempotency-key'];
    if (Array.isArray(raw)) {
      const first = raw.find((item) => typeof item === 'string' && item.trim().length > 0);
      return typeof first === 'string' ? first.trim().slice(0, 128) : undefined;
    }
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw.trim().slice(0, 128);
    }
    return undefined;
  }

  private async failAndRefund(
    userId: string,
    apiUsageId: string,
    errorMessage: string,
    processingTime: number,
  ): Promise<void> {
    let failedMarked = false;
    try {
      await this.creditsService.updateApiUsageStatus(
        apiUsageId,
        ApiResponseStatus.FAILED,
        errorMessage,
        processingTime,
      );
      failedMarked = true;
    } catch (statusError) {
      this.logger.error(
        `Failed to mark video-to-gif api usage failed: ${
          statusError instanceof Error ? statusError.message : String(statusError)
        }`,
      );
    }

    if (!failedMarked) {
      try {
        await this.creditsService.markApiUsageFailedForUser(
          userId,
          apiUsageId,
          errorMessage,
          processingTime,
        );
        failedMarked = true;
      } catch (markError) {
        this.logger.error(
          `Failed to mark video-to-gif api usage failed for refund: ${
            markError instanceof Error ? markError.message : String(markError)
          }`,
        );
      }
    }

    if (!failedMarked) {
      this.logger.error(`Skip refund because failed status cannot be set. apiUsageId=${apiUsageId}`);
      return;
    }

    try {
      await this.creditsService.refundCredits(userId, apiUsageId);
    } catch (refundError) {
      this.logger.error(
        `Failed to refund video-to-gif credits: ${
          refundError instanceof Error ? refundError.message : String(refundError)
        }`,
      );
    }
  }

  private buildOutputKey(projectId?: string): string {
    const now = Date.now();
    const rand = Math.random().toString(36).slice(2);
    if (projectId) {
      return `projects/${projectId}/flow/video-gif/${now}-${rand}.gif`;
    }
    return `uploads/flow/video-gif/${now}-${rand}.gif`;
  }

  private parseAndValidateVideoUrl(rawUrl: string): string {
    if (!rawUrl || typeof rawUrl !== 'string') {
      throw new BadRequestException('videoUrl is required');
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      throw new BadRequestException('Invalid videoUrl');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException('Unsupported videoUrl protocol');
    }

    const hostname = parsed.hostname;
    const allowedHosts = this.oss.allowedPublicHosts();
    const isAllowed =
      allowedHosts.includes(hostname) ||
      allowedHosts.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`));

    if (!isAllowed) {
      throw new BadRequestException('videoUrl host not allowed');
    }

    return parsed.toString();
  }

  private clampNumber(
    value: number | undefined,
    min: number,
    max: number,
    fallback: number
  ): number {
    if (!Number.isFinite(value as number)) return fallback;
    return Math.min(max, Math.max(min, Number(value)));
  }

  private normalizeConvertRequest(dto: ConvertVideoToGifDto): {
    videoUrl: string;
    projectId?: string;
    startSeconds: number;
    fps: number;
    width: number;
    requestedDurationSeconds?: number;
  } {
    return {
      videoUrl: this.parseAndValidateVideoUrl(dto.videoUrl),
      projectId: dto.projectId,
      startSeconds: this.clampNumber(dto.startSeconds, 0, 3600, 0),
      fps: Math.round(this.clampNumber(dto.fps, MIN_FPS, MAX_FPS, 10)),
      width: Math.round(this.clampNumber(dto.width, MIN_WIDTH, MAX_WIDTH, 480)),
      requestedDurationSeconds: Number.isFinite(dto.durationSeconds as number)
        ? Number(dto.durationSeconds)
        : undefined,
    };
  }

  private async runConvertJob(
    dto: ConvertVideoToGifDto,
    req: any,
    options?: {
      userId?: string;
      apiUsageId?: string | null;
      onStageChange?: (stage: string, progress: number, extra?: Record<string, any>) => void;
      skipPreDeduct?: boolean;
    },
  ): Promise<{
    success: boolean;
    gifUrl: string;
    gifKey: string;
    duration: number;
    startSeconds: number;
    durationSeconds: number;
    fps: number;
    width: number;
  }> {
    const normalized = this.normalizeConvertRequest(dto);
    const userId = options?.userId ?? this.getUserId(req);
    const serviceType: ServiceType = 'video-to-gif';
    const startTime = Date.now();
    let apiUsageId: string | null = options?.apiUsageId ?? null;
    let tempDir: string | null = null;

    if (!userId) {
      throw new BadRequestException('需要用户认证');
    }

    try {
      if (!options?.skipPreDeduct) {
        await this.creditsService.getOrCreateAccount(userId);
        const deductResult = await this.creditsService.preDeductCredits({
          userId,
          serviceType,
          model: 'ffmpeg-gif',
          outputImageCount: 1,
          requestParams: {
            fps: normalized.fps,
            width: normalized.width,
            startSeconds: normalized.startSeconds,
            durationSeconds: normalized.requestedDurationSeconds,
          },
          ipAddress: req?.ip,
          userAgent: req?.headers?.['user-agent'],
          idempotencyKey: this.extractIdempotencyKey(req),
        });
        apiUsageId = deductResult.apiUsageId;
      }

      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-gif-'));

      options?.onStageChange?.('probing_duration', 15);
      const duration = await this.getVideoDuration(normalized.videoUrl);
      if (!duration || duration <= 0) {
        throw new BadRequestException('Cannot get video duration');
      }

      if (normalized.startSeconds >= duration) {
        throw new BadRequestException('startSeconds must be less than video duration');
      }

      const remainingDuration = Math.max(0.5, duration - normalized.startSeconds);
      const durationSeconds = Number.isFinite(normalized.requestedDurationSeconds as number)
        ? this.clampNumber(normalized.requestedDurationSeconds, 0.5, remainingDuration, remainingDuration)
        : remainingDuration;

      const outputPath = path.join(tempDir, 'output.gif');
      options?.onStageChange?.('converting_gif', 55, {
        duration,
        durationSeconds,
        startSeconds: normalized.startSeconds,
        fps: normalized.fps,
        width: normalized.width,
      });
      await this.convertWithFfmpeg({
        videoUrl: normalized.videoUrl,
        outputPath,
        startSeconds: normalized.startSeconds,
        durationSeconds,
        fps: normalized.fps,
        width: normalized.width,
      });

      options?.onStageChange?.('uploading_gif', 85, {
        duration,
        durationSeconds,
        startSeconds: normalized.startSeconds,
        fps: normalized.fps,
        width: normalized.width,
      });
      const key = this.buildOutputKey(normalized.projectId);
      const buffer = await fs.readFile(outputPath);
      const { Readable } = await import('stream');
      const stream = Readable.from(buffer);

      const { url, key: uploadedKey } = await this.oss.putStream(key, stream, {
        headers: { 'Content-Type': 'image/gif' },
      });

      if (apiUsageId) {
        try {
          await this.creditsService.updateApiUsageStatus(
            apiUsageId,
            ApiResponseStatus.SUCCESS,
            undefined,
            Date.now() - startTime,
          );
        } catch (statusError) {
          this.logger.warn(
            `Failed to mark video-to-gif api usage success: ${
              statusError instanceof Error ? statusError.message : String(statusError)
            }`,
          );
        }
      }

      options?.onStageChange?.('completed', 100, {
        duration,
        durationSeconds,
        startSeconds: normalized.startSeconds,
        fps: normalized.fps,
        width: normalized.width,
        gifUrl: url,
        gifKey: uploadedKey,
      });

      return {
        success: true,
        gifUrl: url,
        gifKey: uploadedKey,
        duration,
        startSeconds: normalized.startSeconds,
        durationSeconds,
        fps: normalized.fps,
        width: normalized.width,
      };
    } catch (err: any) {
      if (apiUsageId) {
        await this.failAndRefund(
          userId,
          apiUsageId,
          err?.message || 'Video to GIF conversion failed',
          Date.now() - startTime,
        );
      }
      throw err;
    } finally {
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  private async processAsyncConvertTask(
    taskId: string,
    dto: ConvertVideoToGifDto,
    req: any,
    userId: string,
    apiUsageId: string,
  ): Promise<void> {
    updateAsyncTask(taskId, {
      status: 'processing',
      result: {
        status: 'processing',
        taskId,
        taskInfo: { stage: 'queued', progress: 0 },
      },
    });

    try {
      const result = await this.runConvertJob(dto, req, {
        userId,
        apiUsageId,
        skipPreDeduct: true,
        onStageChange: (stage, progress, extra) => {
          updateAsyncTask(taskId, {
            status: stage === 'completed' ? 'completed' : 'processing',
            result: {
              status: stage === 'completed' ? 'completed' : 'processing',
              taskId,
              gifUrl: typeof extra?.gifUrl === 'string' ? extra.gifUrl : undefined,
              gifKey: typeof extra?.gifKey === 'string' ? extra.gifKey : undefined,
              taskInfo: {
                stage,
                progress,
                duration: extra?.duration,
                startSeconds: extra?.startSeconds,
                durationSeconds: extra?.durationSeconds,
                fps: extra?.fps,
                width: extra?.width,
              },
            },
          });
        },
      });

      updateAsyncTask(taskId, {
        status: 'completed',
        result: {
          status: 'completed',
          taskId,
          gifUrl: result.gifUrl,
          gifKey: result.gifKey,
          taskInfo: {
            stage: 'completed',
            progress: 100,
            duration: result.duration,
            startSeconds: result.startSeconds,
            durationSeconds: result.durationSeconds,
            fps: result.fps,
            width: result.width,
          },
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      updateAsyncTask(taskId, {
        status: 'failed',
        error: errorMessage,
        result: {
          status: 'failed',
          taskId,
          taskInfo: { stage: 'failed', progress: 100 },
        },
      });
      throw error;
    }
  }

  private getVideoDuration(videoUrl: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        videoUrl,
      ]);

      let output = '';
      let errorOutput = '';

      ffprobe.stdout.on('data', (data) => {
        output += data.toString();
      });

      ffprobe.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      ffprobe.on('error', (err: any) => {
        if (String(err?.code || '') === 'ENOENT') {
          reject(new Error('ffprobe not installed on server'));
          return;
        }
        reject(new Error(`ffprobe error: ${err.message}`));
      });

      ffprobe.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`ffprobe failed: ${errorOutput.slice(-500)}`));
          return;
        }
        const duration = parseFloat(output.trim());
        resolve(Number.isFinite(duration) ? duration : 0);
      });
    });
  }

  private convertWithFfmpeg(params: {
    videoUrl: string;
    outputPath: string;
    startSeconds: number;
    durationSeconds: number;
    fps: number;
    width: number;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      const filter = `fps=${params.fps},scale=${params.width}:-1:flags=lanczos,split[s0][s1];` +
        `[s0]palettegen=stats_mode=diff[p];` +
        `[s1][p]paletteuse=dither=bayer:bayer_scale=5`;

      const ffmpeg = spawn('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        String(params.startSeconds),
        '-t',
        String(params.durationSeconds),
        '-i',
        params.videoUrl,
        '-vf',
        filter,
        '-loop',
        '1',
        '-y',
        params.outputPath,
      ]);

      let errorOutput = '';

      ffmpeg.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      ffmpeg.on('error', (err: any) => {
        if (String(err?.code || '') === 'ENOENT') {
          reject(new Error('ffmpeg not installed on server'));
          return;
        }
        reject(new Error(`ffmpeg error: ${err.message}`));
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`ffmpeg failed: ${errorOutput.slice(-500)}`));
          return;
        }
        resolve();
      });
    });
  }
}
