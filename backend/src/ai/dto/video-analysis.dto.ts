import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

export class AnalyzeVideoDto {
  @IsOptional()
  @IsString()
  prompt?: string;

  @IsString()
  @IsNotEmpty()
  videoUrl!: string; // OSS URL

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  aiProvider?:
    | 'gemini'
    | 'gemini-pro'
    | 'banana'
    | 'banana-2.5'
    | 'banana-3.1'
    | 'runninghub'
    | 'midjourney'
    | 'nano2'
    | 'seedream5';

  @IsOptional()
  @IsString()
  bananaImageRoute?: 'normal' | 'stable';

  @IsOptional()
  @IsString()
  channelHint?: string;

  @IsOptional()
  @IsObject()
  providerOptions?: Record<string, any>;
}

export class VideoAnalysisResultDto {
  analysis!: string;
  model?: string;
  provider?: string;
}
