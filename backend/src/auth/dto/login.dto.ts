import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class LoginDto {
  @ApiProperty({ description: '手机号（必填）' })
  @IsString({ message: '手机号必须是字符串' })
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确，请输入有效的11位手机号' })
  phone!: string;

  @ApiProperty({ minLength: 6 })
  @IsString()
  @Length(6, 100, { message: '密码长度必须在6到100位之间' })
  password!: string;
}
