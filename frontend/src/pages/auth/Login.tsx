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

  return (
    <div className='relative flex min-h-screen items-start justify-center overflow-y-auto overflow-x-hidden px-4 py-6 sm:items-center sm:px-6 sm:py-10'>
      <WelcomeShaderBackground className='z-[1]' />
      <div className='absolute inset-0 bg-black/50 z-[2]'></div>

      <Card className='relative z-10 my-auto w-full max-w-2xl border border-white/20 bg-white/10 p-4 shadow-2xl backdrop-blur-md sm:p-8'>
        <div className='mb-6 flex items-center justify-center sm:mb-10'>
          <img src='/LogoText.svg' className='h-7 w-auto brightness-0 invert drop-shadow-lg sm:h-8' />
        </div>
        <div className='flex justify-center'>
          <div className='w-full max-w-xl'>
            <div className='mb-6 grid grid-cols-2 gap-2 text-center text-sm sm:mb-8 sm:flex sm:items-center sm:justify-center sm:gap-6'>
              <button
                className={
                  tab === "password"
                    ? "rounded-full bg-white/14 px-3 py-2 text-white font-semibold drop-shadow-md transition-all duration-200 sm:bg-transparent sm:px-0 sm:py-0"
                    : "rounded-full px-3 py-2 text-white/70 transition-all duration-200 hover:text-white sm:px-0 sm:py-0"
                }
                onClick={() => setTab("password")}
              >
                {t("auth.login.passwordTab")}
              </button>
              <button
                className={
                  tab === "sms"
                    ? "rounded-full bg-white/14 px-3 py-2 text-white font-semibold drop-shadow-md transition-all duration-200 sm:bg-transparent sm:px-0 sm:py-0"
                    : "rounded-full px-3 py-2 text-white/70 transition-all duration-200 hover:text-white sm:px-0 sm:py-0"
                }
                onClick={() => setTab("sms")}
              >
                {t("auth.login.smsTab")}
              </button>
            </div>

            {tab === "password" ? (
              <form onSubmit={onSubmit} className='space-y-5 sm:space-y-6 sm:px-16'>
                <Input
                  placeholder={t("auth.login.phonePlaceholder")}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12'
                />
                <div className='relative'>
                  <Input
                    placeholder={t("auth.login.passwordPlaceholder")}
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12 pr-10'
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
                <Button
                  type='submit'
                  className='w-full bg-white/20 hover:bg-white/30 text-white border border-white/30 rounded-xl h-12 font-medium backdrop-blur-sm transition-all duration-200 disabled:opacity-70 hover:shadow-lg'
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

                <div className='flex items-start justify-center gap-2 pt-2 sm:items-center'>
                  <button
                    type='button'
                    onClick={() => setAgreeTerms(!agreeTerms)}
                    className={`mt-0.5 flex h-3 w-3 shrink-0 items-center justify-center rounded-full border-2 transition-all sm:mt-0 ${
                      agreeTerms ? "bg-white border-white" : "bg-transparent border-white/50"
                    }`}
                  >
                    {agreeTerms && <Check className='w-3 h-3 text-black' />}
                  </button>
                  <label
                    onClick={() => setAgreeTerms(!agreeTerms)}
                    className='cursor-pointer text-left text-xs leading-5 text-white/70'
                  >
                    {t("auth.agreements.prefix")}{" "}
                    <Link to='/legal/terms' className='text-white hover:underline mx-1' target='_blank' onClick={(e) => e.stopPropagation()}>
                      {t("auth.agreements.terms")}
                    </Link>
                    {t("auth.agreements.comma")}
                    <Link to='/legal/privacy' className='text-white hover:underline mx-1' target='_blank' onClick={(e) => e.stopPropagation()}>
                      {t("auth.agreements.privacy")}
                    </Link>{" "}
                    {t("auth.agreements.and")}{" "}
                    <Link to='/legal/community' className='text-white hover:underline mx-1' target='_blank' onClick={(e) => e.stopPropagation()}>
                      {t("auth.agreements.community")}
                    </Link>
                  </label>
                </div>
              </form>
            ) : (
              <form onSubmit={onSubmit} className='space-y-5 sm:space-y-6 sm:px-16'>
                <Input
                  placeholder={t("auth.login.phonePlaceholder")}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12'
                />
                <div className='flex flex-col gap-3 sm:flex-row'>
                  <Input
                    placeholder={t("auth.login.codePlaceholder")}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12 flex-1'
                  />
                  <Button
                    type='button'
                    variant='outline'
                    className='h-12 w-full rounded-xl border-white/30 bg-white/20 text-white backdrop-blur-sm transition-all duration-200 hover:bg-white/30 sm:min-w-[112px] sm:w-auto sm:flex-shrink-0 sm:whitespace-nowrap'
                    onClick={() => void sendSmsCode(phone)}
                    disabled={sendCooldown > 0}
                  >
                    {sendCooldown > 0 ? t("auth.login.resendCode", { seconds: sendCooldown }) : t("auth.login.sendCode")}
                  </Button>
                </div>
                {error && <div className='text-red-400 text-sm drop-shadow-md'>{error}</div>}
                <Button
                  type='submit'
                  className='w-full bg-white/20 hover:bg-white/30 text-white border border-white/30 rounded-xl h-12 font-medium backdrop-blur-sm transition-all duration-200 disabled:opacity-70 hover:shadow-lg'
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

                <div className='flex items-start justify-center gap-2 pt-2 sm:items-center'>
                  <button
                    type='button'
                    onClick={() => setAgreeTerms(!agreeTerms)}
                    className={`mt-0.5 flex h-3 w-3 shrink-0 items-center justify-center rounded-full border-2 transition-all sm:mt-0 ${
                      agreeTerms ? "bg-white border-white" : "bg-transparent border-white/50"
                    }`}
                  >
                    {agreeTerms && <Check className='w-3 h-3 text-black' />}
                  </button>
                  <label
                    onClick={() => setAgreeTerms(!agreeTerms)}
                    className='cursor-pointer text-left text-xs leading-5 text-white/70'
                  >
                    {t("auth.agreements.prefix")}{" "}
                    <Link to='/legal/terms' className='text-white hover:underline mx-1' target='_blank' onClick={(e) => e.stopPropagation()}>
                      {t("auth.agreements.terms")}
                    </Link>
                    {t("auth.agreements.comma")}
                    <Link to='/legal/privacy' className='text-white hover:underline mx-1' target='_blank' onClick={(e) => e.stopPropagation()}>
                      {t("auth.agreements.privacy")}
                    </Link>{" "}
                    {t("auth.agreements.and")}{" "}
                    <Link to='/legal/community' className='text-white hover:underline mx-1' target='_blank' onClick={(e) => e.stopPropagation()}>
                      {t("auth.agreements.community")}
                    </Link>
                  </label>
                </div>
              </form>
            )}
          </div>
        </div>
      </Card>

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
