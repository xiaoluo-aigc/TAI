import {
  clearTokens,
  getAccessAuthHeader,
  getRefreshAuthHeader,
  setTokens,
} from "./authTokenStorage";
import { fetchWithAuth } from "./authFetch";

export type UserInfo = {
  id: string;
  email: string;
  name?: string;
  role?: string;
  phone?: string;
};

export type GoogleApiKeyInfo = {
  hasCustomKey: boolean;
  maskedKey: string | null;
  mode: "official" | "custom";
};

const isMock = import.meta.env.VITE_AUTH_MODE === "mock";

// 后端基础地址，统一从 .env 中读取：
// 例如在 .env.development / .env.production 中配置：
// VITE_API_BASE_URL="https://your-backend-domain.com"
// 如果不配置，则默认 http://localhost:4000
const base =
  import.meta.env.VITE_API_BASE_URL && import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "http://localhost:4000";

// Simple localStorage-based mock helpers
const LS_USER_KEY = "mock_user";
const LS_USERS_KEY = "mock_users";
const LS_TOKEN_EXPIRY = "token_expiry";
const LS_LAST_AUTH_AT = "last_auth_at";
const FIXED_SMS_CODE = "336699";

// Token过期时间管理
export function getStoredTokenExpiry(): number | null {
  try {
    const expiry = localStorage.getItem(LS_TOKEN_EXPIRY);
    return expiry ? parseInt(expiry) : null;
  } catch {
    return null;
  }
}

function setStoredTokenExpiry(expiry: number) {
  try {
    localStorage.setItem(LS_TOKEN_EXPIRY, expiry.toString());
  } catch {}
}

function clearStoredTokenExpiry() {
  try {
    localStorage.removeItem(LS_TOKEN_EXPIRY);
  } catch {}
}

