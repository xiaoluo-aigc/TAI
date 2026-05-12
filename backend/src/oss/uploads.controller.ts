import {
  Body,
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiCookieAuth, ApiTags, ApiConsumes } from '@nestjs/swagger';
import { OssService } from './oss.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { Readable } from 'stream';

const SUPPORTED_VIDEO_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/mpeg',
  'video/3gpp',
  'video/x-flv',
];

const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB
const MAX_IMAGE_SIZE = 32 * 1024 * 1024; // 32MB
const SUPPORTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

function normalizeUploadDir(raw?: string, fallback = 'uploads/images/'): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return fallback;
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function sanitizeFileName(raw?: string, fallback = 'image.png'): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  const source = trimmed || fallback;
  return source.replace(/[^a-zA0-9_.-]/g, '_');
}

function inferExtFromMime(mimeType?: string): string {
  const value = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
  if (value === 'image/jpeg' || value === 'image/jpg') return 'jpg';
  if (value === 'image/png') return 'png';
  if (value === 'image/webp') return 'webp';
  if (value === 'image/gif') return 'gif';
  if (value === 'image/svg+xml') return 'svg';
  return 'png';
}

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  private readonly logger = new Logger(UploadsController.name);

  constructor(private readonly oss: OssService) {}
/*
  @Post('presign')
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  presign(@Body() body: { dir?: string; maxSize?: number }) {
    const dir = body?.dir ?? 'uploads/';
    const max = body?.maxSize ?? 32 * 1024 * 1024;
    const data = this.oss.presignPost(dir, 300, max);
    return data;
  }
*/
  @Post('presign')
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  async presign(@Body() body: { key: string; contentType?: string }) {
    if (!body || !body.key) {
      throw new BadRequestException('上传路径(key)不能为空');
    }
    // 调用新的 S3 预签名方法生成 PUT 链接
    const data = await this.oss.getPresignedPutUrl(body.key, body.contentType);
    return data; // 返回 { uploadUrl: string, publicUrl: string }
  }
  @Post('image')
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_SIZE } }))
  @ApiConsumes('multipart/form-data')
  async uploadImage(
    @UploadedFile() file: any,
    @Body() body: { dir?: string; key?: string; fileName?: string }
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const mimeType = String(file.mimetype || '').toLowerCase();
    if (!SUPPORTED_IMAGE_TYPES.includes(mimeType)) {
      throw new BadRequestException(`Unsupported image format: ${file.mimetype}`);
    }

    const dir = normalizeUploadDir(body?.dir, 'uploads/images/');
    const explicitKey = typeof body?.key === 'string' ? body.key.trim().replace(/^\/+/, '') : '';
    const safeFileName = sanitizeFileName(body?.fileName || file.originalname || `image.${inferExtFromMime(mimeType)}`);
    const key = (() => {
      if (explicitKey) return explicitKey;
      const ext = safeFileName.includes('.') ? safeFileName.split('.').pop() || inferExtFromMime(mimeType) : inferExtFromMime(mimeType);
      return `${dir}${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeFileName.replace(/\.[^.]+$/, '')}.${ext}`;
    })();

    const stream = Readable.from(file.buffer);
    const result = await this.oss.putStream(key, stream, {
      headers: {
        'Content-Type': mimeType || 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });

    return { url: result.url, key: result.key };
  }

  @Post('video')
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_VIDEO_SIZE } }))
  @ApiConsumes('multipart/form-data')
  async uploadVideo(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (!SUPPORTED_VIDEO_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported video format: ${file.mimetype}. Supported: ${SUPPORTED_VIDEO_TYPES.join(', ')}`
      );
    }

    const ext = file.originalname.split('.').pop() || 'mp4';
    const key = `videos/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const stream = Readable.from(file.buffer);
    const result = await this.oss.putStream(key, stream, {
      headers: { 'Content-Type': file.mimetype },
    });

    return { url: result.url, key: result.key };
  }

  @Post('transfer-video')
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  async transferVideo(@Body() body: { videoUrl: string }) {
    const { videoUrl } = body;
    if (!videoUrl || typeof videoUrl !== 'string') {
      throw new BadRequestException('videoUrl is required');
    }

    let url: URL;
    try {
      url = new URL(videoUrl.trim());
    } catch {
      throw new BadRequestException('Invalid video URL');
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new BadRequestException('Only HTTP/HTTPS URLs are supported');
    }

    this.logger.log(`[transfer-video] Downloading from: ${videoUrl.slice(0, 100)}...`);

    const response = await fetch(videoUrl, {
      headers: { 'User-Agent': 'Tanva-Server/1.0' },
    });

    if (!response.ok) {
      throw new BadRequestException(
        `Failed to download video: HTTP ${response.status}`
      );
    }

    const contentType = response.headers.get('content-type') || 'video/mp4';
    const contentLength = response.headers.get('content-length');

    if (contentLength && parseInt(contentLength, 10) > MAX_VIDEO_SIZE) {
      throw new BadRequestException(
        `Video too large: ${contentLength} bytes (max ${MAX_VIDEO_SIZE})`
      );
    }

    let ext = 'mp4';
    if (contentType.includes('webm')) ext = 'webm';
    else if (contentType.includes('quicktime') || contentType.includes('mov')) ext = 'mov';
    else if (contentType.includes('avi')) ext = 'avi';

    const key = `videos/transferred/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    this.logger.log(`[transfer-video] Downloaded ${buffer.length} bytes, uploading to OSS as ${key}`);

    const stream = Readable.from(buffer);
    const result = await this.oss.putStream(key, stream, {
      headers: { 'Content-Type': contentType },
    });

    this.logger.log(`[transfer-video] Upload complete: ${result.url}`);

    return { url: result.url, key: result.key };
  }
}