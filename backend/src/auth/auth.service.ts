import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import { UsersService } from "../users/users.service";
import { PrismaService } from "../prisma/prisma.service";
import { RegisterDto } from "./dto/register.dto";
import { SmsService } from "./sms.service";
import { ReferralService } from "../referral/referral.service";
import { CreditsService } from "../credits/credits.service";
import { OpenObserveTelemetryService } from "../telemetry/openobserve-telemetry.service";

type TokenPair = { accessToken: string; refreshToken: string };
type WatchaTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

type WatchaUserInfoPayload = {
  user_id?: number | string;
  nickname?: string;
  avatar_url?: string;
  email?: string;
  phone?: string;
};

type WatchaUserInfoResponse = {
  statusCode?: number;
  code?: string;
  message?: string;
  data?: WatchaUserInfoPayload;
};

type WatchaOauthCallbackParams = {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
};

type WatchaLoginResult = {
  user: {
    id: string;
    email: string | null;
    name: string | null;
    phone: string;
    role: string;
  };
  tokens: TokenPair;
};

type WechatOfficialAccessTokenResponse = {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
};

type WechatOfficialStableAccessTokenRequest = {
  grant_type: "client_credential";
  appid: string;
  secret: string;
  force_refresh?: boolean;
};

type WechatOfficialQrCodeResponse = {
  ticket?: string;
  expire_seconds?: number;
  url?: string;
  errcode?: number;
  errmsg?: string;
};

type WechatOfficialUserInfoResponse = {
  subscribe?: number;
  openid?: string;
  nickname?: string;
  headimgurl?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
};

type WechatOfficialSessionStatus =
  | "pending"
  | "needs_phone_bind"
  | "authorized"
  | "expired";

type WechatOfficialLoginProfile = {
  openId: string;
  unionId?: string | null;
  nickname?: string | null;
  avatarUrl?: string | null;
};

type AuthenticatedUserProfile = {
  id: string;
  email: string | null;
  name: string | null;
  phone: string;
  role: string;
};

