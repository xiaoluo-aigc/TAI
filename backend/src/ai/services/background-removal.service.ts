import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { ConfigService } from '@nestjs/config';

/**
 * 后端背景移除服务
 * 优先使用 remove.bg API（如果配置了 API Key），否则使用本地 ONNX
 * 输出透明PNG格式
 */
@Injectable()
export class BackgroundRemovalService {
  private readonly logger = new Logger(BackgroundRemovalService.name);
  private removalModule: any = null;
  private localModuleAvailable: boolean | null = null; // null = 未测试, true = 可用, false = 不可用
  private readonly isWindows = process.platform === 'win32';

  constructor(private readonly configService: ConfigService) {
    if (this.isWindows) {
      this.logger.warn(
        '⚠️ Windows detected. Local background removal will run in isolated best-effort mode. ' +
        'If local ONNX fails, configure REMOVE_BG_API_KEY for remove.bg fallback.'
      );
    }
  }

  private getRemoveBgApiKey(): string {
    return (this.configService.get<string>('REMOVE_BG_API_KEY') || process.env.REMOVE_BG_API_KEY || '').trim();
  }

  private hasRemoveBgKey(): boolean {
    return this.getRemoveBgApiKey().length > 0;
  }

  private summarizeLoaderError(error: unknown): string {
    if (error instanceof Error) {
      const anyError = error as Error & { code?: string; cause?: unknown };
      const code = anyError.code ? ` code=${String(anyError.code)}` : '';
      const cause =
        anyError.cause instanceof Error
          ? ` cause=${anyError.cause.name}:${anyError.cause.message}`
          : '';
      return `${anyError.name}: ${anyError.message}${code}${cause}`;
    }
    return String(error);
  }

  private resolveRemovalModuleEntry(): string {
    const packageSpec = '@imgly/background-removal-node';
    const lookupPaths = [__dirname, process.cwd()];

    for (const basePath of lookupPaths) {
      try {
        return require.resolve(packageSpec, { paths: [basePath] });
      } catch {
        // ignore and continue
      }
    }

    return require.resolve(packageSpec);
  }

