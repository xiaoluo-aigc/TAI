import { IsString, IsNotEmpty, IsOptional, IsArray, IsBoolean, IsEnum, IsObject, ValidateIf, IsNumber, ArrayMinSize, IsInt, Min, Max } from 'class-validator';

enum AspectRatio {
  'SQUARE' = '1:1',
  'PORTRAIT_TALL' = '2:3',
  'LANDSCAPE_SHORT' = '3:2',
  'PORTRAIT_MEDIUM' = '3:4',
  'LANDSCAPE_MEDIUM' = '4:3',
  'PORTRAIT_SHORT' = '4:5',
  'LANDSCAPE_TALL' = '5:4',
  'PORTRAIT_ULTRA' = '9:16',
  'LANDSCAPE_ULTRA' = '16:9',
  'CINEMA' = '21:9',
  'WIDE' = '2:1',
  'TALL' = '1:2',
  'PORTRAIT_CINEMA' = '9:21',
  'LONG_LANDSCAPE' = '4:1',
  'LONG_PORTRAIT' = '1:4',
  'ULTRA_LONG_LANDSCAPE' = '8:1',
  'ULTRA_LONG_PORTRAIT' = '1:8',
}

enum OutputFormat {
  JPEG = 'jpeg',
  PNG = 'png',
  WEBP = 'webp',
}

enum ThinkingLevel {
  HIGH = 'high',
  LOW = 'low',
}

enum GptImage2Quality {
  AUTO = 'auto',
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

enum GptImage2Background {
  AUTO = 'auto',
  OPAQUE = 'opaque',
  TRANSPARENT = 'transparent',
}

enum GptImage2Moderation {
  AUTO = 'auto',
  LOW = 'low',
}

export class GenerateImageDto {
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  aiProvider?: 'gemini' | 'gemini-pro' | 'banana' | 'banana-2.5' | 'banana-3.1' | 'runninghub' | 'midjourney' | 'nano2' | 'seedream5';

  @IsOptional()
  @IsObject()
  providerOptions?: Record<string, any>;

  @IsOptional()
  @IsEnum(OutputFormat)
  outputFormat?: 'jpeg' | 'png' | 'webp';

  @IsOptional()
  @IsEnum(AspectRatio)
  aspectRatio?:
    | '1:1'
    | '2:3'
    | '3:2'
    | '3:4'
    | '4:3'
    | '4:5'
    | '5:4'
    | '9:16'
    | '16:9'
    | '21:9'
    | '2:1'
    | '1:2'
    | '9:21'
    | '4:1'
    | '1:4'
    | '8:1'
    | '1:8';

  @IsOptional()
  @IsString()
  imageSize?: string;

  @IsOptional()
  @IsEnum(ThinkingLevel)
  thinkingLevel?: 'high' | 'low';

  @IsOptional()
  @IsBoolean()
  imageOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  enableWebSearch?: boolean; // 鐢熷浘闃舵鍚敤鑱旂綉鎼滅储锛堝 147 Ultra锛?

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[]; // Nano2 鍙傝€冨浘鐗?URL 鍒楄〃

  @IsOptional()
  @IsBoolean()
  googleSearch?: boolean; // Nano2 Google 鏂囨湰鎼滅储澧炲己

  @IsOptional()
  @IsBoolean()
  googleImageSearch?: boolean; // Nano2 Google 鍥剧墖鎼滅储澧炲己

  @IsOptional()
  @IsBoolean()
  batchMode?: boolean; // Seedream5 鎵归噺鐢熸垚妯″紡

  @IsOptional()
  @IsNumber()
  batchCount?: number; // Seedream5 鎵归噺鐢熸垚鏁伴噺 (2-10)

  @IsOptional()
  @IsString()
  parallelGroupId?: string;

  @IsOptional()
  @IsNumber()
  parallelGroupIndex?: number;

  @IsOptional()
  @IsNumber()
  parallelGroupTotal?: number;

  @IsOptional()
  @IsBoolean()
  officialFallback?: boolean; // gpt-image-2 鏄惁浣跨敤瀹樻柟娓犻亾鍏滃簳

