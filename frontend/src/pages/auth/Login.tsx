import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useAuthStore } from "@/stores/authStore";
import { Loader2, Eye, EyeOff, Check } from "lucide-react";
import { authApi } from "@/services/authApi";
import ForgotPasswordModal from "@/components/auth/ForgotPasswordModal";
import { useTranslation } from "react-i18next";
import WelcomeShaderBackground from "@/components/background/WelcomeShaderBackground";

export default function LoginPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"password" | "sms">("password");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isForgotPasswordOpen, setIsForgotPasswordOpen] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [sendCooldown, setSendCooldown] = useState(0);
  const [hasSentCode, setHasSentCode] = useState(false);
  const navigate = useNavigate();
  const { login, loginWithSms, error, user } = useAuthStore();

  useEffect(() => {
    if (user) {
      navigate("/app", { replace: true });
    }
  }, [user, navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreeTerms) {
      alert(t("auth.agreements.mustAgree"));
      return;
    }
    setIsSubmitting(true);
    try {
      if (tab === "password") {
        await login(phone, password);
      } else {
        await loginWithSms(phone, code || "");
      }
    } catch (err) {
      console.error("登录失败:", err);
      setIsSubmitting(false);
    }
  };

  const sendSmsCode = async (targetPhone: string) => {
    if (sendCooldown > 0) return;
    if (!targetPhone) {
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            message: t("auth.login.phoneRequired"),
            type: "error",
          },
        })
      );
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(targetPhone)) {
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            message: t("auth.login.phoneInvalid"),
            type: "error",
          },
        })
      );
      return;
    }
    try {
      await authApi.sendSms({ phone: targetPhone });
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            message: t("auth.login.smsSent"),
            type: "success",
          },
        })
      );
      setHasSentCode(true);
      setSendCooldown(60);
    } catch (err: any) {
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            message: err?.message || t("auth.register.sendFailed"),
            type: "error",
          },
        })
      );
    }
  };

  useEffect(() => {
    if (sendCooldown <= 0) return;
    const timer = setInterval(() => setSendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [sendCooldown]);

  const agreementSection = (
    <div className='flex items-start gap-2'>
      <button
        type='button'
        onClick={() => setAgreeTerms(!agreeTerms)}
        className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 transition-all sm:mt-0 ${
          agreeTerms ? "border-white bg-white" : "border-white/50 bg-transparent"
        }`}
      >
        {agreeTerms && <Check className='h-2.5 w-2.5 text-black' />}
      </button>
      <label
        onClick={() => setAgreeTerms(!agreeTerms)}
        className='cursor-pointer text-left text-xs leading-5 text-white'
      >
        {t("auth.agreements.prefix")}{" "}
        <Link to='/legal/terms' className='mx-1 text-blue-400 underline hover:text-blue-300' target='_blank' onClick={(e) => e.stopPropagation()}>
          {t("auth.agreements.terms")}
        </Link>
        {t("auth.agreements.comma")}
        <Link to='/legal/privacy' className='mx-1 text-blue-400 underline hover:text-blue-300' target='_blank' onClick={(e) => e.stopPropagation()}>
          {t("auth.agreements.privacy")}
        </Link>{" "}
        {t("auth.agreements.and")}{" "}
        <Link to='/legal/community' className='mx-1 text-blue-400 underline hover:text-blue-300' target='_blank' onClick={(e) => e.stopPropagation()}>
          {t("auth.agreements.community")}
        </Link>
      </label>
    </div>
  );

  return (
    <div className='relative flex min-h-screen items-start justify-center overflow-y-auto overflow-x-hidden px-4 py-6 sm:items-center sm:px-6 sm:py-10'>
      <WelcomeShaderBackground className='z-[1]' />
      <div className='absolute inset-0 bg-black/50 z-[2]'></div>

      <div className='relative z-10 my-auto w-full max-w-xl flex flex-col items-center'>
        <Card className='w-full border border-blue-400/20 bg-blue-500/10 p-6 shadow-2xl backdrop-blur-md sm:p-8 rounded-3xl'>
          {/* Logo 区域 */}
          <div className='flex items-center justify-center sm:mb-5 gap-1 pr-6'>
            <img src='/login-logo.png' alt='logo' className='h-10 w-auto sm:h-14' />
            <span className='text-white text-3xl sm:text-4xl font-bold select-none'>TAI</span>
          </div>

          {/* 欢迎登录 + 光标 */}
          <div className='mb-6 flex items-center justify-center gap-3'>
            <span className='typing-cursor-line-shorter' />
            <p className='text-sm text-white'>{t("auth.login.welcome")}</p>
            <span className='typing-cursor-line-shorter' />
          </div>

          <div className='flex justify-center'>
            <div className='w-full max-w-xl'>
              {/* Tab 切换 */}
              <div className='mb-6 flex items-center justify-center gap-12 sm:mb-8 sm:gap-16'>
                <button
                  className='flex flex-col items-center'
                  onClick={() => setTab("password")}
                >
                  <span className={tab === "password" ? "text-sm font-semibold text-blue-400" : "text-sm text-white transition-all hover:text-white"}>
                    {t("auth.login.passwordTab")}
                  </span>
                  <span className={tab === "password" ? "mt-2 block h-0.5 w-full bg-blue-400 rounded-full" : "mt-2 block h-0.5 w-0"} />
                </button>
                <button
                  className='flex flex-col items-center'
                  onClick={() => setTab("sms")}
                >
                  <span className={tab === "sms" ? "text-sm font-semibold text-blue-400" : "text-sm text-white transition-all hover:text-white"}>
                    {t("auth.login.smsTab")}
                  </span>
                  <span className={tab === "sms" ? "mt-2 block h-0.5 w-full bg-blue-400 rounded-full" : "mt-2 block h-0.5 w-0"} />
                </button>
              </div>

              {tab === "password" ? (
                <form onSubmit={onSubmit} className='space-y-5 sm:space-y-6 max-w-md mx-auto'>
                  <div className="relative">
                    <img src="/register1.png" alt="" className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-auto z-10 pointer-events-none" />
                    <Input
                      placeholder={t("auth.login.phonePlaceholder")}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                      className='bg-[#0d2847] border-transparent text-gray-300 placeholder:text-gray-400 focus:bg-[#144272] focus:border-transparent transition-all duration-200 rounded-xl h-12 pl-12'
                    />
                  </div>
                  <div className='relative'>
                    <img src="/register3.png" alt="" className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-auto z-10 pointer-events-none" />
                    <Input
                      placeholder={t("auth.login.passwordPlaceholder")}
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className='bg-[#0d2847] border-transparent text-gray-300 placeholder:text-gray-400 focus:bg-[#144272] focus:border-transparent transition-all duration-200 rounded-xl h-12 pl-12 pr-10'
                    />
                    <button
                      type='button'
                      onClick={() => setShowPassword(!showPassword)}
                      className='absolute right-3 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors'
                    >
                      {showPassword ? <Eye className='h-5 w-5' /> : <EyeOff className='h-5 w-5' />}
                    </button>
                  </div>
                  {error && <div className='text-red-400 text-sm drop-shadow-md'>{error}</div>}
                  {agreementSection}
                  <Button
                    type='submit'
                    className='w-full bg-blue-500 hover:bg-blue-600 text-white border-transparent rounded-xl h-12 font-medium backdrop-blur-sm transition-all duration-200 disabled:opacity-70 hover:shadow-lg'
                    disabled={isSubmitting || !agreeTerms}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                        {t("auth.login.submitting")}
                      </>
                    ) : (
                      t("auth.login.submit")
                    )}
                  </Button>
                  <div className='flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4'>
                    <button
                      onClick={() => setIsForgotPasswordOpen(true)}
                      className='text-left text-white/80 transition-all duration-200 hover:text-white'
                    >
                      {t("auth.login.forgotPassword")}
                    </button>
                    <Link
                      to='/auth/register'
                      className='text-left text-white/80 transition-all duration-200 hover:text-white sm:text-right'
                    >
                      {t("auth.login.registerNow")}
                    </Link>
                  </div>
                </form>
              ) : (
                <form onSubmit={onSubmit} className='space-y-5 sm:space-y-6 max-w-md mx-auto'>
                  <div className="relative">
                    <img src="/register1.png" alt="" className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-auto z-10 pointer-events-none" />
                    <Input
                      placeholder={t("auth.login.phonePlaceholder")}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                      className='bg-[#0d2847] border-transparent text-gray-300 placeholder:text-gray-400 focus:bg-[#144272] focus:border-transparent transition-all duration-200 rounded-xl h-12 pl-12'
                    />
                  </div>

                  {/* 验证码输入框 + 内嵌发送按钮（参考注册页样式） */}
                  <div className="relative flex items-center rounded-xl h-12 bg-[#0d2847] border-transparent focus-within:bg-[#144272] transition-all duration-200">
                    <img src="/register2.png" alt="" className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-auto z-10 pointer-events-none" />
                    <Input
                      placeholder={t("auth.login.codePlaceholder")}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      maxLength={6}
                      className='flex-1 bg-transparent border-0 text-gray-300 placeholder:text-gray-400 focus:bg-transparent focus:border-0 focus:ring-0 focus-visible:ring-0 h-full pl-12 pr-2 shadow-none'
                    />
                    <div className="h-5 w-px bg-white/20 shrink-0" />
                    <button
                      type="button"
                      onClick={() => void sendSmsCode(phone)}
                      disabled={sendCooldown > 0 || !phone.trim()}
                      className="px-4 text-sm text-blue-400 hover:text-blue-300 transition-colors disabled:text-blue-400/50 disabled:cursor-not-allowed whitespace-nowrap shrink-0 h-full"
                    >
                      {sendCooldown > 0
                        ? `${sendCooldown}秒后重新获取`
                        : hasSentCode
                          ? "重新发送"
                          : "发送"}
                    </button>
                  </div>

                  {error && <div className='text-red-400 text-sm drop-shadow-md'>{error}</div>}
                  {agreementSection}
                  <Button
                    type='submit'
                    className='w-full bg-blue-500 hover:bg-blue-600 text-white border-transparent rounded-xl h-12 font-medium backdrop-blur-sm transition-all duration-200 disabled:opacity-70 hover:shadow-lg'
                    disabled={isSubmitting || !agreeTerms}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                        {t("auth.login.submitting")}
                      </>
                    ) : (
                      t("auth.login.submit")
                    )}
                  </Button>

                  <div className='flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4'>
                    <button
                      onClick={() => setIsForgotPasswordOpen(true)}
                      className='text-left text-white/80 transition-all duration-200 hover:text-white'
                    >
                      {t("auth.login.forgotPassword")}
                    </button>
                    <Link
                      to='/auth/register'
                      className='text-left text-white/80 transition-all duration-200 hover:text-white sm:text-right'
                    >
                      {t("auth.login.registerNow")}
                    </Link>
                  </div>
                </form>
              )}
            </div>
          </div>
        </Card>
      </div>

      <ForgotPasswordModal
        isOpen={isForgotPasswordOpen}
        onClose={() => setIsForgotPasswordOpen(false)}
        onSuccess={() => {
          setTab("password");
        }}
      />
    </div>
  );
}