export function getStoredLastAuthAt(): number | null {
  try {
    const raw = localStorage.getItem(LS_LAST_AUTH_AT);
    return raw ? parseInt(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredLastAuthAt(ts: number) {
  try {
    localStorage.setItem(LS_LAST_AUTH_AT, ts.toString());
  } catch {}
}

export function clearStoredLastAuthAt() {
  try {
    localStorage.removeItem(LS_LAST_AUTH_AT);
  } catch {}
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function readUsers(): UserInfo[] {
  try {
    const raw = localStorage.getItem(LS_USERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeUsers(users: UserInfo[]) {
  try {
    localStorage.setItem(LS_USERS_KEY, JSON.stringify(users));
  } catch {}
}

function saveSession(user: UserInfo) {
  try {
    localStorage.setItem(LS_USER_KEY, JSON.stringify(user));
  } catch {}
}

function loadSession(): UserInfo | null {
  try {
    const raw = localStorage.getItem(LS_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    localStorage.removeItem(LS_USER_KEY);
  } catch {}
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data?.message || data?.error || msg;

      // 全局处理特定的错误信息
      if (typeof window !== "undefined") {
        // 处理短信发送频率限制
        if (msg.includes("请等待 60 秒后再试")) {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: {
                message: "发送过于频繁，请等待60秒后再试",
                type: "error",
              },
            })
          );
        }
        // 处理阿里云业务流控错误
        else if (
          msg.includes("isv.BUSINESS_LIMIT_CONTROL") ||
          msg.includes("触发天级流控")
        ) {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: {
                message: "发送过于频繁，请稍后再试",
                type: "error",
              },
            })
          );
        }
      }
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const authApi = {
  getWatchaAuthorizeUrl(returnTo = "/app") {
    const params = new URLSearchParams({ returnTo });
    return `${base}/api/auth/watcha/authorize?${params.toString()}`;
  },


  async meDetailed(): Promise<{
    user: UserInfo | null;
    source: "mock" | "server" | "refresh" | "local" | null;
  }> {
    if (isMock) {
      await delay(200);
      return { user: loadSession(), source: "mock" };
    }

    // 优化：先检查本地token是否可能有效，避免不必要的网络请求
    const tokenExpiry = getStoredTokenExpiry();
    const localUser = loadSession();

    // 如果本地有用户信息且token未过期（提前1分钟检查），直接返回本地数据
    if (localUser && tokenExpiry && tokenExpiry > Date.now() + 60000) {
      console.log("[authApi] 使用本地缓存的用户信息，避免网络请求");
      return { user: localUser, source: "local" };
    }

    try {
      let res = await fetchWithAuth(`${base}/api/auth/me`, {
        credentials: "include",
        headers: { ...getAccessAuthHeader() },
        auth: "omit",
        allowRefresh: false,
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const user =
          data && typeof data === "object" && "user" in data
            ? (data.user as UserInfo)
            : (data as UserInfo);

        // 更新本地token过期时间（假设24小时有效期）
        if (user) {
          setStoredTokenExpiry(Date.now() + 24 * 60 * 60 * 1000);
          setStoredLastAuthAt(Date.now());
        }

        return { user, source: "server" };
      }
      if (res.status === 401 || res.status === 403) {
        try {
          const r = await fetchWithAuth(`${base}/api/auth/refresh`, {
            method: "POST",
            credentials: "include",
            headers: { ...getRefreshAuthHeader() },
            auth: "omit",
            allowRefresh: false,
          });
          if (r.ok) {
            const refreshData = await r.json().catch(() => null);
            if (refreshData?.tokens) {
              setTokens(refreshData.tokens);
            }
            res = await fetchWithAuth(`${base}/api/auth/me`, {
              credentials: "include",
              headers: { ...getAccessAuthHeader() },
              auth: "omit",
              allowRefresh: false,
            });
            if (res.ok) {
              const data = await res.json().catch(() => null);
              const user =
                data && typeof data === "object" && "user" in data
                  ? (data.user as UserInfo)
                  : (data as UserInfo);

              // 更新本地token过期时间
              if (user) {
                setStoredTokenExpiry(Date.now() + 24 * 60 * 60 * 1000);
                setStoredLastAuthAt(Date.now());
              }

              return { user, source: "refresh" };
            }
          }
        } catch (e) {
          console.warn("authApi.refresh failed:", e);
        }
      }
      console.warn("authApi.me not ok:", res.status);

      // 明确未授权：清空本地会话，避免“假登录”
      if (res.status === 401 || res.status === 403) {
        clearSession();
        clearStoredTokenExpiry();
        clearStoredLastAuthAt();
        clearTokens();
        return { user: null, source: null };
      }

      // 如果网络请求失败但本地有用户信息，返回本地数据
      if (localUser) {
        return { user: localUser, source: "local" };
      }

      return { user: null, source: null };
    } catch (e) {
      console.warn("authApi.me network error:", e);

      // 网络错误时返回本地用户信息（离线模式）
      if (localUser) {
        return { user: localUser, source: "local" };
      }

      return { user: null, source: null };
    }
  },
  async register(payload: {
    phone: string;
    password: string;
    code: string;
    name: string;
    email?: string;
    inviteCode?: string;
  }) {
    if (isMock) {
      await delay(300);
      const users = readUsers();
      const trimmedName = payload.name.trim();
      if (!/^\d{6}$/.test(payload.code || "")) {
        throw new Error("请输入6位验证码");
      }
      if (payload.code !== FIXED_SMS_CODE) {
        throw new Error("验证码错误（使用 336699）");
      }
      if (trimmedName === payload.phone) {
        throw new Error("用户名不能与手机号相同");
      }
      const existsPhoneMatchedByName = users.find((u) => u.phone === trimmedName);
      if (existsPhoneMatchedByName) {
        throw new Error("用户名不能与手机号相同");
      }
      const exists = users.find((u) => u.phone === payload.phone);
      if (exists) throw new Error("用户已存在");
      const user: UserInfo = {
        id: `u_${Date.now()}`,
        email: payload.email || `${payload.phone}@mock.local`,
        phone: payload.phone,
        name: trimmedName,
        role: "user",
      };
      // persist optional phone for strict SMS login
      if ((payload as any).email) {
        (user as any).email = (payload as any).email;
      }
      users.push(user);
      writeUsers(users);
      return { user };
    }
    const res = await fetchWithAuth(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
      auth: "omit",
      allowRefresh: false,
    });
    return json<{ user: UserInfo }>(res);
  },
  async login(payload: { phone: string; password: string }) {
    if (isMock) {
      await delay(300);
      const users = readUsers();
      const user = users.find((u) => u.phone === payload.phone);
      if (!user) {
        throw new Error("用户不存在，请先注册");
      }
      saveSession(user);
      return { user };
    }
    const res = await fetchWithAuth(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
      auth: "omit",
      allowRefresh: false,
    });
    const out = await json<{ user: UserInfo; tokens?: { accessToken?: string; refreshToken?: string } }>(res);
    if (out.tokens) {
      setTokens(out.tokens);
    }
    // 本地持久化用户，提升刷新体验（用于开发环境或后端短暂不可用时）
    saveSession(out.user);
    // 设置token过期时间（24小时）
    setStoredTokenExpiry(Date.now() + 24 * 60 * 60 * 1000);
    setStoredLastAuthAt(Date.now());
    return out;
  },
  async loginWithSms(payload: { phone: string; code: string }) {
    if (isMock) {
      await delay(300);
      if (!payload.phone) throw new Error("请输入手机号");
      if (payload.code !== FIXED_SMS_CODE)
        throw new Error("验证码错误（使用 336699）");
      const users = readUsers();
      const user = users.find(
        (u) =>
          u.phone === payload.phone || u.email === `${payload.phone}@mock.local`
      );
      if (!user) throw new Error("用户不存在，请先注册");
      saveSession(user);
        setStoredLastAuthAt(Date.now());
      return { user };
    }
    const res = await fetchWithAuth(`${base}/api/auth/login-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
      auth: "omit",
      allowRefresh: false,
    });
    const out = await json<{ user: UserInfo; tokens?: { accessToken?: string; refreshToken?: string } }>(res);
    if (out.tokens) {
      setTokens(out.tokens);
    }
    saveSession(out.user);
    // 设置token过期时间（24小时）
    setStoredTokenExpiry(Date.now() + 24 * 60 * 60 * 1000);
    setStoredLastAuthAt(Date.now());
    return out;
  },
  async sendSms(payload: { phone: string }) {
    if (isMock) {
      await delay(300);
      return { ok: true } as { ok: true };
    }
    const res = await fetchWithAuth(`${base}/api/auth/send-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      auth: "omit",
      allowRefresh: false,
    });
    const result = await json<{ ok: boolean; error?: string }>(res);

    // 如果后端返回 ok=false，则将其作为异常抛出，统一由调用方在 catch 中展示全局提示
    if (!result.ok) {
      const err = result.error || "发送失败";
      if (err.includes("请等待")) {
        throw new Error("请等待 60 秒后再试");
      } else if (err.includes("BUSINESS_LIMIT_CONTROL")) {
        throw new Error("今日发送过于频繁，每日只允许发送10条短信，请明日再试");
      }
      throw new Error(err);
    }

    return result;
  },
  async me() {
    if (isMock) {
      await delay(200);
      return loadSession();
    }
    try {
      let res = await fetchWithAuth(`${base}/api/auth/me`, {
        credentials: "include",
        headers: { ...getAccessAuthHeader() },
        auth: "omit",
        allowRefresh: false,
      });
      if (!res.ok) {
        // 常见 401：尝试使用 refresh cookie 刷新一次
        if (res.status === 401 || res.status === 403) {
          try {
            const r = await fetchWithAuth(`${base}/api/auth/refresh`, {
              method: "POST",
              credentials: "include",
              headers: { ...getRefreshAuthHeader() },
              auth: "omit",
              allowRefresh: false,
            });
            if (r.ok) {
              const refreshData = await r.json().catch(() => null);
              if (refreshData?.tokens) {
                setTokens(refreshData.tokens);
              }
              res = await fetchWithAuth(`${base}/api/auth/me`, {
                credentials: "include",
                headers: { ...getAccessAuthHeader() },
                auth: "omit",
                allowRefresh: false,
              });
            }
          } catch (e) {
            console.warn("authApi.refresh failed:", e);
          }
        }
      }
      if (!res.ok) {
        console.warn("authApi.me not ok:", res.status);
        // 明确未授权：清空本地会话，避免“假登录”
        if (res.status === 401 || res.status === 403) {
          clearSession();
          clearStoredTokenExpiry();
          clearStoredLastAuthAt();
          clearTokens();
          return null;
        }
        // 尝试使用本地持久化的用户，避免开发场景下的闪跳登录
        return loadSession();
      }
      const data = await res.json().catch(() => null);
      if (!data) return null;
      return data && typeof data === "object" && "user" in data
        ? (data.user as UserInfo)
        : (data as UserInfo);
    } catch (e) {
      console.warn("authApi.me network error:", e);
      return loadSession();
    }
  },
  async logout() {
    if (isMock) {
      await delay(200);
      clearSession();
      clearStoredTokenExpiry(); // 清除token过期时间
      return { ok: true } as { ok: boolean };
    }

    let ok = false;
    try {
      const res = await fetchWithAuth(`${base}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: { ...getRefreshAuthHeader() },
        auth: "omit",
        allowRefresh: false,
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          msg = data?.message || data?.error || msg;
        } catch {}
        console.warn("authApi.logout failed:", msg);
      } else {
        ok = true;
      }
    } catch (error) {
      console.warn("authApi.logout network error:", error);
    } finally {
      clearSession();
      clearStoredTokenExpiry(); // 清除token过期时间
      clearStoredLastAuthAt();
      clearTokens();
    }

    return { ok } as { ok: boolean };
  },

  // Google API Key 管理相关
  async getGoogleApiKey(): Promise<GoogleApiKeyInfo> {
    if (isMock) {
      await delay(200);
      // Mock 模式下返回空状态
      return { hasCustomKey: false, maskedKey: null, mode: "official" };
    }

    try {
      const res = await fetchWithAuth(`${base}/api/users/google-api-key`, {
        credentials: "include",
        headers: { ...getAccessAuthHeader() },
        auth: "omit",
        allowRefresh: false,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      console.warn("authApi.getGoogleApiKey failed:", e);
      return { hasCustomKey: false, maskedKey: null, mode: "official" };
    }
  },

  async updateGoogleApiKey(dto: {
    googleCustomApiKey?: string | null;
    googleKeyMode?: "official" | "custom";
  }): Promise<{ success: boolean; hasCustomKey: boolean; mode: string }> {
    if (isMock) {
      await delay(200);
      return {
        success: true,
        hasCustomKey: !!dto.googleCustomApiKey,
        mode: dto.googleKeyMode || "custom",
      };
    }

    const res = await fetchWithAuth(`${base}/api/users/google-api-key`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...getAccessAuthHeader() },
      body: JSON.stringify(dto),
      credentials: "include",
      auth: "omit",
      allowRefresh: false,
    });
    return json<{ success: boolean; hasCustomKey: boolean; mode: string }>(res);
  },

  // 忘记密码重置
  async resetPassword(payload: {
    phone: string;
    code: string;
    newPassword: string;
  }) {
    if (isMock) {
      await delay(500);
      // Mock模式下简单验证
      if (payload.code !== FIXED_SMS_CODE) {
        throw new Error("验证码错误");
      }
      return { success: true };
    }
    const res = await fetchWithAuth(`${base}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      auth: "omit",
      allowRefresh: false,
    });
    return json<{ success: boolean }>(res);
  },

  // 验证验证码（用于忘记密码流程中提前验证验证码是否有效）
  async verifyCode(payload: { phone: string; code: string }) {
    if (isMock) {
      await delay(300);
      if (payload.code !== FIXED_SMS_CODE) {
        throw new Error("验证码错误");
      }
      return { valid: true };
    }
    const res = await fetchWithAuth(`${base}/api/auth/verify-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      auth: "omit",
      allowRefresh: false,
    });
    return json<{ valid: boolean }>(res);
  },
};
