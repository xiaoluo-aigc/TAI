import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SmsLoginDto } from './dto/sms-login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './guards/jwt.guard';
import { RefreshAuthGuard } from './guards/refresh.guard';
import { SmsService } from './sms.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly sms: SmsService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: any) {
    const user = await this.auth.register(dto, {
      ip: req.ip,
      ua: req.headers['user-agent'],
    });
    return { user };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const user = await this.auth.validateUser(dto.phone, dto.password);
    const tokens = await this.auth.login(
      { id: user.id, email: user.email || '', role: user.role },
      { ip: req.ip, ua: req.headers['user-agent'] },
    );
    this.auth.setAuthCookies(res, tokens, req);
    return {
      user: { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role },
      tokens,
    };
  }

  @Get('watcha/authorize')
  async watchaAuthorize(@Query('returnTo') returnTo: string | undefined, @Res() res: any) {
    const authorizeUrl = await this.auth.buildWatchaAuthorizeUrl(returnTo);
    res.status(HttpStatus.FOUND);
    return res.redirect(authorizeUrl);
  }

  @Get('watcha/callback')
  async watchaCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    try {
      const { tokens, redirectUrl } = await this.auth.handleWatchaOauthCallback(
        {
          code,
          state,
          error,
          error_description: errorDescription,
        },
        {
          ip: req.ip,
          ua: req.headers['user-agent'],
        },
      );
      this.auth.setAuthCookies(res, tokens, req);
      res.status(HttpStatus.FOUND);
      return res.redirect(redirectUrl);
    } catch (e: any) {
      const redirectUrl = this.auth.buildWatchaFailureRedirect(e?.message || '观猹登录失败');
      res.status(HttpStatus.FOUND);
      return res.redirect(redirectUrl);
    }
  }

  // 发送短信（生产需要配置阿里云并推荐配置 REDIS_URL；开发时可启用 SMS_DEBUG=true 返回调试码）
  @Post('send-sms')
  @HttpCode(HttpStatus.OK)
  async sendSms(@Body() body: { phone: string }) {
    if (!body?.phone) return { ok: false, error: '缺少手机号' };
    try {
      const result = await this.sms.sendCode(body.phone);
      // 如果启用了调试模式或者没有配置阿里云密钥，会返回 debugCode，方便开发调试
      if (result.debugCode) return { ok: true, debugCode: result.debugCode };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  // 短信登录（开发/调试模式支持固定验证码，默认 336699，可用 SMS_FIXED_CODE 覆盖）
  @Post('login-sms')
  @HttpCode(HttpStatus.OK)
  async loginSms(@Body() dto: SmsLoginDto, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const { user, tokens } = await this.auth.loginWithSms(dto.phone, dto.code, {
      ip: req.ip,
      ua: req.headers['user-agent'],
    });
    this.auth.setAuthCookies(res, tokens, req);
    return {
      user: { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role },
      tokens,
    };
  }

  // 忘记密码重置
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    const result = await this.auth.resetPassword(dto.phone, dto.code, dto.newPassword);
    return result;
  }

  // 验证验证码（用于忘记密码流程中提前验证验证码是否有效）
  @Post('verify-code')
  @HttpCode(HttpStatus.OK)
  async verifyCode(@Body() body: { phone: string; code: string }) {
    if (!body?.phone || !body?.code) {
      return { valid: false, error: '缺少参数' };
    }
    try {
      // 使用 checkCode 只验证不删除，保留到重置密码时再删除
      const result = await this.sms.checkCode(body.phone, body.code);
      if (result.ok) {
        return { valid: true };
      }
      return { valid: false, error: result.msg || '验证码错误' };
    } catch (e: any) {
      return { valid: false, error: e?.message || '验证码验证失败' };
    }
  }

  @Get('me')
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: any) {
    return { user: req.user };
  }

  @Post('refresh')
  @ApiCookieAuth('refresh_token')
  @UseGuards(RefreshAuthGuard)
  async refresh(@Req() req: any, @Res({ passthrough: true }) res: any) {
    const tokens = await this.auth.refresh(req.user, req.user.refreshToken);
    this.auth.setAuthCookies(res, tokens, req);
    return { ok: true, tokens };
  }

  @Post('logout')
  @ApiCookieAuth('refresh_token')
  @UseGuards(RefreshAuthGuard)
  async logout(@Req() req: any, @Res({ passthrough: true }) res: any) {
    await this.auth.logout(req.user.sub);
    this.auth.clearAuthCookies(res, req);
    return { ok: true };
  }
}
