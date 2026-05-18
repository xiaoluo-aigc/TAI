import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useAuthStore } from "@/stores/authStore";
import { Eye, EyeOff, Check, X } from "lucide-react";
import { validateInviteCode } from "@/services/referralApi";
import { authApi } from "@/services/authApi";
import { useTranslation } from "react-i18next";
import WelcomeShaderBackground from "@/components/background/WelcomeShaderBackground";

export default function RegisterPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeCountdown, setCodeCountdown] = useState(0);
  const [hasSentCode, setHasSentCode] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteCodeValid, setInviteCodeValid] = useState<boolean | null>(null);
  const [inviterName, setInviterName] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const navigate = useNavigate();
  const { register, login, loading, error } = useAuthStore();

  const handleSendCode = async () => {
    if (!phone.trim() || !/^1[3-9]\d{9}$/.test(phone)) {
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: t("auth.register.phoneInvalid"), type: "error" },
        })
      );
      return;
    }

    try {
      await authApi.sendSms({ phone });
      setHasSentCode(true);
      setCodeCountdown(60);
      const timer = setInterval(() => {
        setCodeCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: t("auth.login.smsSent"), type: "success" },
        })
      );
    } catch (err: any) {
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: err?.message || t("auth.register.sendFailed"), type: "error" },
        })
      );
    }
  };

  useEffect(() => {
    const code = searchParams.get("code");
    if (code) {
      setInviteCode(code);
      validateInviteCode(code).then((result) => {
        setInviteCodeValid(result.valid);
        if (result.valid && result.inviterName) {
          setInviterName(result.inviterName);
        }
      });
    }
  }, [searchParams]);

  const handleInviteCodeBlur = async () => {
    if (!inviteCode.trim()) {
      setInviteCodeValid(null);
      setInviterName(null);
      return;
    }
    const result = await validateInviteCode(inviteCode.trim());
    setInviteCodeValid(result.valid);
    if (result.valid && result.inviterName) {
      setInviterName(result.inviterName);
    } else {
      setInviterName(null);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedPhone = phone.trim();
    const trimmedCode = code.trim();
    const trimmedName = `用户${trimmedPhone.slice(-4)}`;
    if (!agreeTerms) {
      alert(t("auth.agreements.mustAgree"));
      return;
    }
    if (!/^\d{6}$/.test(trimmedCode)) {
      alert(t("auth.register.codeInvalid"));
      return;
    }
    if (inviteCode.trim()) {
      if (inviteCodeValid === null) {
        const result = await validateInviteCode(inviteCode.trim());
        setInviteCodeValid(result.valid);
        if (!result.valid) {
          alert(t("auth.register.invalidInvite"));
          return;
        }
      } else if (inviteCodeValid === false) {
        alert(t("auth.register.invalidInvite"));
        return;
      }
    }
    try {
      await register(
        trimmedPhone,
        password,
        confirm,
        trimmedCode,
        trimmedName,
        undefined,
        inviteCode.trim() || undefined
      );
      await login(trimmedPhone, password);
      navigate("/");
    } catch (err) {
      // 错误已在 store 中处理
    }
  };

  return (
    <div className='relative flex min-h-screen items-start justify-center overflow-y-auto overflow-x-hidden px-4 py-6 sm:items-center sm:px-6 sm:py-10'>
      <WelcomeShaderBackground className='z-[1]' />
      <div className='absolute inset-0 bg-black/35 z-[2]'></div>

      {/* 左上角 Logo */}
      <div className='absolute top-10 left-10 z-20 flex items-center gap-2'>
        <img src='/register-logo.png' alt='logo' className='h-10 w-auto sm:h-12' />
        <span className='text-white text-2xl sm:text-3xl font-bold select-none'>TAI</span>
      </div>

      <div className='relative z-10 my-auto w-full max-w-xl flex flex-col items-center'>
        <div className='mb-10 text-center'>
          <h1 className='text-4xl font-medium text-white drop-shadow-md sm:text-5xl'>
            {t("auth.register.title")}
          </h1>
          <div className='mt-6 flex items-center justify-center gap-3'>
            <span className='typing-cursor-line-short' />
            <p className='text-sm text-white/80'>
              {t("auth.register.subtitle")}
            </p>
            <span className='typing-cursor-line-short' />
          </div>
        </div>

        <Card className='w-full border border-blue-400/20 bg-blue-500/10 p-6 shadow-2xl backdrop-blur-md sm:p-8 rounded-3xl'>
          <form onSubmit={onSubmit} className='space-y-4 sm:space-y-5 max-w-md mx-auto pt-4'>
            <div className="relative">
              <img src="/register1.png" alt="" className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-auto z-10 pointer-events-none" />
              <Input
                placeholder={t("auth.register.phonePlaceholder")}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                className='bg-[#0d2847] border-transparent text-white placeholder:text-gray-400 focus:bg-[#144272] focus:border-transparent transition-all duration-200 rounded-xl h-12 pl-12'
              />
            </div>

            {/* 验证码输入框 + 内嵌发送按钮（flex 布局，分隔线在中间偏右） */}
            <div className="relative flex items-center rounded-xl h-12 bg-[#0d2847] border border-transparent focus-within:bg-[#144272] focus-within:border-transparent transition-all duration-200">
              <img src="/register2.png" alt="" className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-auto z-10 pointer-events-none" />
              <Input
                placeholder={t("auth.login.codePlaceholder")}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                maxLength={6}
                className='flex-1 bg-transparent border-0 text-white placeholder:text-gray-400 focus:bg-transparent focus:border-0 focus:ring-0 focus-visible:ring-0 h-full pl-12 pr-2 shadow-none'
              />
              <div className="h-5 w-px bg-white/40 shrink-0" />
              <button
                type="button"
                onClick={handleSendCode}
                disabled={codeCountdown > 0 || !phone.trim()}
                className="px-4 text-sm text-blue-400 hover:text-blue-300 transition-colors disabled:text-blue-400/50 disabled:cursor-not-allowed whitespace-nowrap shrink-0 h-full"
              >
                {codeCountdown > 0
                  ? `${codeCountdown}秒后重新获取`
                  : hasSentCode
                    ? "重新发送"
                    : "发送"}
              </button>
            </div>

            <div className='relative'>
              <img src="/register3.png" alt="" className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-auto z-10 pointer-events-none" />
              <Input
                placeholder={t("auth.register.passwordPlaceholder")}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className='bg-[#0d2847] border-transparent text-white placeholder:text-gray-400 focus:bg-[#144272] focus:border-transparent transition-all duration-200 rounded-xl h-12 pl-12 pr-10'
              />
              <button
                type='button'
                onClick={() => setShowPassword(!showPassword)}
                className='absolute right-3 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors'
              >
                {showPassword ? <Eye className='h-5 w-5' /> : <EyeOff className='h-5 w-5' />}
              </button>
            </div>

            <div className='relative'>
              <img src="/register3.png" alt="" className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-auto z-10 pointer-events-none" />
              <Input
                placeholder={t("auth.register.confirmPlaceholder")}
                type={showConfirm ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className='bg-[#0d2847] border-transparent text-white placeholder:text-gray-400 focus:bg-[#144272] focus:border-transparent transition-all duration-200 rounded-xl h-12 pl-12 pr-10'
              />
              <button
                type='button'
                onClick={() => setShowConfirm(!showConfirm)}
                className='absolute right-3 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors'
              >
                {showConfirm ? <Eye className='h-5 w-5' /> : <EyeOff className='h-5 w-5' />}
              </button>
            </div>

            <div className='relative'>
              <img src="/register4.png" alt="" className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-auto z-10 pointer-events-none" />
              <Input
                placeholder={t("auth.register.invitePlaceholder")}
                value={inviteCode}
                onChange={(e) => {
                  setInviteCode(e.target.value);
                  setInviteCodeValid(null);
                }}
                onBlur={handleInviteCodeBlur}
                className='bg-[#0d2847] border-transparent text-white placeholder:text-gray-400 focus:bg-[#144272] focus:border-transparent transition-all duration-200 rounded-xl h-12 pl-12 pr-10'
              />
              {inviteCodeValid !== null && (
                <div className='absolute right-3 top-1/2 -translate-y-1/2'>
                  {inviteCodeValid ? (
                    <Check className='h-5 w-5 text-green-400' />
                  ) : (
                    <X className='h-5 w-5 text-red-400' />
                  )}
                </div>
              )}
              {inviteCodeValid && inviterName && (
                <div className='text-xs text-green-400 mt-1 ml-1'>
                  {t("auth.register.inviteFrom", { name: inviterName })}
                </div>
              )}
            </div>

            {error && <div className='text-red-400 text-sm drop-shadow-md'>{error}</div>}

            {/* 协议勾选 */}
            <div className='flex items-start justify-start gap-2 sm:items-center pl-5'>
              <button
                type='button'
                onClick={() => setAgreeTerms(!agreeTerms)}
                className={`mt-0.5 flex h-3 w-3 shrink-0 items-center justify-center rounded-full border-2 transition-all sm:mt-0 ${
                  agreeTerms
                    ? 'bg-white border-white'
                    : 'bg-transparent border-white/50'
                }`}
              >
                {agreeTerms && <Check className='w-3 h-3 text-black' />}
              </button>
              <label
                onClick={() => setAgreeTerms(!agreeTerms)}
                className='cursor-pointer text-left text-xs leading-5 text-white/100 pl-1'
              >
                {t("auth.agreements.prefix")}
                {" "}
                <Link to='/legal/terms' className='text-blue-400 hover:text-blue-300 underline mx-1' target='_blank' onClick={(e) => e.stopPropagation()}>{t("auth.agreements.terms")}</Link>
                {t("auth.agreements.comma")}
                <Link to='/legal/privacy' className='text-blue-400 hover:text-blue-300 underline mx-1' target='_blank' onClick={(e) => e.stopPropagation()}>{t("auth.agreements.privacy")}</Link>
                {" "}
                {t("auth.agreements.and")}
                {" "}
                <Link to='/legal/community' className='text-blue-400 hover:text-blue-300 underline mx-1' target='_blank' onClick={(e) => e.stopPropagation()}>{t("auth.agreements.community")}</Link>
              </label>
            </div>

            <Button
              type='submit'
              className='w-full bg-blue-500 hover:bg-blue-600 !text-white border-transparent rounded-xl h-12 font-medium backdrop-blur-sm transition-all duration-200 disabled:opacity-70 hover:shadow-lg'
              disabled={loading || !agreeTerms}
            >
              {loading ? t("auth.register.submitting") : t("auth.register.submit")}
            </Button>
            <div className='text-center text-sm'>
              <span className='text-white/80 drop-shadow-md'>{t("auth.register.hasAccount")}</span>
              <Link to='/auth/login' className='text-blue-400 hover:text-blue-300 transition-all duration-200 font-medium ml-1'>
                {t("auth.register.goLogin")}
              </Link>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
