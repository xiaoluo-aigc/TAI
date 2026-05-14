import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string;

  @ApiProperty({ minLength: 8 })
  @IsString({ message: '密码必须是字符串' })
  @Length(8, 100, { message: '密码长度必须在8到100位之间' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, { message: '密码需包含大小写字母和数字' })
  password!: string;

  @ApiProperty({ description: '确认密码（必填）' })
  @IsString({ message: '确认密码必须是字符串' })
  confirmPassword!: string;

  @ApiProperty({ description: '用户名（必填）', minLength: 1, maxLength: 50 })
  @IsString({ message: '用户名必须是字符串' })
  @Length(1, 50, { message: '用户名长度必须在1到50位之间' })
  @Matches(/\S/, { message: '用户名不能为空' })
  name!: string;

  @ApiProperty({ description: '手机号（必填），国内 11 位' })
  @IsString({ message: '手机号必须是字符串' })
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确，请输入有效的11位手机号' })
  phone!: string;

  @ApiProperty({ description: '手机验证码（必填）' })
  @IsString({ message: '验证码必须是字符串' })
  @Matches(/^\d{6}$/, { message: '验证码必须是6位数字' })
  code!: string;

  @ApiProperty({ required: false, description: '邀请码（选填）' })
  @IsOptional()
  @IsString({ message: '邀请码必须是字符串' })
  inviteCode?: string;
}