@Injectable()
export class AuthService {
  private wechatOfficialAccessTokenCache:
    | { token: string; expiresAt: number }
    | null = null;

  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly smsService: SmsService,
    @Inject(forwardRef(() => ReferralService))
    private readonly referralService: ReferralService,
    private readonly creditsService: CreditsService,
    private readonly openObserveTelemetryService: OpenObserveTelemetryService
  ) {}

  private async touchUserLastLoginAt(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
      select: { id: true },
    });
  }

  private async signTokens(user: {
    id: string;
    email: string;
    role: string;
  }): Promise<TokenPair> {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessTtl = this.config.get<string>("JWT_ACCESS_TTL") || "900s";
    const refreshTtl = this.config.get<string>("JWT_REFRESH_TTL") || "30d";

    const accessToken = await this.jwt.signAsync(payload, {
      secret:
        this.config.get<string>("JWT_ACCESS_SECRET") || "dev-access-secret",
      expiresIn: accessTtl,
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret:
        this.config.get<string>("JWT_REFRESH_SECRET") || "dev-refresh-secret",
      expiresIn: refreshTtl,
    });
    return { accessToken, refreshToken };
  }

  private cookieOptions(request?: any) {
    // 检测是否通过 HTTPS 访问（Cloudflare Tunnel 会设置 x-forwarded-proto: https）
    const isHttps =
      request?.headers?.["x-forwarded-proto"] === "https" ||
      request?.protocol === "https" ||
      this.config.get("COOKIE_SECURE") === "true";

    // 如果通过 HTTPS（如 Cloudflare Tunnel），使用 secure: true 和 sameSite: 'none'
    // 否则使用 secure: false 和 sameSite: 'lax'（本地开发）
    const secureEnv = this.config.get("COOKIE_SECURE");
    const secure = secureEnv ? secureEnv === "true" : isHttps;

    const sameSiteEnv = this.config.get("COOKIE_SAMESITE");
    const sameSite = sameSiteEnv ? sameSiteEnv : secure ? "none" : "lax";

    const rawDomain = this.config.get<string>("COOKIE_DOMAIN");
    // 注意：localhost/127.0.0.1 不能作为 Cookie Domain；开发环境不要设置 domain
    // Cloudflare Tunnel 也不需要设置 domain，让浏览器自动处理
    const invalidLocal =
      rawDomain === "localhost" ||
      rawDomain === "127.0.0.1" ||
      rawDomain === "";
    const domain = invalidLocal ? undefined : rawDomain;

    return { httpOnly: true, secure, sameSite, domain, path: "/" } as const;
  }

  private getWatchaConfig(requireCredentials = true) {
    const clientId = (this.config.get<string>("WATCHA_OAUTH_CLIENT_ID") || "").trim();
    const clientSecret = (this.config.get<string>("WATCHA_OAUTH_CLIENT_SECRET") || "").trim();
    const redirectUri = (this.config.get<string>("WATCHA_OAUTH_REDIRECT_URI") || "").trim();
    if (requireCredentials) {
      const missing: string[] = [];
      if (!clientId) missing.push("WATCHA_OAUTH_CLIENT_ID");
      if (!clientSecret) missing.push("WATCHA_OAUTH_CLIENT_SECRET");
      if (!redirectUri) missing.push("WATCHA_OAUTH_REDIRECT_URI");
      if (missing.length > 0) {
        throw new BadRequestException(
          `观猹 OAuth 配置不完整，缺少: ${missing.join(", ")}`
        );
      }
    }

    return {
      authorizeUrl:
        (this.config.get<string>("WATCHA_OAUTH_AUTHORIZE_URL") || "https://watcha.cn/oauth/authorize").trim(),
      tokenUrl: (this.config.get<string>("WATCHA_OAUTH_TOKEN_URL") || "https://watcha.cn/oauth/api/token").trim(),
      userInfoUrl:
        (this.config.get<string>("WATCHA_OAUTH_USERINFO_URL") || "https://watcha.cn/oauth/api/userinfo").trim(),
      scope: (this.config.get<string>("WATCHA_OAUTH_SCOPE") || "read").trim(),
      frontendBaseUrl: (this.config.get<string>("WATCHA_OAUTH_FRONTEND_BASE_URL") || "http://localhost:5173").trim(),
      failurePath: (this.config.get<string>("WATCHA_OAUTH_FAILURE_PATH") || "/auth/login").trim(),
      stateSecret:
        (this.config.get<string>("WATCHA_OAUTH_STATE_SECRET") ||
          this.config.get<string>("JWT_ACCESS_SECRET") ||
          "watcha-state-secret").trim(),
      clientId,
      clientSecret,
      redirectUri,
    };
  }

  private normalizeEmail(email?: string | null): string | null {
    if (!email) return null;
    const normalized = email.trim().toLowerCase();
    return normalized || null;
  }

  private normalizePhone(phone?: string | null): string | null {
    if (!phone) return null;
    const normalized = phone.trim();
    if (!normalized) return null;

    const digits = normalized.replace(/\D/g, "");
    if (digits) {
      if (/^1\d{10}$/.test(digits)) {
        return digits;
      }
      if (digits.startsWith("86")) {
        const without86 = digits.slice(2);
        if (/^1\d{10}$/.test(without86)) {
          return without86;
        }
      }
      const tail11 = digits.slice(-11);
      if (/^1\d{10}$/.test(tail11)) {
        return tail11;
      }
    }

    return normalized;
  }

  private normalizeName(name?: string | null): string | null {
    if (!name) return null;
    const normalized = name.trim();
    return normalized || null;
  }

  private normalizeWechatUnionId(unionId?: string | null): string | null {
    if (!unionId) return null;
    const normalized = unionId.trim();
    return normalized || null;
  }

  private isSyntheticWechatName(name?: string | null): boolean {
    const normalized = this.normalizeName(name);
    if (!normalized) return false;
    return /^微信用户(?:[-\s]|$)/.test(normalized) || /^用户-\w{4,}$/.test(normalized);
  }

  private buildSyntheticWechatName(openId: string): string {
    return `用户-${openId.slice(-6)}`;
  }

  private resolveWechatDisplayName(params: {
    userName?: string | null;
    nickname?: string | null;
    openId?: string | null;
  }): string | null {
    const normalizedUserName = this.normalizeName(params.userName);
    if (normalizedUserName && !this.isSyntheticWechatName(normalizedUserName)) {
      return normalizedUserName;
    }

    const normalizedNickname = this.normalizeName(params.nickname);
    if (normalizedNickname) {
      return normalizedNickname;
    }

    if (normalizedUserName) {
      return normalizedUserName;
    }

    if (params.openId) {
      return this.buildSyntheticWechatName(params.openId);
    }

    return null;
  }

  private isPrimaryPhone(phone?: string | null): boolean {
    if (!phone) return false;
    return /^1\d{10}$/.test(phone.trim());
  }

  private async findWechatOfficialUserByIdentity(
    tx: any,
    profile: WechatOfficialLoginProfile
  ): Promise<AuthenticatedUserProfile | null> {
    const unionId = this.normalizeWechatUnionId(profile.unionId);

    const byOpenId = await tx.user.findUnique({
      where: { wechatOfficialOpenId: profile.openId },
      select: { id: true, email: true, name: true, phone: true, role: true },
    });
    if (byOpenId) return byOpenId;

    if (!unionId) return null;

    return tx.user.findUnique({
      where: { wechatUnionId: unionId },
      select: { id: true, email: true, name: true, phone: true, role: true },
    });
  }

  private async attachWechatIdentityToUser(
    tx: any,
    userId: string,
    profile: WechatOfficialLoginProfile
  ): Promise<AuthenticatedUserProfile> {
    const unionId = this.normalizeWechatUnionId(profile.unionId);
    const currentUser = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    });
    if (!currentUser) {
      throw new UnauthorizedException("微信登录用户不存在");
    }

    const nextDisplayName = this.resolveWechatDisplayName({
      userName: currentUser.name,
      nickname: profile.nickname,
      openId: profile.openId,
    });

    const byOpenId = await tx.user.findUnique({
      where: { wechatOfficialOpenId: profile.openId },
      select: { id: true },
    });
    if (byOpenId && byOpenId.id !== userId) {
      throw new UnauthorizedException("该微信账号已绑定其他手机号");
    }

    if (unionId) {
      const byUnionId = await tx.user.findUnique({
        where: { wechatUnionId: unionId },
        select: { id: true },
      });
      if (byUnionId && byUnionId.id !== userId) {
        throw new UnauthorizedException("该微信账号已绑定其他手机号");
      }
    }

    return tx.user.update({
      where: { id: userId },
      data: {
        wechatOfficialOpenId: profile.openId,
        wechatUnionId: unionId,
        ...(nextDisplayName && nextDisplayName !== currentUser.name
          ? { name: nextDisplayName }
          : {}),
        avatarUrl: profile.avatarUrl || undefined,
      },
      select: { id: true, email: true, name: true, phone: true, role: true },
    });
  }

  private sanitizeReturnTo(returnTo?: string | null): string {
    if (!returnTo) return "/app";
    const trimmed = returnTo.trim();
    if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "/app";
    return trimmed.length > 512 ? "/app" : trimmed;
  }

  private buildFrontendRedirect(
    baseUrl: string,
    path: string,
    query?: Record<string, string | undefined>
  ) {
    const redirectUrl = new URL(path, baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value) {
          redirectUrl.searchParams.set(key, value);
        }
      }
    }
    return redirectUrl.toString();
  }

  private async createWatchaState(returnTo?: string) {
    const { stateSecret } = this.getWatchaConfig(false);
    return this.jwt.signAsync(
      { type: "watcha_oauth", returnTo: this.sanitizeReturnTo(returnTo) },
      { secret: stateSecret, expiresIn: "10m" }
    );
  }

  private async parseWatchaState(state: string): Promise<{ returnTo: string }> {
    const { stateSecret } = this.getWatchaConfig(false);
    const decoded = await this.jwt.verifyAsync<{ type?: string; returnTo?: string }>(state, {
      secret: stateSecret,
    });
    if (!decoded || decoded.type !== "watcha_oauth") {
      throw new UnauthorizedException("无效的观猹登录状态");
    }
    return { returnTo: this.sanitizeReturnTo(decoded.returnTo) };
  }

  private getWechatOfficialConfig(requireCredentials = true) {
    const appId = (this.config.get<string>("WECHAT_OFFICIAL_APP_ID") || "").trim();
    const appSecret = (this.config.get<string>("WECHAT_OFFICIAL_APP_SECRET") || "").trim();
    const token = (this.config.get<string>("WECHAT_OFFICIAL_TOKEN") || "").trim();

    if (requireCredentials) {
      const missing: string[] = [];
      if (!appId) missing.push("WECHAT_OFFICIAL_APP_ID");
      if (!appSecret) missing.push("WECHAT_OFFICIAL_APP_SECRET");
      if (!token) missing.push("WECHAT_OFFICIAL_TOKEN");
      if (missing.length > 0) {
        throw new BadRequestException(
          `微信公众号扫码登录配置不完整，缺少: ${missing.join(", ")}`
        );
      }
    }

    const qrExpireSeconds = Number(
      this.config.get<string>("WECHAT_OFFICIAL_QR_EXPIRE_SECONDS") || "300"
    );

    return {
      appId,
      appSecret,
      token,
      qrExpireSeconds: Number.isFinite(qrExpireSeconds)
        ? Math.max(60, Math.min(2592000, Math.floor(qrExpireSeconds)))
        : 300,
      welcomeMessage:
        (this.config.get<string>("WECHAT_OFFICIAL_LOGIN_MESSAGE") || "").trim() ||
        "正在授权中，请返回电脑端完成登录",
    };
  }

  private computeWechatOfficialSignature(
    token: string,
    timestamp?: string,
    nonce?: string
  ) {
    return createHash("sha1")
      .update([token, timestamp || "", nonce || ""].sort().join(""))
      .digest("hex");
  }

  verifyWechatOfficialRequest(signature?: string, timestamp?: string, nonce?: string) {
    const { token } = this.getWechatOfficialConfig(false);
    if (!token || !signature || !timestamp || !nonce) {
      return false;
    }

    return (
      this.computeWechatOfficialSignature(token, timestamp, nonce) === signature
    );
  }

  private parseWechatOfficialXml(rawXml: string) {
    const xml = typeof rawXml === "string" ? rawXml.trim() : "";
    const parsed: Record<string, string> = {};
    if (!xml) return parsed;

    const cdataRegex = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>/gs;
    for (const match of xml.matchAll(cdataRegex)) {
      parsed[match[1]] = match[2] || "";
    }

    const textRegex = /<(\w+)>([^<]*)<\/\1>/gs;
    for (const match of xml.matchAll(textRegex)) {
      if (!(match[1] in parsed)) {
        parsed[match[1]] = (match[2] || "").trim();
      }
    }

    return parsed;
  }

  private buildWechatOfficialTextResponse(
    toUserName: string,
    fromUserName: string,
    content: string
  ) {
    return `<xml>
<ToUserName><![CDATA[${toUserName}]]></ToUserName>
<FromUserName><![CDATA[${fromUserName}]]></FromUserName>
<CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[${content}]]></Content>
</xml>`;
  }

  private async getWechatOfficialAccessToken(forceRefresh = false) {
    const config = this.getWechatOfficialConfig();
    const now = Date.now();

    if (
      !forceRefresh &&
      this.wechatOfficialAccessTokenCache &&
      this.wechatOfficialAccessTokenCache.expiresAt > now + 60_000
    ) {
      return this.wechatOfficialAccessTokenCache.token;
    }

    const res = await fetch("https://api.weixin.qq.com/cgi-bin/stable_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credential",
        appid: config.appId,
        secret: config.appSecret,
        force_refresh: forceRefresh,
      } satisfies WechatOfficialStableAccessTokenRequest),
    });
    const data = (await res.json().catch(() => null)) as
      | WechatOfficialAccessTokenResponse
      | null;

    if (!res.ok || !data?.access_token) {
      const msg = data?.errmsg || `HTTP ${res.status}`;
      throw new BadRequestException(`微信公众号 access_token 获取失败: ${msg}`);
    }

    this.wechatOfficialAccessTokenCache = {
      token: data.access_token,
      expiresAt: now + Math.max((data.expires_in || 7200) - 300, 300) * 1000,
    };

    return data.access_token;
  }

  private shouldRefreshWechatOfficialAccessToken(
    error?: { errcode?: number; errmsg?: string } | null
  ) {
    const errCode = Number(error?.errcode);
    const errMsg = (error?.errmsg || "").toLowerCase();
    if (errCode === 40001 || errCode === 42001) {
      return true;
    }
    return (
      errMsg.includes("access_token is invalid") ||
      errMsg.includes("not latest") ||
      errMsg.includes("access token expired")
    );
  }

  private async fetchWechatOfficialUserInfo(openId: string) {
    try {
      const accessToken = await this.getWechatOfficialAccessToken();
      const url = new URL("https://api.weixin.qq.com/cgi-bin/user/info");
      url.searchParams.set("access_token", accessToken);
      url.searchParams.set("openid", openId);
      url.searchParams.set("lang", "zh_CN");

      const res = await fetch(url.toString());
      const data = (await res.json().catch(() => null)) as
        | WechatOfficialUserInfoResponse
        | null;

      if (!res.ok || !data || data.errcode || !data.openid) {
        return null;
      }

      return {
        openId: data.openid,
        unionId: this.normalizeWechatUnionId(data.unionid),
        nickname: this.normalizeName(data.nickname),
        avatarUrl: data.headimgurl || null,
      };
    } catch {
      return null;
    }
  }

  async createWechatOfficialLoginSession(returnTo?: string) {
    const config = this.getWechatOfficialConfig();
    const sceneKey = `wxlogin_${randomBytes(12).toString("hex")}`;
    const expiresAt = new Date(Date.now() + config.qrExpireSeconds * 1000);

    let accessToken = await this.getWechatOfficialAccessToken();
    let qrRes = await fetch(
      `https://api.weixin.qq.com/cgi-bin/qrcode/create?access_token=${encodeURIComponent(
        accessToken
      )}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expire_seconds: config.qrExpireSeconds,
          action_name: "QR_STR_SCENE",
          action_info: {
            scene: {
              scene_str: sceneKey,
            },
          },
        }),
      }
    );

    let qrData = (await qrRes.json().catch(() => null)) as
      | WechatOfficialQrCodeResponse
      | null;

    if (
      (!qrRes.ok || !qrData?.ticket) &&
      this.shouldRefreshWechatOfficialAccessToken(qrData)
    ) {
      accessToken = await this.getWechatOfficialAccessToken(true);
      qrRes = await fetch(
        `https://api.weixin.qq.com/cgi-bin/qrcode/create?access_token=${encodeURIComponent(
          accessToken
        )}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expire_seconds: config.qrExpireSeconds,
            action_name: "QR_STR_SCENE",
            action_info: {
              scene: {
                scene_str: sceneKey,
              },
            },
          }),
        }
      );

      qrData = (await qrRes.json().catch(() => null)) as
        | WechatOfficialQrCodeResponse
        | null;
    }

    if (!qrRes.ok || !qrData?.ticket) {
      const msg = qrData?.errmsg || `HTTP ${qrRes.status}`;
      throw new BadRequestException(`微信公众号二维码生成失败: ${msg}`);
    }

    const qrCodeUrl = `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(
      qrData.ticket
    )}`;

    return this.prisma.wechatLoginSession.create({
      data: {
        sceneKey,
        status: "pending",
        returnTo: this.sanitizeReturnTo(returnTo),
        qrTicket: qrData.ticket,
        qrCodeUrl,
        expiresAt,
      },
      select: {
        id: true,
        sceneKey: true,
        status: true,
        qrCodeUrl: true,
        expiresAt: true,
        returnTo: true,
      },
    });
  }

  async getWechatOfficialLoginSessionStatus(sessionId: string) {
    const session = await this.prisma.wechatLoginSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        qrCodeUrl: true,
        expiresAt: true,
        authorizedAt: true,
        returnTo: true,
        openId: true,
        nickname: true,
        avatarUrl: true,
        user: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!session) {
      throw new BadRequestException("微信登录会话不存在");
    }

    let status = session.status as WechatOfficialSessionStatus;
    if (session.expiresAt.getTime() <= Date.now() && status !== "authorized") {
      status = "expired";
      if (session.status !== "expired") {
        await this.prisma.wechatLoginSession.update({
          where: { id: session.id },
          data: { status: "expired" },
          select: { id: true },
        });
      }
    }

    return {
      id: session.id,
      status,
      qrCodeUrl: session.qrCodeUrl,
      expiresAt: session.expiresAt,
      authorizedAt: session.authorizedAt,
      returnTo: session.returnTo,
      needsPhoneBind: status === "needs_phone_bind",
      hasScannedIdentity: Boolean(session.openId),
      nickname: session.nickname,
      displayName: this.resolveWechatDisplayName({
        userName: session.user?.name,
        nickname: session.nickname,
        openId: session.openId,
      }),
      avatarUrl: session.avatarUrl,
    };
  }

  async bindWechatOfficialSessionPhone(
    sessionId: string,
    phone: string,
    code: string,
    inviteCode?: string,
    meta?: { ip?: string; ua?: string }
  ) {
    const normalizedPhone = this.normalizePhone(phone);
    const normalizedCode = code.trim();
    const normalizedInviteCode = inviteCode?.trim() || null;
    if (!normalizedPhone || !this.isPrimaryPhone(normalizedPhone)) {
      throw new BadRequestException("手机号格式不正确");
    }
    if (!normalizedCode) {
      throw new BadRequestException("验证码不能为空");
    }

    const verify = await this.smsService.verifyCode(normalizedPhone, normalizedCode);
    if (!verify.ok) {
      throw new UnauthorizedException(verify.msg || "验证码错误");
    }

    const session = await this.prisma.wechatLoginSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        returnTo: true,
        openId: true,
        unionId: true,
      },
    });

    if (!session) {
      throw new BadRequestException("微信登录会话不存在");
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("微信登录二维码已过期");
    }
    if (!session.openId) {
      throw new BadRequestException("尚未识别到微信身份，请先扫码确认");
    }
    if (session.status !== "needs_phone_bind") {
      throw new BadRequestException("当前会话无需绑定手机号");
    }
    const openId = session.openId;
    const fetchedProfile = await this.fetchWechatOfficialUserInfo(openId);

    const profile: WechatOfficialLoginProfile = {
      openId,
      unionId: fetchedProfile?.unionId || session.unionId,
      nickname: fetchedProfile?.nickname || null,
      avatarUrl: fetchedProfile?.avatarUrl || null,
    };

    const syntheticPasswordHash = await bcrypt.hash(
      randomBytes(24).toString("hex"),
      10
    );

    const user = await this.prisma.$transaction(async (tx) => {
      const existingWechatUser = await this.findWechatOfficialUserByIdentity(
        tx,
        profile
      );
      if (existingWechatUser && this.isPrimaryPhone(existingWechatUser.phone)) {
        if (existingWechatUser.phone !== normalizedPhone) {
          throw new UnauthorizedException("该微信账号已绑定其他手机号");
        }
        return this.attachWechatIdentityToUser(tx, existingWechatUser.id, profile);
      }

      const userByPhone = await tx.user.findUnique({
        where: { phone: normalizedPhone },
        select: { id: true, email: true, name: true, phone: true, role: true },
      });

      if (existingWechatUser) {
        if (userByPhone && userByPhone.id !== existingWechatUser.id) {
          throw new UnauthorizedException("该手机号已绑定其他账号，请使用手机号登录后再处理");
        }

        await tx.user.update({
          where: { id: existingWechatUser.id },
          data: { phone: normalizedPhone },
          select: { id: true },
        });

        return this.attachWechatIdentityToUser(tx, existingWechatUser.id, profile);
      }

      if (userByPhone) {
        return this.attachWechatIdentityToUser(tx, userByPhone.id, profile);
      }

      const name =
        this.resolveWechatDisplayName({
          nickname: profile.nickname,
          openId,
        }) || this.buildSyntheticWechatName(openId);
      const createdUser = await tx.user.create({
        data: {
          phone: normalizedPhone,
          passwordHash: syntheticPasswordHash,
          name,
          wechatOfficialOpenId: openId,
          wechatUnionId: this.normalizeWechatUnionId(profile.unionId),
          avatarUrl: profile.avatarUrl || null,
        },
        select: { id: true, email: true, name: true, phone: true, role: true },
      });

      if (normalizedInviteCode) {
        await this.referralService.useInviteCodeInTransaction(
          tx,
          createdUser.id,
          normalizedInviteCode
        );
      }

      return createdUser;
    });

    const tokens = await this.login(
      { id: user.id, email: user.email || "", role: user.role },
      meta
    );

    await this.prisma.wechatLoginSession.update({
      where: { id: session.id },
      data: {
        status: "authorized",
        userId: user.id,
        authorizedAt: new Date(),
        consumedAt: new Date(),
      },
      select: { id: true },
    });

    return {
      user,
      tokens,
      returnTo: this.sanitizeReturnTo(session.returnTo),
    };
  }

  async consumeWechatOfficialLoginSession(
    sessionId: string,
    meta?: { ip?: string; ua?: string }
  ) {
    const session = await this.prisma.wechatLoginSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        userId: true,
        expiresAt: true,
        returnTo: true,
      },
    });

    if (!session) {
      throw new BadRequestException("微信登录会话不存在");
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("微信登录二维码已过期");
    }
    if (session.status !== "authorized" || !session.userId) {
      throw new BadRequestException("微信登录尚未完成授权");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, email: true, name: true, phone: true, role: true },
    });

    if (!user) {
      throw new UnauthorizedException("微信登录用户不存在");
    }

    const tokens = await this.login(
      { id: user.id, email: user.email || "", role: user.role },
      meta
    );

    await this.prisma.wechatLoginSession.update({
      where: { id: session.id },
      data: { consumedAt: new Date() },
      select: { id: true },
    });

    return {
      user,
      tokens,
      returnTo: this.sanitizeReturnTo(session.returnTo),
    };
  }

  async handleWechatOfficialCallback(rawXml: string) {
    await this.openObserveTelemetryService.ingestBackendEvent({
      traceId: null,
      category: "wechat_official",
      action: "callback_received",
      message: "Received raw plaintext wechat official callback XML",
      payload: {
        mode: "plaintext",
        rawXml,
      },
      receivedAt: new Date().toISOString(),
    });

    const message = this.parseWechatOfficialXml(rawXml);
    const msgType = message.MsgType;
    const event = message.Event;
    const fromUserName = message.FromUserName;
    const toUserName = message.ToUserName;

    if (msgType !== "event" || !event || !fromUserName || !toUserName) {
      return "success";
    }

    const normalizedEvent = event.toUpperCase();
    if (normalizedEvent !== "SCAN" && normalizedEvent !== "SUBSCRIBE") {
      return "success";
    }

    const rawEventKey = message.EventKey || "";
    const sceneKey =
      normalizedEvent === "SUBSCRIBE"
        ? rawEventKey.replace(/^qrscene_/, "")
        : rawEventKey;

    if (!sceneKey) {
      return this.buildWechatOfficialTextResponse(
        fromUserName,
        toUserName,
        this.getWechatOfficialConfig(false).welcomeMessage
      );
    }

    const session = await this.prisma.wechatLoginSession.findUnique({
      where: { sceneKey },
      select: {
        id: true,
        expiresAt: true,
      },
    });

    if (!session || session.expiresAt.getTime() <= Date.now()) {
      return this.buildWechatOfficialTextResponse(
        fromUserName,
        toUserName,
        "登录二维码已过期，请返回电脑端刷新后重试"
      );
    }

    const fetchedProfile = await this.fetchWechatOfficialUserInfo(fromUserName);
    const profile: WechatOfficialLoginProfile = {
      openId: fromUserName,
      unionId: fetchedProfile?.unionId || null,
      nickname: fetchedProfile?.nickname || null,
      avatarUrl: fetchedProfile?.avatarUrl || null,
    };

    const linkedUser = await this.prisma.$transaction(async (tx) => {
      const user = await this.findWechatOfficialUserByIdentity(tx, profile);
      if (!user) return null;
      if (!this.isPrimaryPhone(user.phone)) return null;
      return this.attachWechatIdentityToUser(tx, user.id, profile);
    });

    await this.prisma.wechatLoginSession.update({
      where: { id: session.id },
      data: {
        status: linkedUser ? "authorized" : "needs_phone_bind",
        openId: fromUserName,
        unionId: profile.unionId,
        nickname: profile.nickname,
        avatarUrl: profile.avatarUrl,
        userId: linkedUser?.id || null,
        authorizedAt: linkedUser ? new Date() : null,
      },
      select: { id: true },
    });

    await this.openObserveTelemetryService.ingestBackendEvent({
      traceId: null,
      category: "wechat_official",
      action: "callback_authorized",
      message: "Wechat official callback authorized a login session",
      payload: {
        mode: "plaintext",
        sessionId: session.id,
        sceneKey,
        fromUserName,
        rawXml,
      },
      receivedAt: new Date().toISOString(),
    });

    return this.buildWechatOfficialTextResponse(
      fromUserName,
      toUserName,
      linkedUser
        ? this.getWechatOfficialConfig(false).welcomeMessage
        : "已识别微信身份，请返回电脑端填写手机号并验证短信后完成登录"
    );
  }

  async buildWatchaAuthorizeUrl(returnTo?: string) {
    const watchaConfig = this.getWatchaConfig();
    const state = await this.createWatchaState(returnTo);
    const params = new URLSearchParams({
      response_type: "code",
      client_id: watchaConfig.clientId,
      redirect_uri: watchaConfig.redirectUri,
      scope: watchaConfig.scope || "read",
      state,
    });
    return `${watchaConfig.authorizeUrl}?${params.toString()}`;
  }

  buildWatchaFailureRedirect(message?: string) {
    const watchaConfig = this.getWatchaConfig(false);
    return this.buildFrontendRedirect(watchaConfig.frontendBaseUrl, watchaConfig.failurePath, {
      watcha_error: message,
    });
  }

  private async fetchWatchaToken(code: string): Promise<string> {
    const watchaConfig = this.getWatchaConfig();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: watchaConfig.redirectUri,
      client_id: watchaConfig.clientId,
      client_secret: watchaConfig.clientSecret,
    });

    const res = await fetch(watchaConfig.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const data = (await res.json().catch(() => null)) as WatchaTokenResponse | null;
    if (!res.ok || !data || data.error || !data.access_token) {
      const msg = data?.error_description || data?.error || `HTTP ${res.status}`;
      throw new UnauthorizedException(`观猹 Token 获取失败: ${msg}`);
    }
    return data.access_token;
  }

  private async fetchWatchaUserInfo(accessToken: string) {
    const watchaConfig = this.getWatchaConfig();
    const userInfoUrl = new URL(watchaConfig.userInfoUrl);
    userInfoUrl.searchParams.set("access_token", accessToken);

    const res = await fetch(userInfoUrl.toString(), { method: "GET" });
    const data = (await res.json().catch(() => null)) as WatchaUserInfoResponse | null;
    const payload = data?.data;

    if (!res.ok || !payload || (!payload.user_id && payload.user_id !== 0)) {
      const msg = data?.message || `HTTP ${res.status}`;
      throw new UnauthorizedException(`观猹用户信息获取失败: ${msg}`);
    }
    return {
      watchaUserId: String(payload.user_id),
      nickname: this.normalizeName(payload.nickname),
      avatarUrl: payload.avatar_url || null,
      email: this.normalizeEmail(payload.email),
      phone: this.normalizePhone(payload.phone),
    };
  }

  private async pickWatchaPhoneCandidate(tx: any, watchaUserId: string, preferredPhone?: string | null) {
    if (preferredPhone) {
      const exists = await tx.user.findUnique({ where: { phone: preferredPhone } });
      if (!exists) return preferredPhone;
    }

    const slug = watchaUserId.replace(/[^0-9a-zA-Z]/g, "").slice(0, 16) || randomBytes(6).toString("hex");
    for (let i = 0; i < 20; i += 1) {
      const candidate = `watcha_${slug}_${i}`;
      const exists = await tx.user.findUnique({ where: { phone: candidate } });
      if (!exists) return candidate;
    }
    return `watcha_${slug}_${Date.now()}`;
  }

  async loginWithWatcha(
    profile: { watchaUserId: string; nickname?: string | null; avatarUrl?: string | null; email?: string | null; phone?: string | null },
    meta?: { ip?: string; ua?: string }
  ): Promise<WatchaLoginResult> {
    const email = this.normalizeEmail(profile.email);
    const phone = this.normalizePhone(profile.phone);
    const name = this.normalizeName(profile.nickname) || `观猹用户-${profile.watchaUserId}`;
    const syntheticPasswordHash = await bcrypt.hash(randomBytes(24).toString("hex"), 10);

    const user = await this.prisma.$transaction(async (tx) => {
      const pickSafeEmail = async (targetUserId: string, currentEmail: string | null) => {
        if (currentEmail || !email) return currentEmail;
        const owner = await tx.user.findUnique({ where: { email } });
        if (!owner || owner.id === targetUserId) {
          return email;
        }
        return currentEmail;
      };

      const byWatcha = await tx.user.findUnique({ where: { watchaUserId: profile.watchaUserId } });
      if (byWatcha) {
        const safeEmail = await pickSafeEmail(byWatcha.id, byWatcha.email);
        return tx.user.update({
          where: { id: byWatcha.id },
          data: {
            name: byWatcha.name || name,
            avatarUrl: profile.avatarUrl || byWatcha.avatarUrl,
            email: safeEmail,
          },
          select: { id: true, email: true, name: true, phone: true, role: true },
        });
      }

      let candidate: any = null;
      if (phone) {
        candidate = await tx.user.findUnique({ where: { phone } });
      }
      if (!candidate && email) {
        candidate = await tx.user.findUnique({ where: { email } });
      }

      if (candidate) {
        if (candidate.watchaUserId && candidate.watchaUserId !== profile.watchaUserId) {
          throw new UnauthorizedException("该账号已绑定其他观猹账号");
        }
        const safeEmail = await pickSafeEmail(candidate.id, candidate.email);
        return tx.user.update({
          where: { id: candidate.id },
          data: {
            watchaUserId: profile.watchaUserId,
            name: candidate.name || name,
            avatarUrl: profile.avatarUrl || candidate.avatarUrl,
            email: safeEmail,
          },
          select: { id: true, email: true, name: true, phone: true, role: true },
        });
      }

      let emailForCreate: string | null = null;
      if (email) {
        const emailExists = await tx.user.findUnique({ where: { email } });
        if (!emailExists) {
          emailForCreate = email;
        }
      }

      const phoneForCreate = await this.pickWatchaPhoneCandidate(tx, profile.watchaUserId, phone);
      return tx.user.create({
        data: {
          watchaUserId: profile.watchaUserId,
          name,
          avatarUrl: profile.avatarUrl || null,
          email: emailForCreate,
          phone: phoneForCreate,
          passwordHash: syntheticPasswordHash,
        },
        select: { id: true, email: true, name: true, phone: true, role: true },
      });
    });

    const tokens = await this.login(
      { id: user.id, email: user.email || "", role: user.role },
      meta
    );
    return { user, tokens };
  }

  async handleWatchaOauthCallback(
    params: WatchaOauthCallbackParams,
    meta?: { ip?: string; ua?: string }
  ): Promise<{ user: WatchaLoginResult["user"]; tokens: TokenPair; redirectUrl: string }> {
    const watchaConfig = this.getWatchaConfig();

    if (params.error) {
      throw new UnauthorizedException(params.error_description || params.error);
    }

    if (!params.code || !params.state) {
      throw new BadRequestException("缺少观猹授权参数");
    }

    let returnTo = "/app";
    try {
      const statePayload = await this.parseWatchaState(params.state);
      returnTo = statePayload.returnTo;
    } catch {
      throw new UnauthorizedException("观猹登录状态已失效，请重新发起登录");
    }

    try {
      const accessToken = await this.fetchWatchaToken(params.code);
      const profile = await this.fetchWatchaUserInfo(accessToken);
      const { user, tokens } = await this.loginWithWatcha(profile, meta);
      return {
        user,
        tokens,
        redirectUrl: this.buildFrontendRedirect(watchaConfig.frontendBaseUrl, returnTo),
      };
    } catch (error: any) {
      throw new UnauthorizedException(error?.message || "观猹登录失败");
    }
  }

  async register(dto: RegisterDto, meta?: { ip?: string; ua?: string }) {
    const trimmedName = dto.name.trim();
    const normalizedPhone = dto.phone.trim();
    const normalizedCode = dto.code.trim();
    const normalizedEmail = dto.email ? dto.email.trim().toLowerCase() : null;

    if (dto.password.length < 6) {
      throw new BadRequestException("至少6位密码");
    }
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException("两次输入的密码不一致");
    }

    const verify = await this.smsService.verifyCode(normalizedPhone, normalizedCode);
    if (!verify.ok) {
      throw new UnauthorizedException(verify.msg || "验证码错误");
    }

    if (normalizedEmail && trimmedName.toLowerCase() === normalizedEmail) {
      throw new BadRequestException("用户名不能与邮箱相同");
    }
    if (trimmedName === normalizedPhone) {
      throw new BadRequestException("用户名不能与手机号相同");
    }

    const hash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.$transaction(async (tx) => {
      const existsByPhone = await tx.user.findUnique({
        where: { phone: normalizedPhone },
      });
      if (existsByPhone) throw new UnauthorizedException("手机号已注册");
      const existsPhoneMatchedByName = await tx.user.findUnique({
        where: { phone: trimmedName },
      });
      if (existsPhoneMatchedByName) {
        throw new BadRequestException("用户名不能与手机号相同");
      }
      if (normalizedEmail) {
        const existsByEmail = await tx.user.findUnique({
          where: { email: normalizedEmail },
        });
        if (existsByEmail) throw new UnauthorizedException("邮箱已存在");
      }

      const newUser = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash: hash,
          name: trimmedName,
          phone: normalizedPhone,
        },
        select: {
          id: true,
          email: true,
          phone: true,
          name: true,
          avatarUrl: true,
          role: true,
          status: true,
          createdAt: true,
        },
      });

      if (dto.inviteCode?.trim()) {
        await this.referralService.useInviteCodeInTransaction(tx, newUser.id, dto.inviteCode);
      }

      return newUser;
    });

    // 创建积分账户并赠送新用户初始积分
    try {
      await this.creditsService.getOrCreateAccount(user.id);
    } catch (e) {
      // 积分账户创建失败不影响注册，只记录日志
      console.warn(`[Register] 创建积分账户失败: ${e instanceof Error ? e.message : e}`);
    }

    return user;
  }

  async validateUser(phone: string, password: string) {
    const user = await this.usersService.findByPhone(phone);
    if (!user) throw new UnauthorizedException("账号或密码错误");
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException("账号或密码错误");
    return user;
  }

  async login(
    user: { id: string; email: string; role: string },
    meta?: { ip?: string; ua?: string }
  ) {
    const tokens = await this.signTokens(user);
    const refreshHash = await bcrypt.hash(tokens.refreshToken, 10);
    const refreshTtlSec = this.config.get("JWT_REFRESH_TTL") || "30d";
    const expiresAt = new Date(Date.now() + this.parseTtlMs(refreshTtlSec));
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshHash,
        ip: meta?.ip,
        userAgent: meta?.ua,
        expiresAt,
      },
    });
    await this.touchUserLastLoginAt(user.id);
    return tokens;
  }

  async loginWithSms(
    phone: string,
    code: string,
    meta?: { ip?: string; ua?: string }
  ) {
    const verify = await this.smsService.verifyCode(phone, code);
    if (!verify.ok) throw new UnauthorizedException(verify.msg || "验证码错误");
    const user = await this.usersService.findByPhone(phone);
    if (!user) throw new UnauthorizedException("用户不存在，请先注册");
    const tokens = await this.login(
      { id: user.id, email: user.email || "", role: user.role },
      meta
    );
    return { user, tokens };
  }

  async resetPassword(phone: string, code: string, newPassword: string) {
    // 验证短信验证码
    const verify = await this.smsService.verifyCode(phone, code);
    if (!verify.ok) throw new BadRequestException(verify.msg || "验证码错误");

    // 查找用户
    const user = await this.usersService.findByPhone(phone);
    if (!user) throw new BadRequestException("用户不存在");

    // 加密新密码
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 更新用户密码
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hashedPassword },
    });

    return { success: true };
  }

  async refresh(userPayload: any, presentedToken: string) {
    const rt = await this.prisma.refreshToken.findFirst({
      where: { userId: userPayload.sub, isRevoked: false },
      orderBy: { createdAt: "desc" },
    });
    if (!rt) throw new UnauthorizedException("刷新令牌无效");
    const ok = await bcrypt.compare(presentedToken, rt.tokenHash);
    if (!ok) throw new UnauthorizedException("刷新令牌无效");
    if (rt.expiresAt < new Date())
      throw new UnauthorizedException("刷新令牌过期");
    await this.prisma.refreshToken.update({
      where: { id: rt.id },
      data: { isRevoked: true },
    });
    const tokens = await this.signTokens({
      id: userPayload.sub,
      email: userPayload.email,
      role: userPayload.role,
    });
    const refreshHash = await bcrypt.hash(tokens.refreshToken, 10);
    const refreshTtlSec = this.config.get("JWT_REFRESH_TTL") || "30d";
    const expiresAt = new Date(Date.now() + this.parseTtlMs(refreshTtlSec));
    await this.prisma.refreshToken.create({
      data: { userId: userPayload.sub, tokenHash: refreshHash, expiresAt },
    });
    await this.touchUserLastLoginAt(userPayload.sub);
    return tokens;
  }

  async logout(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true },
    });
  }

  setAuthCookies(reply: any, tokens: TokenPair, request?: any) {
    const base = this.cookieOptions(request);
    reply.setCookie("access_token", tokens.accessToken, { ...base });
    const refreshTtl = this.parseTtlMs(
      this.config.get("JWT_REFRESH_TTL") || "30d"
    );
    reply.setCookie("refresh_token", tokens.refreshToken, {
      ...base,
      maxAge: Math.floor(refreshTtl / 1000),
    });
  }

  clearAuthCookies(reply: any, request?: any) {
    const base = this.cookieOptions(request);
    reply.clearCookie("access_token", base);
    reply.clearCookie("refresh_token", base);
  }

  private parseTtlMs(ttl: string | number) {
    if (typeof ttl === "number") return ttl * 1000;
    const m = /^([0-9]+)([smhd])$/.exec(ttl);
    if (!m) return Number(ttl) * 1000;
    const n = Number(m[1]);
    const unit = m[2];
    switch (unit) {
      case "s":
        return n * 1000;
      case "m":
        return n * 60 * 1000;
      case "h":
        return n * 60 * 60 * 1000;
      case "d":
        return n * 24 * 60 * 60 * 1000;
      default:
        return n * 1000;
    }
  }
}
