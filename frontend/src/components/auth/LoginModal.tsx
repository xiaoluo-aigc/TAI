import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/stores/authStore';
import { tokenRefreshManager } from '@/services/tokenRefreshManager';
import { Eye, EyeOff, Loader2, X } from 'lucide-react';
import { authApi } from '@/services/authApi';
import { useTranslation } from 'react-i18next';

type LoginModalProps = {
  onSuccess?: () => void;
};

type LoginTab = 'password' | 'sms';

export default function LoginModal({ onSuccess }: LoginModalProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<LoginTab>('password');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sendCooldown, setSendCooldown] = useState(0);

  const { login, loginWithSms, error: authError } = useAuthStore();

  useEffect(() => {
    const handleAuthExpired = () => {
      setTab('password');
      setIsOpen(true);
    };

    window.addEventListener('auth-expired', handleAuthExpired);
    return () => window.removeEventListener('auth-expired', handleAuthExpired);
  }, []);

  useEffect(() => {
    const unsubscribe = tokenRefreshManager.subscribe((event) => {
      if (event === 'login-required') {
        setTab('password');
        setIsOpen(true);
      }
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setTab('password');
    setLocalError(null);
    setPhone('');
    setPassword('');
    setShowPassword(false);
    setCode('');
    setSendCooldown(0);
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    setLocalError(null);
    setIsSubmitting(true);

    try {
      if (tab === 'password') {
        await login(phone, password);
      } else {
        await loginWithSms(phone, code);
      }

      tokenRefreshManager.onLoginSuccess();
      handleClose();
      onSuccess?.();
    } catch (err: any) {
      setLocalError(err?.message || t('auth.modal.loginFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }, [handleClose, login, loginWithSms, onSuccess, tab, phone, password, code, t]);

  const sendSmsCode = useCallback(async (targetPhone: string) => {
    if (sendCooldown > 0) return;
    if (!targetPhone) {
      window.dispatchEvent(new CustomEvent('toast', { detail: { message: t('auth.login.phoneRequired'), type: 'error' } }));
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(targetPhone)) {
      window.dispatchEvent(new CustomEvent('toast', { detail: { message: t('auth.login.phoneInvalid'), type: 'error' } }));
      return;
    }
    try {
      await authApi.sendSms({ phone: targetPhone });
      setLocalError(null);
      window.dispatchEvent(new CustomEvent('toast', { detail: { message: t('auth.login.smsSent'), type: 'success' } }));
      setSendCooldown(60);
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('toast', { detail: { message: err?.message || t('auth.register.sendFailed'), type: 'error' } }));
    }
  }, [sendCooldown, t]);

  useEffect(() => {
    if (sendCooldown <= 0) return;
    const timer = setInterval(() => setSendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [sendCooldown]);

  if (!isOpen) return null;

  const displayError = localError || authError;

  const modalContent = (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <img src="/TAI-logo.png" className="h-8 w-auto" alt="TAI" />
            <span className="text-sm text-slate-500">{t('auth.modal.expiredTitle')}</span>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        <div className="px-6 pt-4">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
            {t('auth.modal.expiredHint')}
          </div>
        </div>

        <div className="p-6">
          <div className="flex gap-6 mb-6 text-sm">
            <button
              type="button"
              className={
                tab === 'password'
                  ? 'text-gray-700 font-semibold'
                  : 'text-slate-400 hover:text-slate-600'
              }
              onClick={() => {
                setLocalError(null);
                setTab('password');
              }}
            >
              {t('auth.login.passwordTab')}
            </button>
            <button
              type="button"
              className={
                tab === 'sms'
                  ? 'text-gray-700 font-semibold'
                  : 'text-slate-400 hover:text-slate-600'
              }
              onClick={() => {
                setLocalError(null);
                setTab('sms');
              }}
            >
              {t('auth.login.smsTab')}
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              placeholder={t('auth.login.phonePlaceholder')}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              autoFocus
            />

            {tab === 'password' ? (
              <div className="relative">
                <Input
                  placeholder={t('auth.login.passwordPlaceholder')}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  placeholder={t('auth.login.codePlaceholder')}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
                <Button
                  type="button"
                  variant="outline"
                  className="whitespace-nowrap flex-shrink-0 min-w-[64px] rounded-xl"
                  onClick={() => void sendSmsCode(phone)}
                  disabled={sendCooldown > 0}
                >
                  {sendCooldown > 0
                    ? t('auth.login.resendCode', { seconds: sendCooldown })
                    : t('auth.login.sendCode')}
                </Button>
              </div>
            )}

            {displayError && (
              <div className="text-red-500 text-sm">{displayError}</div>
            )}

            <Button
              type="submit"
              className="w-full bg-gray-700 hover:bg-gray-800 text-white rounded-xl"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('auth.login.submitting')}
                </>
              ) : (
                t('auth.modal.relogin')
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