  @IsOptional()
  @IsEnum(GptImage2Quality)
  quality?: 'auto' | 'low' | 'medium' | 'high';

  @IsOptional()
  @IsEnum(GptImage2Background)
  background?: 'auto' | 'opaque' | 'transparent';

  @IsOptional()
  @IsEnum(GptImage2Moderation)
  moderation?: 'auto' | 'low';

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  outputCompression?: number;

  @IsOptional()
  @IsString()
  maskUrl?: string;

  @IsOptional()
  @IsString()
  nodeConfigKey?: string;

  @IsOptional()
  @IsString()
  nodeConfigNameZh?: string;

  @IsOptional()
  @IsString()
  nodeConfigNameEn?: string;

  @IsOptional()
  @IsString()
  billingModeName?: string;

  @IsOptional()
  @IsString()
  billingTitleSource?: 'dialog' | 'node';
}

export class EditImageDto {
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @ValidateIf((o) => !o.sourceImageUrl)
  @IsString()
  @IsNotEmpty()
  sourceImage?: string; // base64

  @ValidateIf((o) => !o.sourceImage)
  @IsString()
  @IsNotEmpty()
  sourceImageUrl?: string; // remote URL to be fetched by backend

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  aiProvider?: 'gemini' | 'gemini-pro' | 'banana' | 'banana-2.5' | 'banana-3.1' | 'runninghub' | 'midjourney' | 'nano2' | 'seedream5';

  @IsOptional()
  @IsObject()
  providerOptions?: Record<string, any>;

  @IsOptional()
  @IsEnum(OutputFormat)
  outputFormat?: 'jpeg' | 'png' | 'webp';

  @IsOptional()
  @IsEnum(AspectRatio)
  aspectRatio?:
    | '1:1'
    | '2:3'
    | '3:2'
    | '3:4'
    | '4:3'
    | '4:5'
    | '5:4'
    | '9:16'
    | '16:9'
    | '21:9'
    | '2:1'
    | '1:2'
    | '9:21'
    | '4:1'
    | '1:4'
    | '8:1'
    | '1:8';

  @IsOptional()
  @IsString()
  imageSize?: string;

  @IsOptional()
  @IsEnum(ThinkingLevel)
  thinkingLevel?: 'high' | 'low';

  @IsOptional()
  @IsBoolean()
  imageOnly?: boolean;

  @IsOptional()
  @IsString()
  parallelGroupId?: string;

  @IsOptional()
  @IsNumber()
  parallelGroupIndex?: number;

  @IsOptional()
  @IsNumber()
  parallelGroupTotal?: number;

  @IsOptional()
  @IsString()
  nodeConfigKey?: string;

  @IsOptional()
  @IsString()
  nodeConfigNameZh?: string;

  @IsOptional()
  @IsString()
  nodeConfigNameEn?: string;

  @IsOptional()
  @IsString()
  billingModeName?: string;

  @IsOptional()
  @IsString()
  billingTitleSource?: 'dialog' | 'node';
}

export class BlendImagesDto {
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @ValidateIf((o) => !o.sourceImageUrls || o.sourceImageUrls.length === 0)
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  sourceImages?: string[]; // base64 array

  @ValidateIf((o) => !o.sourceImages || o.sourceImages.length === 0)
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  sourceImageUrls?: string[]; // remote URLs to be fetched by backend

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  aiProvider?: 'gemini' | 'gemini-pro' | 'banana' | 'banana-2.5' | 'banana-3.1' | 'runninghub' | 'midjourney' | 'nano2' | 'seedream5';

  @IsOptional()
  @IsObject()
  providerOptions?: Record<string, any>;

  @IsOptional()
  @IsEnum(OutputFormat)
  outputFormat?: 'jpeg' | 'png' | 'webp';

  @IsOptional()
  @IsEnum(AspectRatio)
  aspectRatio?:
    | '1:1'
    | '2:3'
    | '3:2'
    | '3:4'
    | '4:3'
    | '4:5'
    | '5:4'
    | '9:16'
    | '16:9'
    | '21:9'
    | '2:1'
    | '1:2'
    | '9:21'
    | '4:1'
    | '1:4'
    | '8:1'
    | '1:8';