  /**
   * 使用 remove.bg API 移除背景
   * @param imageBuffer 图像 Buffer
   * @returns 透明PNG的base64数据
   */
  private async removeBackgroundViaRemoveBg(imageBuffer: Buffer): Promise<string> {
    const apiKey = this.getRemoveBgApiKey();
    if (!apiKey) {
      throw new Error('REMOVE_BG_API_KEY not configured');
    }

    this.logger.log('🌐 Using remove.bg API for background removal...');

    const formData = new FormData();
    formData.append('image_file', new Blob([imageBuffer]), 'image.png');
    formData.append('size', 'auto');

    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`remove.bg API error: HTTP ${response.status} ${errorText}`);
    }

    const resultBuffer = Buffer.from(await response.arrayBuffer());
    const resultBase64 = resultBuffer.toString('base64');

    this.logger.log(`✅ remove.bg API completed. Output: ${(resultBuffer.length / 1024).toFixed(2)}KB`);

    return `data:image/png;base64,${resultBase64}`;
  }

  /**
   * 延迟加载本地背景移除模块
   * @imgly/background-removal-node 模块较大,只在需要时加载
   */
  private async getRemovalModule() {
    if (this.removalModule) {
      return this.removalModule;
    }

    // 如果已知本地模块不可用，直接抛出错误
    if (this.localModuleAvailable === false) {
      throw new Error('Local background removal module is not available on this system');
    }

    try {
      this.logger.log('📦 Loading @imgly/background-removal-node module...');
      const entryPath = this.resolveRemovalModuleEntry();
      this.logger.log(`📦 Resolved @imgly/background-removal-node entry: ${entryPath}`);
      // 使用 Node 的真实解析结果加载，兼容 pnpm/软链接布局。
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(entryPath);
      this.removalModule = mod;
      this.localModuleAvailable = true;
      this.logger.log('✅ @imgly/background-removal-node loaded successfully');
      return mod;
    } catch (error) {
      this.localModuleAvailable = false;
      const detail = this.summarizeLoaderError(error);
      this.logger.error(`❌ Failed to load @imgly/background-removal-node: ${detail}`);
      throw new Error(
        `Background removal module is not available. ${detail}`
      );
    }
  }

  /**
   * 使用本地 ONNX 模块移除背景
   */
  private async removeBackgroundLocal(imageBuffer: Buffer, mimeType: string): Promise<string> {
    if (this.isWindows) {
      return this.removeBackgroundLocalIsolated(imageBuffer, mimeType);
    }

    // 将Buffer转换为Blob并指定正确的MIME type
    const blob = new Blob([imageBuffer], { type: mimeType || 'image/png' });

    // 调用背景移除函数
    const mod = await this.getRemovalModule();
    const publicPath = this.resolveLocalModelPublicPath();

    // 添加超时保护，防止 ONNX 处理卡死
    const timeoutMs = 120000; // 2分钟超时
    const resultPromise = mod.removeBackground(blob, {
      publicPath,
      output: {
        format: 'image/png',
        quality: 0.8,
      },
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Background removal timed out')), timeoutMs);
    });

    const result = await Promise.race([resultPromise, timeoutPromise]) as Blob;

    // 结果是Blob，转换为Buffer
    const arrayBuffer = await result.arrayBuffer();
    const resultBuffer = Buffer.from(arrayBuffer);

    // 转换为base64
    const resultBase64 = resultBuffer.toString('base64');

    this.logger.log(
      `✅ Local background removal completed. Output: ${(resultBuffer.length / 1024).toFixed(2)}KB`
    );

    // 返回带data URI前缀的base64 (PNG格式)
    return `data:image/png;base64,${resultBase64}`;
  }

  private async removeBackgroundWithProviderFallback(
    imageBuffer: Buffer,
    mimeType: string,
    sourceLabel: 'base64' | 'url' | 'file',
  ): Promise<string> {
    const hasRemoveBgKey = this.hasRemoveBgKey();

    if (hasRemoveBgKey) {
      try {
        return await this.removeBackgroundViaRemoveBg(imageBuffer);
      } catch (error) {
        this.logger.warn(`⚠️ remove.bg API failed for ${sourceLabel}, trying local module...`, error);
      }
    }

    if (!hasRemoveBgKey && this.isWindows && !this.canAttemptLocalRemoval()) {
      throw new BadRequestException(
        'Background removal is unavailable: Windows local worker/resources are missing, and REMOVE_BG_API_KEY is not configured.'
      );
    }

    try {
      return await this.removeBackgroundLocal(imageBuffer, mimeType);
    } catch (localError) {
      const localMessage = localError instanceof Error ? localError.message : String(localError);
      this.logger.error(`❌ Local background removal failed for ${sourceLabel}:`, localMessage);

      if (hasRemoveBgKey) {
        throw new BadRequestException(
          `Background removal failed. Both remove.bg API and local module failed. Local error: ${localMessage}`
        );
      }

      throw new BadRequestException(
        `Background removal failed: ${localMessage}. Consider configuring REMOVE_BG_API_KEY for better reliability.`
      );
    }
  }

  private getLocalWorkerPath(): string {
    const workerExt = __filename.endsWith('.ts') ? 'ts' : 'js';
    return path.resolve(__dirname, `../workers/background-removal.worker.${workerExt}`);
  }

  private hasLocalWorker(): boolean {
    return fs.existsSync(this.getLocalWorkerPath());
  }

  private hasLocalResources(): boolean {
    try {
      this.resolveLocalModelPublicPath();
      return true;
    } catch {
      return false;
    }
  }

  private canAttemptLocalRemoval(): boolean {
    return this.hasLocalWorker() && this.hasLocalResources();
  }

  private async removeBackgroundLocalIsolated(
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    const workerPath = this.getLocalWorkerPath();
    if (!fs.existsSync(workerPath)) {
      this.localModuleAvailable = false;
      throw new Error(`Background removal worker not found: ${workerPath}`);
    }

    const args = __filename.endsWith('.ts')
      ? ['-r', 'ts-node/register/transpile-only', workerPath]
      : [workerPath];

    this.logger.log('🧩 Running local background removal in isolated worker process');

    const child = spawn(process.execPath, args, {
      cwd: path.resolve(__dirname, '../../..'),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const timeoutMs = 120000;

    return await new Promise<string>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        this.localModuleAvailable = false;
        if (!settled) {
          settled = true;
          reject(new Error('Background removal worker timed out'));
        }
      }, timeoutMs);

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });

      child.on('error', (error) => {
        this.localModuleAvailable = false;
        finish(() => reject(error));
      });

      child.on('close', (code, signal) => {
        const trimmedStdout = stdout.trim();
        const trimmedStderr = stderr.trim();

        if (trimmedStdout) {
          try {
            const parsed = JSON.parse(trimmedStdout) as {
              ok?: boolean;
              imageData?: string;
              error?: string;
            };

            if (parsed.ok && typeof parsed.imageData === 'string' && parsed.imageData.length > 0) {
              this.localModuleAvailable = true;
              const imageData = parsed.imageData;
              finish(() => resolve(imageData));
              return;
            }

            this.localModuleAvailable = false;
            finish(() =>
              reject(
                new Error(
                  parsed.error ||
                    `Background removal worker failed with exit code ${code ?? 'unknown'}`
                )
              )
            );
            return;
          } catch {
            // ignore parse error and use generic crash detail below
          }
        }

        this.localModuleAvailable = false;
        const crashDetail = trimmedStderr || `exit=${code ?? 'null'} signal=${signal ?? 'null'}`;
        finish(() =>
          reject(
            new Error(`Background removal worker crashed before returning a result: ${crashDetail}`)
          )
        );
      });

      child.stdin.write(
        JSON.stringify({
          imageBase64: imageBuffer.toString('base64'),
          mimeType,
        })
      );
      child.stdin.end();
    });
  }

  /**
   * 解析本地 ONNX 资源路径。
   * 显式传入 publicPath，避免运行目录(cwd)变化导致资源查找失败。
   */
  private resolveLocalModelPublicPath(): string {
    const resolveFromInstalledPackage = (): string | null => {
      const packageSpec = '@imgly/background-removal-node/package.json';
      const lookupPaths = [__dirname, process.cwd()];

      for (const basePath of lookupPaths) {
        try {
          // 通过 Node 真实模块解析拿到包目录，兼容 pnpm/软链接布局。
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const packageJsonPath = require.resolve(packageSpec, { paths: [basePath] });
          const packageDir = path.dirname(packageJsonPath);
          const distDir = path.join(packageDir, 'dist');
          const resourcesPath = path.join(distDir, 'resources.json');
          if (fs.existsSync(resourcesPath)) {
            return distDir;
          }
        } catch {
          // ignore and continue fallback candidates
        }
      }

      return null;
    };

    const candidateDirs = [
      resolveFromInstalledPackage(),
      path.resolve(__dirname, '../../../node_modules/@imgly/background-removal-node/dist'),
      path.resolve(process.cwd(), 'node_modules/@imgly/background-removal-node/dist'),
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);

    for (const dir of candidateDirs) {
      const resourcesPath = path.join(dir, 'resources.json');
      if (fs.existsSync(resourcesPath)) {
        const fileUrl = pathToFileURL(dir).href;
        return fileUrl.endsWith('/') ? fileUrl : `${fileUrl}/`;
      }
    }

    throw new Error(
      'Local background removal resources not found. Missing @imgly/background-removal-node/dist/resources.json'
    );
  }

  /**
   * 从base64数据移除背景
   * @param imageData base64编码的图像数据
   * @param mimeType 图像MIME类型 (image/png, image/jpeg等)
   * @returns 透明PNG的base64数据
   */
  async removeBackgroundFromBase64(
    imageData: string,
    mimeType: string = 'image/png'
  ): Promise<string> {
    this.logger.log('🎯 Starting background removal from base64 data');

    // 验证输入
    if (!imageData || typeof imageData !== 'string') {
      throw new BadRequestException('Invalid image data provided');
    }

    // 移除data URI前缀(如果存在)
    const base64Data = imageData.includes(',')
      ? imageData.split(',')[1]
      : imageData;

    // 转换为Buffer
    const buffer = Buffer.from(base64Data, 'base64');

    this.logger.log(`📊 Input image: ${(buffer.length / 1024).toFixed(2)}KB, MIME type: ${mimeType}`);

    return this.removeBackgroundWithProviderFallback(buffer, mimeType, 'base64');
  }

  /**
   * 从URL移除背景
   * @param imageUrl 图像URL
   * @returns 透明PNG的base64数据
   */
  async removeBackgroundFromUrl(imageUrl: string): Promise<string> {
    this.logger.log(`🌐 Fetching image from URL: ${imageUrl}`);

    // 验证URL
    const url = new URL(imageUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new BadRequestException('Invalid URL protocol');
    }

    // 获取图像
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new BadRequestException(`Failed to fetch image: HTTP ${response.status}`);
    }

    const mimeType = response.headers.get('content-type') || 'image/png';
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    this.logger.log(`📊 Fetched image: ${(buffer.length / 1024).toFixed(2)}KB, MIME type: ${mimeType}`);

    return this.removeBackgroundWithProviderFallback(buffer, mimeType, 'url');
  }

  /**
   * 从本地文件移除背景
   * @param filePath 本地文件路径
   * @returns 透明PNG的base64数据
   */
  async removeBackgroundFromFile(filePath: string): Promise<string> {
    this.logger.log(`📁 Reading image from file: ${filePath}`);

    // 验证文件存在
    if (!fs.existsSync(filePath)) {
      throw new BadRequestException(`File not found: ${filePath}`);
    }

    // 读取文件
    const fileBuffer = fs.readFileSync(filePath);

    // 确定MIME类型
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    const mimeType = mimeTypeMap[ext] || 'image/png';

    this.logger.log(`📊 File size: ${(fileBuffer.length / 1024).toFixed(2)}KB, MIME type: ${mimeType}`);

    return this.removeBackgroundWithProviderFallback(fileBuffer, mimeType, 'file');
  }

  /**
   * 检查服务是否可用
   * @returns 是否可用
   */
  async isAvailable(): Promise<boolean> {
    // 如果配置了 remove.bg API Key，服务就是可用的
    if (this.hasRemoveBgKey()) {
      return true;
    }

    if (this.isWindows) {
      return this.canAttemptLocalRemoval();
    }

    // 否则检查本地模块
    try {
      await this.getRemovalModule();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取模块信息
   * @returns 模块版本和特性信息
   */
  async getInfo(): Promise<{
    available: boolean;
    version?: string;
    features: string[];
    provider?: string;
    platform?: string;
    reason?: string;
  }> {
    const hasRemoveBgKey = this.hasRemoveBgKey();

    // 如果有 remove.bg API Key，优先报告该服务
    if (hasRemoveBgKey) {
      return {
        available: true,
        version: 'remove.bg API',
        provider: 'remove.bg',
        platform: process.platform,
        features: [
          'Remove background with transparency',
          'Support PNG, JPEG, GIF, WebP',
          'High quality AI-powered removal',
          'Cloud-based processing',
        ],
      };
    }

    // 检查本地模块
    if (this.isWindows) {
      const available = this.canAttemptLocalRemoval();
      return {
        available,
        version: available ? 'isolated-worker' : undefined,
        provider: available ? 'local-onnx-worker' : 'none',
        platform: process.platform,
        reason: available
          ? 'Windows 环境将通过隔离子进程尝试本地 ONNX 抠图；若子进程崩溃，主服务不会断开。'
          : 'Windows 本地抠图 worker 或模型资源缺失，且未配置 REMOVE_BG_API_KEY。',
        features: available
          ? [
              'Remove background with transparency',
              'Support PNG, JPEG, GIF, WebP',
              'Isolated worker fallback on Windows',
            ]
          : [],
      };
    }

    try {
      const mod = await this.getRemovalModule();
      return {
        available: true,
        version: mod.version || 'unknown',
        provider: 'local-onnx',
        platform: process.platform,
        features: [
          'Remove background with transparency',
          'Support PNG, JPEG, GIF, WebP',
          'Preview mode available',
          'ONNX model powered',
        ],
      };
    } catch {
      return {
        available: false,
        provider: 'none',
        platform: process.platform,
        reason: this.isWindows
          ? 'Windows 环境下本地 ONNX 抠图为 best-effort；当前本地模块不可用，建议配置 REMOVE_BG_API_KEY 使用 remove.bg 云服务。'
          : '本地抠图模块不可用，请检查 @imgly/background-removal-node 安装与运行时依赖。',
        features: [],
      };
    }
  }
}
