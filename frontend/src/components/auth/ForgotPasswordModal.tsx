import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, ArrowLeft } from "lucide-react";
import { authApi } from "@/services/authApi";
import { useTranslation } from "react-i18next";

type ForgotPasswordModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
};

type Step = "phone" | "verify" | "reset";

export default function ForgotPasswordModal({
  isOpen,
  onClose,
  onSuccess,
}: ForgotPasswordModalProps) {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || "")
    .toLowerCase()
    .startsWith("zh");
  const lt = (zhText: string, enText: string) => (isZh ? zhText : enText);
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 发送验证码的冷却时间
  const [sendCooldown, setSendCooldown] = useState(0);
  useEffect(() => {
    if (sendCooldown <= 0) return;
    const t = setInterval(
      () => setSendCooldown((s) => Math.max(0, s - 1)),
      1000
    );
    return () => clearInterval(t);
  }, [sendCooldown]);

  const isSmsRateLimited = (message: string) => {
    const msg = String(message || "");
    return (
      msg.includes("60秒后重试") ||
      msg.includes("60 seconds") ||
      msg.includes("BUSINESS_LIMIT_CONTROL") ||
      msg.includes("触发小时级流控") ||
      msg.includes("触发天级流控") ||
      msg.includes("Permits:5")
    );
  };

  const handleClose = () => {
    setStep("phone");
    setPhone("");
    setCode("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
    setSendCooldown(0);
    onClose();
  };

  const handleSendSms = async () => {
    if (sendCooldown > 0) return;
    if (!phone) {
      setError(lt("请输入手机号", "Please enter your phone number"));
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError(lt("手机号格式不正确", "Invalid phone number format"));
      return;
    }

    try {
      setError(null);
      await authApi.sendSms({ phone });
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            message: lt(
              "验证码已发送，请注意查收短信并手动输入",
              "Verification code sent. Please check SMS and enter it manually."
            ),
            type: "success",
          },
        })
      );
      setSendCooldown(60);
      setStep("verify");
    } catch (err: any) {
      const message = err?.message || lt("发送失败", "Send failed");
      if (isSmsRateLimited(message)) {
        setSendCooldown(60);
      }
      setError(message);
    }
  };

  const handleVerifyCode = async () => {
    if (!code.trim()) {
      setError(lt("请输入验证码", "Please enter the verification code"));
      return;
    }

    setIsSubmitting(true);
    try {
      // 验证验证码并进入重置密码步骤
      setError(null);
      // 实际调用后端验证验证码
      await authApi.verifyCode({ phone, code });
      setStep("reset");
    } catch (err: any) {
      const message = err?.message || "";
      // 如果是验证码过期，给出更友好的提示
      if (message.includes("过期") || message.includes("expired")) {
        setError(
          lt(
            "验证码已过期，请重新获取验证码",
            "Verification code expired. Please request a new code."
          )
        );
      } else {
        setError(err?.message || lt("验证码验证失败", "Code verification failed"));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!newPassword.trim()) {
      setError(lt("请输入新密码", "Please enter a new password"));
      return;
    }
    if (newPassword.length < 6 || newPassword.length > 100) {
      setError(
        lt(
          "密码长度必须在6到100位之间",
          "Password length must be between 6 and 100 characters"
        )
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(
        lt(
          "两次输入的密码不一致",
          "The two password entries do not match"
        )
      );
      return;
    }

    setIsSubmitting(true);
    try {
      setError(null);
      await authApi.resetPassword({ phone, code, newPassword });
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            message: lt(
              "密码重置成功，请使用新密码登录",
              "Password reset successful. Please sign in with the new password."
            ),
            type: "success",
          },
        })
      );
      onSuccess?.();
      handleClose();
    } catch (err: any) {
      setError(err?.message || lt("密码重置失败", "Password reset failed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBack = () => {
    if (step === "verify") {
      setStep("phone");
      setError(null);
    } else if (step === "reset") {
      setStep("verify");
      setError(null);
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div className='fixed inset-0 z-[2000] flex items-center justify-center'>
      {/* 背景遮罩 */}
      <div
        className='absolute inset-0 bg-black/50 backdrop-blur-sm'
        onClick={handleClose}
      />

      {/* 弹窗内容 */}
      <div className='relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden'>
        {/* 头部 */}
        <div className='flex items-center justify-between px-6 py-4 border-b'>
          <div className='flex items-center gap-3'>
            {step !== "phone" && (
              <button
                onClick={handleBack}
                className='p-2 rounded-lg hover:bg-slate-100 transition-colors'
              >
                <ArrowLeft className='h-5 w-5 text-slate-400' />
              </button>
            )}
            <span className='text-lg text-slate-600'>
              {lt("忘记密码", "Forgot Password")}
            </span>
          </div>
          <button
            onClick={handleClose}
            className='p-1 rounded-lg hover:bg-slate-100 transition-colors'
          >
            <X className='h-5 w-5 text-slate-400' />
          </button>
        </div>

        {/* 步骤指示器 */}
        <div className='px-6 pt-4'>
          <div className='flex items-center justify-center gap-2 px-2'>
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm  font-medium ${
                step === "phone"
                  ? "bg-blue-500 text-white"
                  : ["verify", "reset"].includes(step)
                  ? "bg-green-500 text-white"
                  : "bg-gray-200 text-gray-500"
              }`}
            >
              1
            </div>
            <div
              className={`flex-1 h-1 ${
                ["verify", "reset"].includes(step)
                  ? "bg-green-500"
                  : "bg-gray-200"
              }`}
            />
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                step === "verify"
                  ? "bg-blue-500 text-white"
                  : step === "reset"
                  ? "bg-green-500 text-white"
                  : "bg-gray-200 text-gray-500"
              }`}
            >
              2
            </div>
            <div
              className={`flex-1 h-1 ${
                step === "reset" ? "bg-green-500" : "bg-gray-200"
              }`}
            />
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                step === "reset"
                  ? "bg-blue-500 text-white"
                  : "bg-gray-200 text-gray-500"
              }`}
            >
              3
            </div>
          </div>
          <div className='flex justify-between mt-2 text-xs text-gray-500'>
            <span>{lt("输入手机号", "Phone")}</span>
            <span>{lt("验证身份", "Verify")}</span>
            <span>{lt("重置密码", "Reset")}</span>
          </div>
        </div>

        {/* 表单内容 */}
        <div className='p-6'>
          {step === "phone" && (
            <div className='space-y-4'>
              <div>
                <h3 className='text-lg font-medium text-gray-900 mb-2'>
                  {lt("输入手机号", "Enter phone number")}
                </h3>
                <p className='text-sm text-gray-600 mb-4'>
                  {lt(
                    "我们将向您的手机发送验证码来验证身份",
                    "We will send an SMS code to verify your identity"
                  )}
                </p>
              </div>

              <Input
                placeholder={lt("请输入手机号", "Enter phone number")}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoFocus
              />

              {error && <div className='text-red-500 text-sm'>{error}</div>}

              <Button
                onClick={handleSendSms}
                className='w-full bg-gray-700 hover:bg-gray-800 text-white rounded-xl h-10'
                disabled={sendCooldown > 0}
              >
                {sendCooldown > 0
                  ? lt(
                      `重新发送(${sendCooldown}s)`,
                      `Resend (${sendCooldown}s)`
                    )
                  : lt("发送验证码", "Send code")}
              </Button>
            </div>
          )}

          {step === "verify" && (
            <div className='space-y-4'>
              <div>
                <h3 className='text-lg font-medium text-gray-900 mb-2'>
                  {lt("验证身份", "Verify identity")}
                </h3>
                <p className='text-sm text-gray-600 mb-4'>
                  {lt(
                    `已向 ${phone} 发送验证码，请输入收到的6位验证码`,
                    `Code sent to ${phone}. Enter the 6-digit code.`
                  )}
                </p>
              </div>

              <Input
                placeholder={lt("请输入验证码", "Enter verification code")}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
                autoFocus
              />

              {error && <div className='text-red-500 text-sm'>{error}</div>}

              <Button
                onClick={handleVerifyCode}
                className='w-full bg-gray-700 hover:bg-gray-800 text-white rounded-xl h-10'
                disabled={isSubmitting}
              >
                {isSubmitting
                  ? lt("验证中...", "Verifying...")
                  : lt("验证验证码", "Verify code")}
              </Button>
            </div>
          )}

          {step === "reset" && (
            <div className='space-y-4'>
              <div>
                <h3 className='text-lg font-medium text-gray-900 mb-2'>
                  {lt("重置密码", "Reset password")}
                </h3>
                <p className='text-sm text-gray-600 mb-4'>
                  {lt("请设置您的新密码", "Please set your new password")}
                </p>
              </div>

              <Input
                placeholder={lt("请输入新密码", "Enter new password")}
                type='password'
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoFocus
              />

              <Input
                placeholder={lt(
                  "请再次输入新密码",
                  "Re-enter new password"
                )}
                type='password'
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />

              {error && <div className='text-red-500 text-sm'>{error}</div>}

              <Button
                onClick={handleResetPassword}
                className='w-full bg-gray-700 hover:bg-gray-800 text-white rounded-xl h-10'
                disabled={isSubmitting}
              >
                {isSubmitting
                  ? lt("重置中...", "Resetting...")
                  : lt("重置密码", "Reset password")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
