import React from 'react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useTranslation } from 'react-i18next';

interface AppLoaderProps {
  message?: string;
  showLogo?: boolean;
}

export const AppLoader: React.FC<AppLoaderProps> = ({
  message,
  showLogo = true
}) => {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const displayMessage = message ?? (isZh ? '加载中...' : 'Loading...');

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-white">
      <div className="flex flex-col items-center gap-6">
        {showLogo && (
          <img
            src="/TAI-logo.png"
            className="h-12 w-auto sm:h-16"
            alt="TAI"
          />
        )}
        <LoadingSpinner size="lg" message={displayMessage} />
      </div>
    </div>
  );
};