  @IsOptional()
  @IsString()
  imageSize?: string;

  @IsOptional()
  @IsEnum(ThinkingLevel)
  thinkingLevel?: 'high' | 'low';

  @IsOptional()
  @IsBoolean()
  imageOnly?: boolean;

  @IsOptional()
  @IsString()
  parallelGroupId?: string;

  @IsOptional()
  @IsNumber()
  parallelGroupIndex?: number;

  @IsOptional()
  @IsNumber()
  parallelGroupTotal?: number;

  @IsOptional()
  @IsString()
  nodeConfigKey?: string;

  @IsOptional()
  @IsString()
  nodeConfigNameZh?: string;

  @IsOptional()
  @IsString()
  nodeConfigNameEn?: string;

  @IsOptional()
  @IsString()
  billingModeName?: string;

  @IsOptional()
  @IsString()
  billingTitleSource?: 'dialog' | 'node';
}

export class AnalyzeImageDto {
  @IsOptional()
  @IsString()
  prompt?: string;

  @ValidateIf((o) => !o.sourceImages || o.sourceImages.length === 0)
  @IsString()
  @IsNotEmpty()
  sourceImage?: string; // image/PDF data URL or base64

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  sourceImages?: string[]; // image/PDF data URL or base64 array

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  aiProvider?: 'gemini' | 'gemini-pro' | 'banana' | 'banana-2.5' | 'banana-3.1' | 'runninghub' | 'midjourney' | 'nano2' | 'seedream5';

  @IsOptional()
  @IsObject()
  providerOptions?: Record<string, any>;
}

export class TextChatDto {
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  aiProvider?: 'gemini' | 'gemini-pro' | 'banana' | 'banana-2.5' | 'banana-3.1' | 'runninghub' | 'midjourney' | 'nano2' | 'seedream5';

  @IsOptional()
  @IsObject()
  providerOptions?: Record<string, any>;

  @IsOptional()
  @IsString()
  billingTag?: 'text_chat' | 'prompt_optimize';

  @IsOptional()
  @IsBoolean()
  enableWebSearch?: boolean;

  @IsOptional()
  @IsEnum(ThinkingLevel)
  thinkingLevel?: 'high' | 'low';
}

export class MidjourneyActionDto {
  @IsString()
  @IsNotEmpty()
  taskId!: string;

  @IsString()
  @IsNotEmpty()
  customId!: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  notifyHook?: string;

  @IsOptional()
  @IsString()
  chooseSameChannel?: string;

  @IsOptional()
  @IsObject()
  accountFilter?: Record<string, any>;
}

export class MidjourneyModalDto {
  @IsString()
  @IsNotEmpty()
  taskId!: string;

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsString()
  maskBase64?: string;
}

export class Convert2Dto3DDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  imageUrl?: string; 

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  prompt?: string;

  @IsOptional()
  @IsString()
  projectId?: string;
}

export class ExpandImageDto {
  @IsString()
  @IsNotEmpty()
  imageUrl!: string; // OSS鍘熺敓鍙闂殑鍥剧墖URL

  @IsNotEmpty()
  @IsObject()
  expandRatios!: {
    left: number; // 宸︿晶鎵╁浘閮ㄥ垎/鍘熷浘闀垮害
    top: number; // 涓婁晶鎵╁浘閮ㄥ垎/鍘熷浘楂樺害
    right: number; // 鍙充晶鎵╁浘閮ㄥ垎/鍘熷浘闀垮害
    bottom: number; // 涓嬩晶鎵╁浘閮ㄥ垎/鍘熷浘楂樺害
  };

  @IsOptional()
  @IsString()
  prompt?: string; // 鎻愮ず璇嶏紝榛樿涓?鎵╁浘"

  @IsOptional()
  @IsString()
  aiProvider?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  imageSize?: string;

  @IsOptional()
  @IsString()
  aspectRatio?: string;

  @IsOptional()
  @IsString()
  thinkingLevel?: string;

  @IsOptional()
  @IsString()
  bananaImageRoute?: string;

  @IsOptional()
  @IsObject()
  providerOptions?: Record<string, any>;
}
