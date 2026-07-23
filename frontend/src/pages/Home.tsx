import { useNavigate } from "react-router-dom";
import {
  useRef,
  useState,
  useEffect,
  useMemo,
  useCallback,
  type TransitionEvent,
} from "react";
import { useAuthStore } from "@/stores/authStore";
import { ChevronLeft, ChevronRight, Clock, MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import WelcomeShaderBackground from "@/components/background/WelcomeShaderBackground";
import EventSettingsModalHost from "@/components/home/EventSettingsModalHost";
import MembershipModal from "@/components/home/MembershipModal";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import titleImage from "@/assets/title.png";
import logoImage from "@/assets/logo.png";
import leftIconImage from "@/assets/left-icon.png";
import rightIconImage from "@/assets/right-icon.png";
import wechatIconImage from "@/assets/wechat.png";
import xhsIconImage from "@/assets/xhs.png";
import dyIconImage from "@/assets/dy.png";
import wxErweimaImage from "@/assets/wx-erweima.jpg";
import xhsErweimaImage from "@/assets/xhs-erweima.jpg";
import dyErweimaImage from "@/assets/dy-erweima.jpg";
import toolboxWxhbIcon from "@/assets/wxhb.png";
import toolboxChatIcon from "@/assets/chat.png";
import toolboxZnjdIcon from "@/assets/znjd.png";
import toolboxXthzIcon from "@/assets/xthz.png";
import SmartNode from "@/assets/smart-node.png";
import InfiniteCanvas from "@/assets/infinite-canvas.png";
import AIAssistant from "@/assets/assistant.png";
import Chatbot from "@/assets/chatbot.png";
import BoxIcon1 from "@/assets/box1.jpg";
import BoxIcon2 from "@/assets/box2.jpg";
import BoxIcon3 from "@/assets/box3.png";
import Qrcode from "@/assets/group-erweima.jpg";
import gzhImg from "@/assets/gzh.png";


const FEATURE_CARD_IMAGES = [
  BoxIcon1,
  BoxIcon2,
  BoxIcon3,
];

const TOOLBOX_IMAGES = [InfiniteCanvas, Chatbot, SmartNode, AIAssistant];

type SceneFilterKey =
  | "all" 
  | "architecture"
  | "education"
  | "career"
  | "skills"
  | "online"
  | "corporate";

const SCENE_FILTER_KEYS: SceneFilterKey[] = [
  "all",
  "architecture",
  "education",
  "career",
  "skills",
  "online",
  "corporate",
];

const SCENE_CATEGORY_DIRS: Record<Exclude<SceneFilterKey, "all">, string> = {
  architecture: "城市规划",
  education: "建筑设计",
  career: "室内设计",
  skills: "园林景观",
  online: "教育培训",
  corporate: "创意设计",
};

const sceneImageModules = import.meta.glob<string>(
  "../assets/*/*.{png,jpg,jpeg,webp}",
  { eager: true, import: "default" },
);

const SCENE_IMAGE_LOOKUP = (() => {
  const lookup = new Map<string, string>();
  for (const [path, url] of Object.entries(sceneImageModules)) {
    const match = path.match(/\/assets\/([^/]+)\/([^/]+)\.(png|jpe?g|webp)$/i);
    if (!match) continue;
    lookup.set(`${match[1]}/${match[2]}`, url);
  }
  return lookup;
})();

const SCENE_MAX_ITEMS_PER_CATEGORY = 10;
const SCENE_MAX_ITEMS_ALL = 10;

const resolveSceneImage = (
  category: Exclude<SceneFilterKey, "all">,
  imageKey: string,
) => {
  const dir = SCENE_CATEGORY_DIRS[category];
  return SCENE_IMAGE_LOOKUP.get(`${dir}/${imageKey}`) ?? "";
};

type ToolboxIconKey = "wxhb" | "chat" | "znjd" | "xthz";

const TOOLBOX_ICON_MAP: Record<ToolboxIconKey, string> = {
  wxhb: toolboxWxhbIcon,
  chat: toolboxChatIcon,
  znjd: toolboxZnjdIcon,
  xthz: toolboxXthzIcon,
};

const TOOLBOX_CENTER_W = 810;
const TOOLBOX_CENTER_H = 494;
const TOOLBOX_SIDE_W = 623;
const TOOLBOX_CENTER_IMG_CLASS = "h-[min(334px,calc((100vw-48px)*334/810))]";
const TOOLBOX_CENTER_CLASS =
  "h-[min(494px,calc((100vw-48px)*494/810))] w-[min(810px,calc(100vw-48px))]";
const TOOLBOX_SIDE_SCALE = TOOLBOX_SIDE_W / TOOLBOX_CENTER_W;
const TOOLBOX_SLIDE_TRANSITION_MS = 600;

const getToolboxSlideProgress = (
  index: number,
  position: number,
  total: number,
) => {
  if (total <= 1) return index === Math.round(position) ? 0 : 99;
  let diff = index - position;
  const half = total / 2;
  if (diff > half) diff -= total;
  if (diff < -half) diff += total;
  return diff;
};

const getToolboxSlideScale = (progress: number) => {
  const abs = Math.min(Math.abs(progress), 1);
  return 1 - abs * (1 - TOOLBOX_SIDE_SCALE);
};

const getToolboxSlideOpacity = (progress: number) => {
  const abs = Math.abs(progress);
  if (abs > 1.4) return 0;
  if (abs <= 1) return 1 - abs * 0.16;
  return Math.max(0, 1 - (abs - 1) * 2.5);
};

const getToolboxShortestStep = (
  from: number,
  to: number,
  total: number,
) => {
  if (total <= 1) return 0;
  let diff = to - from;
  while (diff > total / 2) diff -= total;
  while (diff < -total / 2) diff += total;
  return diff;
};

const normalizeToolboxPosition = (position: number, total: number) => {
  if (total <= 0) return 0;
  let normalized = Math.round(position) % total; 
  if (normalized < 0) normalized += total;
  return normalized;
};

const SCENE_FILTER_BTN_CLASS =
  "rounded-full px-4 py-1.5 text-sm transition-all duration-200";
const SCENE_FILTER_BTN_HOVER_CLASS =
  "hover:bg-[#0d1b3d] hover:text-white hover:shadow-[0_0_15px_2px_rgba(37,99,235,0.7)]";

const BTN_OUTLINE_GOLD_CLASS =
  "inline-flex items-center rounded-full border border-amber-500/65 bg-amber-500/[0.08] px-4 py-[4px] text-[12px] text-[#B26B35] transition-colors duration-200 hover:border-amber-300/85 hover:bg-amber-500/[0.16] leading-[120%]";

const BTN_LOGIN_CLASS =
  "rounded-full bg-gradient-to-br from-blue-700 via-blue-600 to-blue-800 px-[16px] py-[4px] text-[13px] text-white shadow-[0_0_16px_rgba(37,99,235,0.35)] transition-all duration-200";

const CTA_BTN_ORANGE_CLASS =
  "group inline-flex items-center justify-center rounded-full border border-orange-300/35 bg-gradient-to-r from-[rgba(194,98,32,0.1)] to-[rgba(234,120,40,0.6)] text-white min-w-[160px] h-[40px] px-6 text-[16px]";

const WeChatFloatingButton = () => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [qrCodes, setQrCodes] = useState<{
    officialAccount: string;
    wechatGroup: string;
  }>({
    officialAccount: "/qrcode-official.png",
    wechatGroup: "/group-erweima.jpg",
  });

  useEffect(() => {
    const fetchQrCodes = async () => {
      try {
        const API_BASE =
          (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
          "http://localhost:4000";
        const response = await fetch(`${API_BASE}/api/settings/wechat-qrcodes`);
        if (response.ok) {
          const data = await response.json();
          if (data.officialAccount)
            setQrCodes((prev) => ({
              ...prev,
              officialAccount: data.officialAccount,
            }));
          if (data.wechatGroup)
            setQrCodes((prev) => ({ ...prev, wechatGroup: data.wechatGroup }));
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
      {isOpen && (
        <div className="absolute bottom-[calc(100%+12px)] right-0 rounded-2xl border border-white/10 bg-black/80 p-4 shadow-2xl backdrop-blur-md duration-300 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex gap-4">
            <div className="flex flex-col items-center">
              <div className="mb-2 h-32 w-32 rounded-lg bg-white p-2">
                <img
                  src={gzhImg}
                  alt={t("home.wechat.taiOfficialAccount")}
                  className="h-full w-full"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src =
                      `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23f0f0f0" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23999" font-size="12">${encodeURIComponent(t("home.wechat.noImage"))}</text></svg>`;
                  }}
                />
              </div>
              <span className="text-xs text-white/80">
                {t("home.wechat.taiOfficialAccount")}
              </span>
            </div>
            <div className="flex flex-col items-center">
              <div className="mb-2 h-32 w-32 rounded-lg bg-white p-2">
                <img
                  src={Qrcode}
                  alt={t("home.wechat.taiLearningGroup")}
                  className="h-full w-full"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src =
                      `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23f0f0f0" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23999" font-size="12">${encodeURIComponent(t("home.wechat.noImage"))}</text></svg>`;
                  }}
                />
              </div>
              <span className="text-xs text-white/80">
                {t("home.wechat.taiLearningGroup")}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="flex cursor-default items-center gap-2.5 rounded-full border border-white/10 bg-black/60 py-2 pl-4 pr-3 shadow-lg backdrop-blur-md transition-all duration-300 hover:bg-black/80">
        <span className="select-none text-sm text-white/85 transition-colors duration-200">
          {t("home.footer.contact")}
        </span>
        <MessageCircle className="h-5 w-5 shrink-0 text-white" aria-hidden />
      </div>
    </div>
  );
};

const FOOTER_QR_POPUP_WIDTH = 180;

const FooterSocialIcon = ({
  icon,
  label,
  qrCode,
}: {
  icon: string;
  label: string;
  qrCode: string;
}) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className="relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <button
        type="button"
        aria-label={label}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-white/80 transition-colors duration-200 hover:bg-white/10 hover:text-white"
      >
        <img src={icon} alt="" className="h-full w-full object-contain" />
      </button>

      <div
        className={cn(
          "absolute bottom-[calc(100%+10px)] left-1/2 z-20 -translate-x-1/2 transition-all duration-300 ease-out",
          isHovered
            ? "pointer-events-auto visible translate-y-0 scale-100 opacity-100"
            : "pointer-events-none invisible translate-y-2 scale-95 opacity-0",
        )}
        style={{ width: FOOTER_QR_POPUP_WIDTH }}
      >
        <div className="rounded-xl border border-white/10 bg-black/80 p-2 shadow-2xl backdrop-blur-md">
          <div className="overflow-hidden rounded-lg bg-white p-2">
            <img src={qrCode} alt="" className="block h-auto w-full" />
          </div>
        </div>
      </div>
    </div>
  );
};

function getConnectionDotClass(connection: string | null): string {
  switch (connection) {
    case "server":
    case "local":
      return "bg-green-600";
    case "refresh":
      return "bg-amber-500";
    case "mock":
      return "bg-violet-500";
    default:
      return "bg-white/50";
  }
}

export default function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const connection = useAuthStore((s) => s.connection);
  const initAuth = useAuthStore((s) => s.init);
  const authInitializing = useAuthStore((s) => s.initializing);
  const authInitRef = useRef(false);
  const [activeCard, setActiveCard] = useState(0);
  const [toolboxSlidePos, setToolboxSlidePos] = useState(0);
  const [membershipModalOpen, setMembershipModalOpen] = useState(false);
  const [activeSceneFilter, setActiveSceneFilter] =
    useState<SceneFilterKey>("all");

  const openLinglongEntry = useCallback(() => {
    navigate("/app");
  }, [navigate]);

  const featureCards = useMemo(
    () =>
      (
        t("home.features.cards", { returnObjects: true }) as Array<{
          category: string;
          title: string;
          desc: string;
        }>
      ).map((card, index) => ({
        ...card,
        image: FEATURE_CARD_IMAGES[index] ?? FEATURE_CARD_IMAGES[0],
      })),
    [t],
  );

  const toolboxItems = useMemo(
    () =>
      (
        t("home.toolbox.items", { returnObjects: true }) as Array<{
          title: string;
          titleEn: string;
          desc: string;
          duration: string;
          icon: ToolboxIconKey;
        }>
      ).map((item, index) => ({
        ...item,
        image: TOOLBOX_IMAGES[index] ?? TOOLBOX_IMAGES[0],
      })),
    [t],
  );

  const sceneItems = useMemo(() => {
    const categoryCount = new Map<Exclude<SceneFilterKey, "all">, number>();

    return (
      t("home.scenes.items", { returnObjects: true }) as Array<{
        title: string;
        imageKey?: string;
        category: Exclude<SceneFilterKey, "all">;
      }>
    )
      .map((item) => ({
        ...item,
        image: resolveSceneImage(item.category, item.imageKey ?? item.title),
      }))
      .filter((item) => {
        if (!item.image) return false;
        const count = categoryCount.get(item.category) ?? 0;
        if (count >= SCENE_MAX_ITEMS_PER_CATEGORY) return false;
        categoryCount.set(item.category, count + 1);
        return true;
      });
  }, [t]);

  const filteredSceneItems = useMemo(() => {
    const items =
      activeSceneFilter === "all"
        ? sceneItems
        : sceneItems.filter((item) => item.category === activeSceneFilter);

    const limit =
      activeSceneFilter === "all"
        ? SCENE_MAX_ITEMS_ALL
        : SCENE_MAX_ITEMS_PER_CATEGORY;

    return items.slice(0, limit);
  }, [activeSceneFilter, sceneItems]);

  useEffect(() => {
    if (authInitRef.current || user || authInitializing) return;
    authInitRef.current = true;
    initAuth().catch(() => {});
  }, [user, authInitializing, initAuth]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveCard((prev) => (prev + 1) % featureCards.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [featureCards.length]);

  const activeToolbox = useMemo(
    () => normalizeToolboxPosition(toolboxSlidePos, toolboxItems.length),
    [toolboxSlidePos, toolboxItems.length],
  );

  const goToToolbox = useCallback(
    (index: number) => {
      setToolboxSlidePos((pos) => {
        const total = toolboxItems.length;
        if (total <= 1) return 0;
        return pos + getToolboxShortestStep(pos, index, total);
      });
    },
    [toolboxItems.length],
  );

  const goToolboxPrev = useCallback(() => {
    setToolboxSlidePos((prev) => prev - 1);
  }, []);

  const goToolboxNext = useCallback(() => {
    setToolboxSlidePos((prev) => prev + 1);
  }, []);

  const handleToolboxSlideTransitionEnd = useCallback(
    (event: TransitionEvent<HTMLDivElement>) => {
      if (event.propertyName !== "transform") return;
      setToolboxSlidePos((pos) =>
        normalizeToolboxPosition(pos, toolboxItems.length),
      );
    },
    [toolboxItems.length],
  );

  useEffect(() => {
    const timer = window.setInterval(goToolboxNext, 6000);
    return () => window.clearInterval(timer);
  }, [goToolboxNext]);

  const requireAuthNavigate = useCallback(
    (path: string) => {
      if (user) {
        navigate(path);
        return;
      }
      navigate("/auth/login", { state: { from: path } });
    },
    [navigate, user],
  );

  const scrollToToolbox = useCallback(() => {
    document.getElementById("toolbox")?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const scrollToScenes = useCallback(() => {
    document.getElementById("scenes")?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const openMembershipModal = useCallback(() => {
    setMembershipModalOpen(true);
  }, []);

  const connectionStatus = (() => {
    switch (connection) {
      case "server":
        return {
          label: t("common.status.online"),
          dotClass: getConnectionDotClass("server"),
        };
      case "refresh":
        return {
          label: t("common.status.refreshed"),
          dotClass: getConnectionDotClass("refresh"),
        };
      case "local":
        return {
          label: t("common.status.online"),
          dotClass: getConnectionDotClass("local"),
        };
      case "mock":
        return {
          label: t("common.status.mock"),
          dotClass: getConnectionDotClass("mock"),
        };
      default:
        return null;
    }
  })();

  return (
    <div className="relative h-screen w-screen overflow-x-hidden overflow-y-auto scrollbar-hidden text-white">
      <WelcomeShaderBackground className="z-0" />
      <div className="pointer-events-none fixed inset-0 z-[1] bg-[#020818]/30" />

      <header className="fixed left-0 right-0 top-0 z-50">
        <div className="mx-auto flex h-14 w-[1440px] items-center justify-between border border-white/[0.06] bg-[#020818]/55 backdrop-blur-md rounded-[10px] px-[48px] mt-[20px]">
          <button
            type="button"
            className="flex gap-[10px] h-8 select-none items-center transition-opacity hover:opacity-85"
            onClick={() => navigate("/")}
          >
            <img
              src="/TAI-logo.png"
              alt="TAI"
              draggable={false}
              className="h-8 w-auto"
            />
            <span className="text-sm text-white/70">
              {t("home.footer.brandSuffix")}
            </span>
          </button>

          <div className="flex items-center gap-2 sm:gap-3">
            <LanguageSwitcher tone="dark" style="simple" compact />
            {user ? (
              <div className="flex items-center gap-2 text-sm sm:gap-3">
                <span className="hidden text-white/80 sm:inline">
                  {t("home.header.greeting", {
                    name:
                      user.name ||
                      user.phone?.slice(-4) ||
                      user.email ||
                      user.id?.slice(-4) ||
                      t("common.user"),
                  })}
                </span>
                {connectionStatus && (
                  <span
                    className="hidden items-center gap-1.5 rounded-full border border-white/20 px-2 py-1 text-xs text-white/90 md:inline-flex"
                    title={connectionStatus.label}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        connectionStatus.dotClass,
                      )}
                    />
                    {connectionStatus.label}
                  </span>
                )}
                <button
                  type="button"
                  className={cn(
                    BTN_OUTLINE_GOLD_CLASS,
                    "hidden sm:inline-flex",
                  )}
                  onClick={openMembershipModal}
                >
                  {t("home.header.actions.membership")}
                </button>
                <button
                  type="button"
                  className="px-2 text-sm text-white/70 transition-colors hover:text-white"
                  onClick={async () => {
                    try {
                      await logout();
                      navigate("/auth/login", { replace: true });
                    } catch (error) {
                      console.error("退出登录失败", error);
                    }
                  }}
                >
                  {t("home.header.actions.logout")}
                </button>
              </div>
            ) : (
              <div className="flex items-center bg-[#14181F] rounded-[20px]">
                  <button
                    type="button"
                    className="px-2 text-[12px] text-white/80 transition-colors px-[16px]"
                    onClick={() => navigate("/auth/register")}
                  >
                    {t("home.header.actions.register")}
                  </button>
                  <button
                    type="button"
                    className={BTN_LOGIN_CLASS}
                    onClick={() => navigate("/auth/login")}
                  >
                    {t("home.header.actions.login")}
                  </button>
                </div>
            )}
          </div>
        </div>
      </header>

      <section className="relative z-10 flex min-h-screen w-full flex-col">
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 text-center mt-[100px]">
          <img
            src={titleImage}
            alt={t("home.hero.logoAlt")}
            draggable={false}
            className="h-auto max-w-[600px] select-none [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.4))_drop-shadow(0_0_6px_rgba(100,190,255,0.25))_drop-shadow(0_0_14px_rgba(60,150,255,0.15))]"
          />

          <p className="mb-12 text-[14px] text-white/45">
            {t("home.hero.subtitle")}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={openLinglongEntry}
              className={CTA_BTN_ORANGE_CLASS}
            >
              <span>{t("home.hero.linglongEntry")}</span>
            </button>
          </div>
        </div>

        <div className="relative z-10 mx-auto w-full max-w-[1200px] px-4 pb-10 md:pb-12">
          <div className="flex h-[278px] gap-3 md:gap-4">
            {featureCards.map((card, index) => {
              const isActive = activeCard === index;
              return (
                <button
                  key={card.title}
                  type="button"
                  onClick={() => setActiveCard(index)}
                  className={cn(
                    "group relative overflow-hidden rounded-2xl border border-white/[0.08] text-left transition-[flex,opacity] duration-500 ease-out",
                    isActive
                      ? "flex-[2.2_1_0%] opacity-100"
                      : "flex-[1_1_0%] opacity-[0.72]",
                  )}
                >
                  <img
                    src={card.image}
                    alt=""
                    aria-hidden
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-b from-[#020818]/15 via-[#020818]/55 to-[#020818]/88" />
                  <div className="relative z-10 flex h-full flex-col justify-end p-4 md:p-5">
                    <span className="mb-1 text-[10px] font-medium tracking-[0.2em] text-sky-400 md:text-xs">
                      {card.category}
                    </span>
                    <h3 className="text-lg font-semibold text-white md:text-2xl">
                      {card.title}
                    </h3>
                    {isActive && card.desc && (
                      <p className="mt-1.5 line-clamp-2 text-xs text-white/65 md:text-sm">
                        {card.desc}
                      </p>
                    )}
                    <div className="mt-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/25 bg-white/[0.08] backdrop-blur-sm transition-colors duration-200 group-hover:border-sky-300/50 group-hover:bg-sky-400/20">
                        <ChevronRight className="h-4 w-4 text-white/80" />
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-5 flex items-center justify-center gap-2">
            {featureCards.map((card, index) => (
              <button
                key={`dot-${card.title}`}
                type="button"
                aria-label={card.title}
                onClick={() => setActiveCard(index)}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  activeCard === index
                    ? "w-7 bg-gradient-to-r from-sky-400 to-blue-600 shadow-[0_0_10px_rgba(56,189,248,0.5)]"
                    : "w-2 bg-white/25",
                )}
              />
            ))}
          </div>
        </div>
      </section>

      <section
        id="toolbox"
        className="relative z-10 w-full bg-transparent mt-[100px]"
      >
        <div className="relative z-10 mx-auto w-full max-w-[1200px] px-4">
          <div className="mb-12 flex flex-col items-center text-center md:mb-16">
            <div className="flex items-center justify-center gap-3 sm:gap-4">
              <img
                src={leftIconImage}
                alt=""
                aria-hidden
                className="h-auto w-[20px] shrink-0"
              />
              <h2 className="text-[32px] text-white">
                {t("home.toolbox.title")}
              </h2>
              <img
                src={rightIconImage}
                alt=""
                aria-hidden
                className="h-auto w-[20px] shrink-0"
              />
            </div>

            <p className="mt-4 max-w-xl text-[14px] text-white/80">
              {t("home.toolbox.subtitle")}
            </p>
          </div>

          <div className="relative left-1/2 w-screen -translate-x-1/2 overflow-hidden">
            {(() => {
              const total = toolboxItems.length;
              const arrowBtnClass =
                "pointer-events-auto z-40 flex h-10 w-10 shrink-0 items-center justify-center text-white/75 transition-colors hover:text-white";

              const renderCardInner = (
                item: (typeof toolboxItems)[number],
                isActive: boolean,
              ) => {
                const iconSrc = TOOLBOX_ICON_MAP[item.icon];
                return (
                  <div
                    className={cn(
                      TOOLBOX_CENTER_CLASS,
                      "flex flex-col overflow-hidden rounded-2xl border bg-[#0a1020]/90 shadow-[0_0_30px_rgba(33,75,157,0.12)] backdrop-blur-sm",
                      isActive
                        ? "border-sky-500/40 shadow-[0_0_40px_rgba(33,75,157,0.25)]"
                        : "border-blue-900/35",
                    )}
                  >
                    <div
                      className={cn(
                        "relative shrink-0 overflow-hidden",
                        TOOLBOX_CENTER_IMG_CLASS,
                      )}
                    >
                      <img
                        src={item.image}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#0a1020]/80 via-transparent to-transparent" />
                    </div>
                    <div className="flex min-h-0 flex-1 items-center gap-4 px-5 text-left">
                      <img
                        src={iconSrc}
                        alt=""
                        className="h-[86px] w-[86px] object-contain"
                      />
                      <div className="flex min-w-0 flex-col justify-center">
                        <h3 className="text-lg font-semibold text-white">
                          {item.title}
                        </h3>
                        <p className="mt-1 text-sm text-[rgba(255,255,255,0.6)]">
                          {item.titleEn}
                        </p>
                        <p className="mt-2 text-sm leading-relaxed text-white/45">
                          {item.desc}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              };

              const focusIndex = toolboxItems.reduce(
                (closest, _, index) => {
                  const progress = Math.abs(
                    getToolboxSlideProgress(index, toolboxSlidePos, total),
                  );
                  return progress < closest.progress
                    ? { index, progress }
                    : closest;
                },
                { index: 0, progress: Number.POSITIVE_INFINITY },
              ).index;

              return (
                <div
                  className="relative flex items-center justify-center"
                  style={{ minHeight: TOOLBOX_CENTER_H }}
                >
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{ minHeight: TOOLBOX_CENTER_H }}
                  >
                    {toolboxItems.map((item, index) => {
                      const progress = getToolboxSlideProgress(
                        index,
                        toolboxSlidePos,
                        total,
                      );
                      const scale = getToolboxSlideScale(progress);
                      const opacity = getToolboxSlideOpacity(progress);
                      const isFocus = index === focusIndex;
                      const isSide =
                        !isFocus &&
                        Math.abs(progress) <= 1.05 &&
                        opacity > 0.05;

                      return (
                        <div
                          key={item.title}
                          className={cn(
                            "absolute left-1/2 top-1/2 will-change-transform",
                            !isFocus && !isSide && "pointer-events-none",
                          )}
                          style={{
                            transform: `translate3d(calc(-50% + ${progress * 50}vw), -50%, 0) scale(${scale})`,
                            transition: `transform ${TOOLBOX_SLIDE_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${TOOLBOX_SLIDE_TRANSITION_MS}ms ease-out`,
                            transformOrigin: "center center",
                            zIndex: 30 - Math.round(Math.abs(progress) * 10),
                            opacity,
                          }}
                          onTransitionEnd={
                            index === 0
                              ? handleToolboxSlideTransitionEnd
                              : undefined
                          }
                        >
                          {isFocus ? (
                            renderCardInner(item, true)
                          ) : isSide ? (
                            <button
                              type="button"
                              aria-label={item.title}
                              className="pointer-events-auto block transition-opacity duration-300 hover:opacity-95"
                              onClick={() => goToToolbox(index)}
                            >
                              {renderCardInner(item, false)}
                            </button>
                          ) : (
                            renderCardInner(item, false)
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {total > 1 ? (
                    <div className="pointer-events-none relative z-40 flex items-center justify-center gap-2 sm:gap-4">
                      <button
                        type="button"
                        aria-label={t("home.toolbox.prev")}
                        onClick={goToolboxPrev}
                        className={arrowBtnClass}
                      >
                        <ChevronLeft className="h-6 w-6" />
                      </button>
                      <div
                        className="shrink-0"
                        style={{
                          width: "min(810px, calc(100vw - 48px))",
                          height: 1,
                        }}
                        aria-hidden
                      />
                      <button
                        type="button"
                        aria-label={t("home.toolbox.next")}
                        onClick={goToolboxNext}
                        className={arrowBtnClass}
                      >
                        <ChevronRight className="h-6 w-6" />
                      </button>
                    </div>
                  ) : (
                    toolboxItems[0] && (
                      <div className="relative z-40 flex items-center justify-center">
                        {renderCardInner(toolboxItems[0], true)}
                      </div>
                    )
                  )}
                </div>
              );
            })()}
          </div>

          <div className="mt-8 flex items-center justify-center gap-2">
            {toolboxItems.map((item, index) => (
              <button
                key={`toolbox-dot-${item.title}`}
                type="button"
                aria-label={item.title}
                onClick={() => goToToolbox(index)}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  activeToolbox === index
                    ? "w-7 bg-gradient-to-r from-sky-400 to-blue-600 shadow-[0_0_10px_rgba(56,189,248,0.5)]"
                    : "w-2 bg-white/25",
                )}
              />
            ))}
          </div>
        </div>
      </section>

      <section id="scenes" className="relative z-10 w-full mt-[100px]">
        <div className="relative z-10 mx-auto w-full max-w-[1200px] px-4">
          <div className="mb-10 flex flex-col items-center text-center md:mb-12">
            <div className="flex items-center justify-center gap-3 sm:gap-4">
              <img
                src={leftIconImage}
                alt=""
                aria-hidden
                className="h-auto w-[20px] shrink-0 object-contain"
              />
              <h2 className="text-[32px] text-white">
                {t("home.scenes.title")}
              </h2>
              <img
                src={rightIconImage}
                alt=""
                aria-hidden
                className="h-auto w-[20px] shrink-0 object-contain"
              />
            </div>
            <p className="mt-4 max-w-2xl text-[14px] text-white/80">
              {t("home.scenes.subtitle")}
            </p>
          </div>

          <div className="mb-8 flex items-center justify-between">
            <div className="flex flex-wrap items-center gap-[38px]">
              {SCENE_FILTER_KEYS.map((key) => {
                const isActive = activeSceneFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveSceneFilter(key)}
                    className={cn(
                      SCENE_FILTER_BTN_CLASS,
                      isActive
                        ? "bg-[#2563eb] text-white shadow-[0_0_15px_2px_rgba(37,99,235,0.55)] hover:shadow-[0_0_18px_3px_rgba(37,99,235,0.75)]"
                        : cn("text-white/65", SCENE_FILTER_BTN_HOVER_CLASS),
                    )}
                  >
                    {t(`home.scenes.filters.${key}`)}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => navigate("/app")}
              className="flex shrink-0 items-center gap-1 self-end text-sm text-white/70 transition-colors hover:text-white lg:self-auto"
            >
              <span>{t("home.scenes.more")}</span>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {filteredSceneItems.map((item, index) => (
              <button
                key={`${item.title}-${index}`}
                type="button"
                onClick={() => navigate("/app")}
                className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-white/[0.06] text-left transition-transform duration-300 hover:scale-[1.02]"
              >
                <img
                  src={item.image}
                  alt={item.title}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#020818]/90 via-[#020818]/20 to-transparent" />
                <p className="absolute bottom-0 left-0 right-0 px-2 pb-3 pt-8 text-center text-xs leading-snug text-white sm:text-sm">
                  {item.title}
                </p>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 w-full pt-[106px] pb-[84px]">
        <div className="relative z-10 mx-auto flex max-w-[1200px] flex-col items-center px-4 text-center">
          <img
            src={logoImage}
            alt="TAI"
            draggable={false}
            className="h-auto w-auto max-w-[250px]"
          />
          <p className="text-[14px] text-white/80 mt-[10px]">
            {t("home.ctaBanner.tagline")}
          </p>
          <div className="mt-[22px] flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={openLinglongEntry}
              className={CTA_BTN_ORANGE_CLASS}
            >
              <span>{t("home.hero.linglongEntry")}</span>
            </button>
          </div>
        </div>
      </section>

      <footer className="relative z-10 pt-12 bg-[#000]">
        <div className="mx-auto max-w-[1440px] px-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <img
                  src="/TAI-logo.png"
                  alt="TAI"
                  draggable={false}
                  className="h-8 w-auto object-contain"
                />
              </div>
              <p className="mt-4 text-[14px] leading-relaxed text-white/60">
                {t("home.footer.slogan")}
              </p>
            </div>

            <div className="flex">
              <div className="mr-[140px]">
                <h3 className="mb-4 text-sm font-medium text-white">
                  {t("home.footer.products")}
                </h3>
                <button
                  type="button"
                  onClick={() => navigate("https://www.tgkw.com/dfc_new.html")}
                  className="text-sm text-white/55 transition-colors hover:text-white/85"
                >
                  {t("home.footer.dfc")}
                </button>
              </div>

              <div>
                <h3 className="mb-4 text-sm font-medium text-white">
                  {t("home.footer.follow")}
                </h3>
                <div className="flex items-center gap-3">
                  <FooterSocialIcon
                    icon={wechatIconImage}
                    label="WeChat"
                    qrCode={wxErweimaImage}
                  />
                  <FooterSocialIcon
                    icon={xhsIconImage}
                    label="Xiaohongshu"
                    qrCode={xhsErweimaImage}
                  />
                  <FooterSocialIcon
                    icon={dyIconImage}
                    label="TikTok"
                    qrCode={dyErweimaImage}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-12 border-t border-[rgba(255,255,255,0.1)] h-[70px] leading-[70px] text-center text-[12px] text-white/40">
            <a
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-white/60"
            >
              {t("home.icp")}
            </a>
            <span className="mx-3">·</span>
            <span>{t("home.footer.copyright")}</span>
          </div>
        </div>
      </footer>

      <EventSettingsModalHost />
      <MembershipModal
        open={membershipModalOpen}
        onClose={() => setMembershipModalOpen(false)}
      />
      <WeChatFloatingButton />
    </div>
  );
}
