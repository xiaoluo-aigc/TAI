import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useRef, useState, useEffect, useCallback } from "react";
import GlassButton from "@/components/GlassButton";
import { useAuthStore } from "@/stores/authStore";
import { MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import WelcomeShaderBackground from "@/components/background/WelcomeShaderBackground";

// 微信咨询悬浮按钮组件
const WeChatFloatingButton = () => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [qrCodes, setQrCodes] = useState<{ officialAccount: string; wechatGroup: string }>({
    officialAccount: '/qrcode-official.png',
    wechatGroup: '/qrcode-group.png',
  });

  // 从后端获取二维码配置
  useEffect(() => {
    const fetchQrCodes = async () => {
      try {
        const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || 'http://localhost:4000';
        const response = await fetch(`${API_BASE}/api/settings/wechat-qrcodes`);
        if (response.ok) {
          const data = await response.json();
          if (data.officialAccount) setQrCodes(prev => ({ ...prev, officialAccount: data.officialAccount }));
          if (data.wechatGroup) setQrCodes(prev => ({ ...prev, wechatGroup: data.wechatGroup }));
        }
      } catch (_e) {
        // 使用默认图片
      }
    };
    fetchQrCodes();
  }, []);

  return (
    <div
      className="fixed bottom-6 right-6 z-50"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      {/* 二维码弹出面�?*/}
      {isOpen && (
        <div className="absolute bottom-16 right-0 p-4 rounded-2xl bg-black/80 backdrop-blur-md border border-white/10 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex gap-4">
            <div className="flex flex-col items-center">
              <div className="w-32 h-32 bg-white rounded-lg p-2 mb-2">
                <img
                  src={qrCodes.officialAccount}
                  alt={t("home.wechat.followOfficial")}
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23f0f0f0" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23999" font-size="12">${encodeURIComponent(t("home.wechat.noImage"))}</text></svg>`;
                  }}
                />
              </div>
              <span className="text-xs text-white/80">{t("home.wechat.followOfficial")}</span>
            </div>
            <div className="flex flex-col items-center">
              <div className="w-32 h-32 bg-white rounded-lg p-2 mb-2">
                <img
                  src={qrCodes.wechatGroup}
                  alt={t("home.wechat.joinGroup")}
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23f0f0f0" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23999" font-size="12">${encodeURIComponent(t("home.wechat.noImage"))}</text></svg>`;
                  }}
                />
              </div>
              <span className="text-xs text-white/80">{t("home.wechat.joinGroup")}</span>
            </div>
          </div>
        </div>
      )}

      {/* 悬浮按钮 */}
      <button
        className="w-12 h-12 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/10 shadow-lg flex items-center justify-center transition-all duration-300 hover:scale-110"
      >
        <MessageCircle className="w-6 h-6 text-white" />
      </button>
    </div>
  );
};

