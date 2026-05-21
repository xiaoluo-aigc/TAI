import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { BioAuthService } from './bio-auth.service';
import { StartBioAuthDto, CreateAssetInGroupDto } from './bio-auth.dto';

@ApiTags('bio-auth')
@Controller('bio-auth')
export class BioAuthController {
  private readonly logger = new Logger(BioAuthController.name);

  constructor(private readonly svc: BioAuthService) {}

  private resolveUserId(req: any): string {
    const uid = req?.user?.userId || req?.user?.id || req?.user?.sub;
    if (!uid) throw new BadRequestException('Missing user id in request');
    return String(uid);
  }

  private firstString(...values: unknown[]): string {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number') return String(value);
    }
    return '';
  }

  private async handleCallbackPayload(query: any, body?: any) {
    const bytedToken = this.firstString(
      query?.bytedToken,
      query?.BytedToken,
      query?.byted_token,
      query?.bytedtoken,
      body?.bytedToken,
      body?.BytedToken,
      body?.byted_token,
      body?.bytedtoken,
    );
    const resultCode = this.firstString(
      query?.resultCode,
      query?.ResultCode,
      query?.result_code,
      query?.code,
      body?.resultCode,
      body?.ResultCode,
      body?.result_code,
      body?.code,
    );

    if (!bytedToken) throw new BadRequestException('Missing bytedToken');
    this.logger.log(`bio-auth callback: bytedToken=${bytedToken.slice(0, 20)}… resultCode=${resultCode}`);
    await this.svc.handleCallback(bytedToken, resultCode);
    return { ok: true };
  }

  @UseGuards(ApiKeyOrJwtGuard)
  @Post('start')
  async start(@Req() req: any, @Body() dto: StartBioAuthDto) {
    const userId = this.resolveUserId(req);
    this.logger.log(`bio-auth start: user=${userId} imageUrl=${dto.imageUrl.slice(0, 80)}`);
    try {
      return await this.svc.startTask(userId, dto.imageUrl);
    } catch (err: any) {
      const message = err?.message || '启动人脸认证失败';
      this.logger.error(`bio-auth start failed for user ${userId}: ${message}`);
      throw new BadGatewayException(message);
    }
  }

  @UseGuards(ApiKeyOrJwtGuard)
  @Get(':taskId/status')
  status(@Param('taskId') taskId: string) {
    return this.svc.getStatus(taskId);
  }

  @UseGuards(ApiKeyOrJwtGuard)
  @Get('groups')
  async groups(@Req() req: any) {
    const userId = this.resolveUserId(req);
    return this.svc.listGroups(userId);
  }

  @UseGuards(ApiKeyOrJwtGuard)
  @Post('asset')
  async createAsset(@Req() req: any, @Body() dto: CreateAssetInGroupDto) {
    const userId = this.resolveUserId(req);
    this.logger.log(`bio-auth createAsset: user=${userId} groupId=${dto.groupId.slice(0, 20)}…`);
    try {
      return await this.svc.createAssetInGroup(userId, dto.groupId, dto.imageUrl);
    } catch (err: any) {
      if (err?.getStatus?.() === 403) throw err;
      const message = err?.message || '上传认证素材失败';
      this.logger.error(`bio-auth createAsset failed for user ${userId}: ${message}`);
      throw new BadGatewayException(message);
    }
  }

  // 火山引擎活体检测回调（无需认证，由火山引擎服务器调用）
  @Get('callback')
  async callback(@Query() query: any) {
    return this.handleCallbackPayload(query);
  }

  @Post('callback')
  async callbackPost(@Query() query: any, @Body() body: any) {
    return this.handleCallbackPayload(query, body);
  }
}
