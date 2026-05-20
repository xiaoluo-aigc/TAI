import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  Min,
  Max,
} from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class TemplateQueryDto {
  @ApiPropertyOptional({ description: "页码", default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: "每页数量", default: 10 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  pageSize?: number = 10;

  @ApiPropertyOptional({ description: "分类" })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: "是否激活" })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: "搜索关键词" })
  @IsOptional()
  @IsString()
  search?: string;
}

export class CreateTemplateDto {
  @ApiPropertyOptional({ description: "模板名称" })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: "分类" })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: "描述" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: "标签" })
  @IsOptional()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: "缩略图" })
  @IsOptional()
  @IsString()
  thumbnail?: string;

  @ApiPropertyOptional({ description: "小缩略图 (40x40) URL" })
  @IsOptional()
  @IsString()
  thumbnailSmall?: string;

  @ApiPropertyOptional({ description: "模板数据" })
  @IsOptional()
  templateData?: any;

  @ApiPropertyOptional({ description: "模板JSON键" })
  @IsOptional()
  @IsString()
  templateJsonKey?: string;

  @ApiPropertyOptional({ description: "是否激活", default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: "排序序号", default: 0 })
  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class UpdateTemplateDto {
  @ApiPropertyOptional({ description: "模板名称" })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: "分类" })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: "描述" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: "标签" })
  @IsOptional()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: "缩略图" })
  @IsOptional()
  @IsString()
  thumbnail?: string;

  @ApiPropertyOptional({ description: "模板数据" })
  @IsOptional()
  templateData?: any;

  @ApiPropertyOptional({ description: "模板JSON键" })
  @IsOptional()
  @IsString()
  templateJsonKey?: string;

  @ApiPropertyOptional({ description: "是否激活" })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: "排序序号" })
  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}