export default function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const connection = useAuthStore((s) => s.connection);
  const initAuth = useAuthStore((s) => s.init);
  const authInitializing = useAuthStore((s) => s.initializing);
  const containerRef = useRef<HTMLDivElement>(null);
  const authInitRef = useRef(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const touchStartY = useRef(0);
  const lastScrollTime = useRef(0);

  // 暂时只允许第一页，禁用后两�?
  const maxPage = 0;

  // 首页为公开路由，手动触发一次认证初始化，确保已登录用户回到首页时能实时显示在线状�?
  useEffect(() => {
    if (authInitRef.current || user || authInitializing) return;
    authInitRef.current = true;
    initAuth().catch(() => {});
  }, [user, authInitializing, initAuth]);

  // 切换到指定页�?
  const goToPage = useCallback(
    (page: number) => {
      if (isAnimating || page < 0 || page > maxPage) return;
      setIsAnimating(true);
      setCurrentPage(page);
      setTimeout(() => setIsAnimating(false), 600);
    },
    [isAnimating]
  );

  // 处理滚轮事件
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      // 第三页不限制滚动
      if (currentPage === 2) return;

      const now = Date.now();
      if (now - lastScrollTime.current < 800) return;

      if (Math.abs(e.deltaY) > 30) {
        e.preventDefault();
        lastScrollTime.current = now;

        if (e.deltaY > 0 && currentPage < maxPage) {
          goToPage(currentPage + 1);
        } else if (e.deltaY < 0 && currentPage > 0) {
          goToPage(currentPage - 1);
        }
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener("wheel", handleWheel, { passive: false });
    }
    return () => {
      if (container) {
        container.removeEventListener("wheel", handleWheel);
      }
    };
  }, [currentPage, goToPage]);

  // 处理触摸事件（移动端�?
  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      touchStartY.current = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (currentPage === 2) return;

      const deltaY = touchStartY.current - e.changedTouches[0].clientY;
      if (Math.abs(deltaY) > 50) {
        if (deltaY > 0 && currentPage < maxPage) {
          goToPage(currentPage + 1);
        } else if (deltaY < 0 && currentPage > 0) {
          goToPage(currentPage - 1);
        }
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener("touchstart", handleTouchStart);
      container.addEventListener("touchend", handleTouchEnd);
    }
    return () => {
      if (container) {
        container.removeEventListener("touchstart", handleTouchStart);
        container.removeEventListener("touchend", handleTouchEnd);
      }
    };
  }, [currentPage, goToPage]);

  return (
    <div
      ref={containerRef}
      className='h-screen w-full overflow-hidden bg-gradient-to-b from-white to-sky-50 text-slate-800'
    >
      {/* 固定�?Header - 完整横条，向中间收缩 */}
      <header className='fixed top-4 left-0 right-0 z-50 pointer-events-none flex justify-center'>
        <div className='flex items-center justify-between gap-4 px-6 md:px-8 py-3 h-[60px] rounded-[999px] bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass transition-all duration-300 pointer-events-auto max-w-4xl w-full mx-4'>
          {/* 左侧：Logo */}
          <div className='flex items-center'>
            <div
              className='flex w-[92px] h-[32px] items-center justify-center cursor-pointer hover:opacity-80 transition-opacity select-none'
              onClick={() => navigate("/")}
            >
              <img
                src='/TAI-logo.png'
                alt='TAI'
                draggable='false'
                className='h-8 w-auto object-contain'
                style={{
                  imageRendering: "auto",
                  WebkitFontSmoothing: "antialiased",
                }}
              />
            </div>
          </div>

          {/* 右侧：用户信息或登录/注册按钮（与设置弹窗使用相同�?connection 状态） */}
          <div className='flex items-center gap-3'>
            <LanguageSwitcher tone='dark' style='simple' />
            {user ? (
              (() => {
                const status = (() => {
                  switch (connection) {
                    case "server":
                      return { label: t("common.status.online"), color: "#16a34a" };
                    case "refresh":
                      return { label: t("common.status.refreshed"), color: "#f59e0b" };
                    case "local":
                      return { label: t("common.status.online"), color: "#16a34a" };
                    case "mock":
                      return { label: t("common.status.mock"), color: "#8b5cf6" };
                    default:
                      return null;
                  }
                })();

                return (
                  <div className='flex items-center gap-3 text-sm text-white'>
                    <span>
                      {t("home.header.greeting", {
                        name:
                          user.name ||
                          user.phone?.slice(-4) ||
                          user.email ||
                          user.id?.slice(-4) ||
                          t("common.user"),
                      })}
                    </span>
                    <span
                      className='inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-white/30 text-white bg-green-500/20 backdrop-blur-sm'
                      title={`${status?.label || t("common.status.unknown")}`}
                    >
                      <span
                        className='w-2 h-2 rounded-full'
                        style={{ background: status?.color }}
                      />
                      {status?.label}
                    </span>
                    <Button
                      variant='ghost'
                      className='text-white hover:text-white/80 hover:bg-white/10 rounded-full h-8 px-3 text-sm border border-white/20'
                      onClick={async () => {
                        try {
                          await logout();
                          navigate("/auth/login", { replace: true });
                        } catch (error) {
                          console.error("退出登录失�?", error);
                        }
                      }}
                    >
                      {t("home.header.actions.logout")}
                    </Button>
                  </div>
                );
              })()
            ) : (
              <>
                <Button
                  variant='ghost'
                  className='text-white hover:text-white/80 hover:bg-white/10 rounded-full h-9 px-4 text-sm font-medium'
                  onClick={() => navigate("/auth/login")}
                >
                  {t("home.header.actions.login")}
                </Button>
                <Button
                  className='bg-white/20 hover:bg-white/30 text-white border border-white/20 rounded-full h-9 px-4 text-sm font-medium'
                  onClick={() => navigate("/auth/register")}
                >
                  {t("home.header.actions.register")}
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* 页面指示�?- 暂时隐藏 */}
      <div className='hidden fixed right-6 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-3'>
        {[0].map((i) => (
          <button
            key={i}
            onClick={() => goToPage(i)}
            className={`w-3 h-3 rounded-full transition-all duration-300 ${
              currentPage === i
                ? "bg-gray-700 scale-125"
                : "bg-gray-300 hover:bg-gray-400"
            }`}
          />
        ))}
      </div>

      {/* 三页内容容器 */}
      <div
        className='transition-transform duration-500 ease-out'
        style={{ transform: `translateY(-${currentPage * 100}vh)` }}
      >
        {/* 第一�?- 主标�?*/}
        <section className='h-screen w-full flex flex-col items-center justify-center px-4 relative overflow-hidden'>
          {/* 视频背景 */}
          <WelcomeShaderBackground className='z-[1]' />
          <div className='absolute inset-0 z-[2] bg-black/35' />

          <div className='text-center relative z-10'>
            <h1
              className='mx-auto select-none text-[clamp(5rem,15vw,10rem)] font-black leading-none tracking-[0.08em] text-white drop-shadow-[0_12px_32px_rgba(0,0,0,0.55)]'
              aria-label={t("home.hero.logoAlt")}
            >
              TAI
            </h1>
            <p className='text-xl text-slate-200 mb-12 drop-shadow-md'>
              {t("home.hero.subtitle")}
            </p>
            <GlassButton onClick={() => navigate("/app")}>{t("home.hero.startNow")}</GlassButton>
          </div>
          {/* 向下滚动提示 */}
          <div className='absolute bottom-12 animate-bounce z-10'>
            <svg
              className='w-6 h-6 text-white drop-shadow-md'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M19 14l-7 7m0 0l-7-7m7 7V3'
              />
            </svg>
          </div>

          {/* 备案�?*/}
          <div className='absolute bottom-4 left-4 z-10'>
            <a
              href='https://beian.miit.gov.cn/'
              target='_blank'
              rel='noopener noreferrer'
              className='text-xs text-white/60 hover:text-white/80 transition-colors'
            >
              {t("home.icp")}
            </a>
          </div>
        </section>

        {/* 第二�?- 功能介绍 */}
        <section className='h-screen w-full flex flex-col items-center justify-center px-4 bg-gradient-to-b from-sky-50 to-white'>
          <div className='max-w-4xl mx-auto text-center'>
            <h2 className='text-4xl font-bold mb-12'>{t("home.features.title")}</h2>
            <div className='grid grid-cols-1 md:grid-cols-3 gap-8'>
              <div className='p-6 rounded-2xl bg-white shadow-lg'>
                <div className='w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-4'>
                  <svg
                    className='w-6 h-6 text-blue-600'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z'
                    />
                  </svg>
                </div>
                <h3 className='text-lg font-semibold mb-2'>{t("home.features.aiTitle")}</h3>
                <p className='text-slate-600 text-sm'>
                  {t("home.features.aiDesc")}
                </p>
              </div>
              <div className='p-6 rounded-2xl bg-white shadow-lg'>
                <div className='w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mx-auto mb-4'>
                  <svg
                    className='w-6 h-6 text-green-600'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z'
                    />
                  </svg>
                </div>
                <h3 className='text-lg font-semibold mb-2'>{t("home.features.drawingTitle")}</h3>
                <p className='text-slate-600 text-sm'>
                  {t("home.features.drawingDesc")}
                </p>
              </div>
              <div className='p-6 rounded-2xl bg-white shadow-lg'>
                <div className='w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center mx-auto mb-4'>
                  <svg
                    className='w-6 h-6 text-purple-600'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01'
                    />
                  </svg>
                </div>
                <h3 className='text-lg font-semibold mb-2'>{t("home.features.styleTitle")}</h3>
                <p className='text-slate-600 text-sm'>
                  {t("home.features.styleDesc")}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 第三�?- CTA �?Footer */}
        <section className='min-h-screen w-full flex flex-col bg-gradient-to-b from-white to-sky-50'>
          <div className='flex-1 flex flex-col items-center justify-center px-4'>
            <div className='mist-card-wrapper w-full sm:w-[800px] mx-auto'>
              <div className='mist-glow'></div>
              <div className='mist-layer-1'></div>
              <div className='mist-layer-2'></div>
              <div className='w-full border rounded-xl py-16 px-12 hover:shadow transition text-center mist-card'>
                <div className='mist-content'>
                  <h3 className='text-2xl font-semibold mb-4'>
                    {t("home.cta.ready")}
                  </h3>
                  <p className='text-slate-600 mb-8'>
                    {t("home.cta.desc")}
                  </p>
                  <Button
                    className='bg-gray-700 hover:bg-gray-500 text-white rounded-2xl h-12 px-8 text-lg'
                    onClick={() => navigate("/app")}
                  >
                    {t("home.cta.start")}
                  </Button>
                </div>
              </div>
            </div>
          </div>
          <footer className='border-t py-6 text-center text-sm text-slate-500'>
            © {new Date().getFullYear()} TAI · v1.0.0
          </footer>
        </section>
      </div>

      {/* 微信咨询悬浮按钮 - 放在最外层确保始终可见 */}
      <WeChatFloatingButton />
    </div>
  );
}

