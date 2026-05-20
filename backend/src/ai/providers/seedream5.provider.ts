import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IAIProvider } from './ai-provider.interface';
import { Seedream5Service } from '../services/seedream5.service';

@Injectable()
export class Seedream5Provider implements IAIProvider {
  private readonly logger = new Logger(Seedream5Provider.name);
  private available = false;

  constructor(
    private readonly config: ConfigService,
    private readonly seedream5Service: Seedream5Service,
  ) {}

  async initialize(): Promise<void> {
    const doubaoApiKey =
      this.config.get<string>('ARK_API_KEY') ||
      this.config.get<string>('DOUBAO_API_KEY');
    const watchaApiKey =
      this.config.get<string>('WATCHA_SEEDREAM_API_KEY') ||
      this.config.get<string>('WATCHA_API_KEY');
    this.available = !!doubaoApiKey || !!watchaApiKey;
    this.logger.log(
      `Seedream5 provider initialized: ${this.available ? 'available' : 'unavailable'} (doubao=${!!doubaoApiKey}, watcha=${!!watchaApiKey})`,
    );
  }

  isAvailable(): boolean {
    return this.available;
  }

  getProviderInfo(): any {
    return { name: 'seedream5', model: 'doubao-seedream-5-0-260128' };
  }

  async generateImage(request: any): Promise<any> {
    const providerInfo = await this.seedream5Service.getProviderExecutionInfo();
    const result = await this.seedream5Service.generateImage({
      prompt: request.prompt,
      size: request.imageSize || '2K',
      image_urls: request.imageUrls,
      batchMode: request.batchMode,
      batchCount: request.batchCount,
    });

    this.logger.log(`Seedream5 generation completed`);

    // 单张图片
    if (result.imageUrl) {
      return {
        success: true,
        data: {
          imageData: null,
          imageUrl: result.imageUrl,
          textResponse: 'Image generated successfully',
          metadata: {
            imageUrl: result.imageUrl,
            provider: 'seedream5',
            aiProvider: 'seedream5',
            model: providerInfo.model,
            channel: providerInfo.provider,
          },
        },
      };
    }
    // 多张图片
    if (result.imageUrls && result.imageUrls.length > 0) {
      return {
        success: true,
        data: {
          imageData: null,
          imageUrl: result.imageUrls[0],
          imageUrls: result.imageUrls,
          textResponse: `Generated ${result.imageUrls.length} images successfully`,
          metadata: {
            imageUrls: result.imageUrls,
            provider: 'seedream5',
            aiProvider: 'seedream5',
            model: providerInfo.model,
            channel: providerInfo.provider,
          },
        },
      };
    }

    return { success: false, error: { message: 'No images returned' } };
  }

  async editImage(request: any): Promise<any> {
    throw new Error('Seedream5 does not support image editing');
  }

  async blendImages(request: any): Promise<any> {
    throw new Error('Seedream5 does not support image blending');
  }

  async analyzeImage(request: any): Promise<any> {
    throw new Error('Seedream5 does not support image analysis');
  }

  async generateText(request: any): Promise<any> {
    return {
      success: false,
      error: {
        code: 'NOT_SUPPORTED',
        message: 'Seedream5 provider does not support text generation. Please use Banana or Gemini provider for text chat.',
      },
    };
  }

  async selectTool(request: any): Promise<any> {
    return {
      success: false,
      error: {
        code: 'NOT_SUPPORTED',
        message: 'Seedream5 provider does not support tool selection.',
      },
    };
  }

  async generatePaperJS(request: any): Promise<any> {
    return {
      success: false,
      error: {
        code: 'NOT_SUPPORTED',
        message: 'Seedream5 provider does not support Paper.js generation.',
      },
    };
  }
}
