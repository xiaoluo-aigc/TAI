import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  LogOut,
  HelpCircle,
  Share,
  Library,
  Grid3x3,
  Square,
  Menu,
  Activity,
  History,
  Check,
  ChevronDown,
  Home,
  Sparkles,
  Trash2,
  Cloud,
  Zap,
  Key,
  Eye,
  EyeOff,
  Code,
  FolderOpen,
  Send,
  Globe,
  Gift,
  MessageCircle,
  Star,
  Plus,
  Sun,
  Moon,
} from "lucide-react";
import MemoryDebugPanel from "@/components/debug/MemoryDebugPanel";
import HistoryDebugPanel from "@/components/debug/HistoryDebugPanel";
import { useProjectStore } from "@/stores/projectStore";
import ProjectManagerModal from "@/components/projects/ProjectManagerModal";
import { useUIStore, useCanvasStore, GridStyle } from "@/stores";
import { useFlowStore, FlowEdgeColorMode } from "@/stores/flowStore";
import { useImageHistoryStore } from "@/stores/imageHistoryStore";
import { useAIChatStore } from "@/stores/aiChatStore";
import { logger } from "@/utils/logger";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import GlobalImageHistoryPage from "@/components/global-history/GlobalImageHistoryPage";
import { useGlobalImageHistoryStore } from "@/stores/globalImageHistoryStore";
import AutosaveStatus from "@/components/autosave/AutosaveStatus";
import WorkflowHistoryButton from "@/components/workflow-history/WorkflowHistoryButton";
import { paperSaveService } from "@/services/paperSaveService";
import { historyService } from "@/services/historyService";
import { clipboardService } from "@/services/clipboardService";
import { contextManager } from "@/services/contextManager";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { authApi, type GoogleApiKeyInfo } from "@/services/authApi";
import ReferralRewards from "@/components/ReferralRewards";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import MembershipPanel from "@/components/payment/MembershipPanel";
import PricingCatalogModal from "@/components/layout/PricingCatalogModal";
import { useTranslation } from "react-i18next";
import {
  claimDailyReward,
  getDailyRewardStatus,
  getMyCredits,
  type DailyRewardStatus,
  type UserCreditsInfo,
} from "@/services/adminApi";

// Nano Banana 闂傚倸鍊搁崐鎼佸磹妞嬪孩顐介柨鐔哄Т绾惧鏌涘☉鍗炲箻闁哄棗妫濋弻娑樷槈濮楀牆濮涘銈傛櫆閻擄繝寮诲☉銏犵婵＄偠顕ф禍楣冩⒑缁嬫鍎愰柟鎼佺畺楠炲骞橀鑲╊槹濡炪倖鎸炬慨纾嬨亹鎼淬劍鈷掑ù锝堟鐢稓绱掗鎯р枅鐎规洖缍婇獮搴ㄦ寠婢跺鈧剙顪冮妶鍡樼５闁稿鎸婚〃銉╂倷鐎电顫ч梺鐟板槻閹虫ê鐣烽妸锔剧瘈閹煎瓨绻勯弫?
type BananaPricingTier = "fast" | "pro" | "ultra";

const BANANA_STABLE_ROUTE_PRICING: Record<
  BananaPricingTier,
  Record<"0.5K" | "1K" | "2K" | "4K", number>
> = {
  // 缂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妞ゃ垺鐗犲畷銊╁级閹寸姵鐒鹃梻浣侯潒閸曞灚鐣烽梺绋款儌閺呮稖鐏冮梺鎸庣箓閹冲酣寮抽悙鐑樼厽闁圭儤姊荤敮娑㈡煙娓氬灝濡奸摶锝囩磽娴ｈ偂鎴︽倵椤栨稓绡€闁靛骏缍嗗鎰箾閼碱剙鏋涚€殿喖顭锋俊鎼佸Ψ閵忊槅娼旀繝纰樻閸ㄦ娊宕㈣閸╁懘寮婚妷锔规嫼闂佸憡绋戦敃锕傘€傞崣澶堜簻妞ゆ挾鍋為崰妯活殽閻愯尙绠抽柍褜鍓ㄧ紞鍡涘闯椤曗偓瀵偄顓兼径瀣帾闂佸壊鍋呯换鍐啅濠靛洢浜? Nano Banana 闂傚倸鍊峰ù鍥敋瑜嶉～婵嬫晝閸岋妇绋忔繝銏ｅ煐閸旀牠宕曞Δ浣典簻闁哄洦顨呮禍楣冩⒑?
  fast: { "0.5K": 30, "1K": 30, "2K": 30, "4K": 30 },
  pro: { "0.5K": 90, "1K": 90, "2K": 100, "4K": 170 },
  ultra: { "0.5K": 30, "1K": 30, "2K": 50, "4K": 110 },
};

const BANANA_NORMAL_ROUTE_PRICING: Record<
  BananaPricingTier,
  Record<"0.5K" | "1K" | "2K" | "4K", number>
> = {
  // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敃鈧粻顖炴倵閿濆骸鏋涢梻鍌ゅ灦閺屻劌鈹戦崱鈺傂﹂梺缁樺笒閻忔岸濡甸崟顖氱鐎广儱娴傚Σ顕€姊洪崨濠勭畺婵＄偘绮欏璇差吋閸偅顎囬梻浣告啞閹稿鎳濇ィ鍐╁仼婵犻潧顑呭婵嗏攽閻樻彃顏存繛?- 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敃鈧懜褰掓煛鐏炶鍔氱紒鈧崘鈹夸簻闊洦鎸婚崳娲煟閿旀儳浠滈柍瑙勫灴閹瑥顔忛鍏碱啀濠电姵顔栭崰妤呭箰閸愯尙鏆﹂柣銏㈩焾閸愨偓濡炪倖鍔х紞鍡楊焽閻斿皝鏀介柣鎰级椤ョ偤鏌熼崨濠冨€愰柟顖氳嫰铻栭柛娑卞枤閸橀亶鏌ｈ箛鏇炰粶濠⒀嗗Г娣囧﹪宕堕浣哄幈闁诲函缍嗛崑鍛暦瀹€鈧埀顒冾潐濞叉﹢鏁冮姀銈冣偓渚€寮崼婵嗙獩濡炪倖姊婚悺鏃堝触閸岀偞鈷?
  fast: { "0.5K": 20, "1K": 20, "2K": 20, "4K": 20 },
  pro: { "0.5K": 40, "1K": 40, "2K": 60, "4K": 80 },
  ultra: { "0.5K": 30, "1K": 30, "2K": 40, "4K": 50 },
};

const resolveBananaPricingTier = (
  provider: string | undefined
): BananaPricingTier | null => {
  if (provider === "banana-2.5") return "fast";
  if (provider === "banana-3.1" || provider === "nano2") return "ultra";
  if (provider === "banana" || provider === "gemini-pro") return "pro";
  return null;
};

const resolveBananaCredits = (
  provider: string | undefined,
  route: string | undefined,
  imageSize: string = "1K"
): number | null => {
  const tier = resolveBananaPricingTier(provider);
  if (!tier) return null;

  const pricing =
    route === "stable" ? BANANA_STABLE_ROUTE_PRICING : BANANA_NORMAL_ROUTE_PRICING;
  const normalizedSize = imageSize.trim().toUpperCase() as "0.5K" | "1K" | "2K" | "4K";
  const validSizes: Array<"0.5K" | "1K" | "2K" | "4K"> = [
    "0.5K",
    "1K",
    "2K",
    "4K",
  ];
  const size = validSizes.includes(normalizedSize) ? normalizedSize : "1K";
  return pricing[tier][size];
};

const SETTINGS_SECTIONS = [
  { id: "workspace", labelKey: "workspace.settings.sections.workspace", icon: Square },
  { id: "referral", labelKey: "workspace.settings.sections.referral", icon: Gift },
  { id: "appearance", labelKey: "workspace.settings.sections.appearance", icon: Eye },
  { id: "ai", labelKey: "workspace.settings.sections.ai", icon: Sparkles },
  { id: "advanced", labelKey: "workspace.settings.sections.advanced", icon: Zap },
] as const;

type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

const VIEW_APPEARANCE_STORAGE_KEY = "tanva-view-settings";
const REFERRAL_NOTIFICATION_LAST_SEEN_DATE_STORAGE_KEY =
  "tanva-referral-notification-last-seen-date";
const MAX_QUICK_PROJECTS = 5;
const USER_MANUAL_URL =
  "https://fcn0tn5wd2p8.feishu.cn/wiki/CWZpw5T9EiZvRzkaoe0c3Bmgn5c?from=from_copylink";
const CHANGELOG_URL =
  "https://gcnyatv1ofs3.feishu.cn/wiki/NMVhwMbglijVwFkW8HKcfpCynIp";

const getTodayDateKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const FloatingHeader: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const untitledProjectLabel = t("workspacePage.prompt.defaultName", {
    defaultValue: t("common.untitled"),
  });
  const localizeProjectName = useCallback(
    (name?: string | null) => {
      const raw = typeof name === "string" ? name.trim() : "";
      if (!raw) return untitledProjectLabel;
      const normalized = raw.toLowerCase();
      const cnUntitled = String.fromCharCode(0x672a, 0x547d, 0x540d);
      const cnUntitledProject = String.fromCharCode(0x672a, 0x547d, 0x540d, 0x9879, 0x76ee);
      if (
        raw === cnUntitled ||
        raw === cnUntitledProject ||
        normalized === "untitled" ||
        normalized === "untitled project"
      ) {
        return untitledProjectLabel;
      }
      return raw;
    },
    [untitledProjectLabel]
  );
  const {
    showLibraryPanel,
    showGrid,
    showLayerPanel,
    toggleLibraryPanel,
    toggleGrid,
    setShowGrid,
    focusMode,
    snapAlignmentEnabled,
    toggleSnapAlignment,
  } = useUIStore();

  const {
    gridStyle,
    gridSize,
    gridColor,
    gridBgColor,
    gridBgEnabled,
    zoomSensitivity,
    wheelZoomMode,
    setGridStyle,
    setGridSize,
    setGridColor,
    setGridBgColor,
    setGridBgEnabled,
    setZoomSensitivity,
    setWheelZoomMode,
  } = useCanvasStore();
  const edgeColorMode = useFlowStore((s) => s.edgeColorMode);
  const setEdgeColorMode = useFlowStore((s) => s.setEdgeColorMode);

  // AI 闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏇楀亾妞ゎ厼鐏濊灒闁兼祴鏅濋悡瀣⒑閸撴彃浜濇繛鍙夛耿瀹?
  const {
    imageOnly,
    setImageOnly,
    aiProvider,
    setAIProvider,
    bananaImageRoute,
    setBananaImageRoute,
    sendShortcut,
    setSendShortcut,
    expandedPanelStyle,
    setExpandedPanelStyle,
    chatTheme,
    setChatTheme,
  } = useAIChatStore();
  const bananaProviderSelected =
    aiProvider === "banana" ||
    aiProvider === "banana-2.5" ||
    aiProvider === "banana-3.1";

  // 婵犵數濮烽。顔炬閺囥垹纾婚柟杈剧畱绾惧綊鏌￠崶鈺佸壋闁兼澘娼￠弻娑樜旈崘褏闂梺缁樺灦閿氭い鏇憾閹鈽夊▍铏灥閳诲秹寮介鐔叉嫼闂佸憡鎸昏ぐ鍐╃閻愮儤鐓曢柣妯哄暱婵秹鏌熼绛嬫疁妞ゃ垺鐟ラ湁閹艰揪绱曠粔娲煙椤旇娅嗙紒妤冨枛椤㈡稑顫濋鐔哄綆缂傚倸鍊搁崐宄懊归崶銊ｄ粓缂佸顑欏鈺呮煏婵炑冨暙閻忓﹥绻濋悽闈浶ｇ痪鏉跨Ч瀵煡顢楅崟顒傚幈闂佸搫娲㈤崝灞炬櫠椤曗偓閺?
  const {
    currentProject,
    openModal,
    create,
    rename,
    optimisticRenameLocal,
    projects,
    open,
  } = useProjectStore();
  // Header 婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柛顐ｆ礀缁犱即鏌熼梻瀵歌窗闁轰礁瀚伴弻娑㈠焺閸忕媭浜畷褰掑籍閸喓鍘介梺鐟邦嚟閸庢劙鎮炴禒瀣厓缂備焦蓱閳锋劙鏌曢崶褍顏鐐搭焽閹瑰嫰鎯勯幒鐐电М闁哄矉缍侀弫鎰緞婢跺鏋ら梻浣虹帛閹尖晠宕戞繝鍌滄殾闁告挷鐒﹀畷澶愬级閻愬瓨绶查柡瀣墦濮婄粯绗熼埀顒勫焵椤掑倸浠滈柤娲诲灡閺呰埖瀵肩€涙鍘遍梺缁樕戦悡锟犲矗閸曨厸鍋撶憴鍕妞ゃ垹锕︾划璇测槈濡攱顫嶅┑鈽嗗灣閳峰牓宕憴鍕箚闁绘劦浜滈埀顑惧€濆畷鎴﹀箳濡も偓閸屻劌螖閿濆懎鏆為柛瀣剁節閺屾洝绠涚€ｎ亖鍋撻弽顓熷亗婵炴垯鍨洪悡鏇㈡倶閻愭彃鈷旈柍顖涙礈缁辨帡骞嗛弶璺ㄦ缂備浇椴搁幑鍥х暦閹烘垟妲堟繛鍡楃箳閿涙捇姊绘担鑺ャ€冪紒鈧担铏圭煋闁圭虎鍠楅崑鈺傜節闂堟侗鍎忛柣鎺戠仛閵囧嫰骞掗崱妞惧闂佺粯鎸堕崐婵嬪蓟濞戞粠妲煎銈冨妼閹虫劗鍒掓繝姘闁兼亽鍎抽崢顏呯節閵忥絾纭鹃柣妤€妫濆畷婵堚偓娑櫭肩换鍡涙煙缂佹ê淇柣鎾炽偢閺屸€崇暆鐎ｎ剛袦闂佹寧绻勯崑銈夈€佸Δ鍛劦妞ゆ帊鐒﹂崣蹇涙煕瀹€鈧崑鐐烘偂韫囨稒鐓曢柍鈺佸枤濞堟﹢寮崼銉︹拺閻犲洠鈧磭浠╅柣搴㈢煯閸楁娊濡存担绯曟瀻闁瑰濮烽敍婊堟⒑闂堟稓绠冲┑顔炬暬瀹曟劖鎯旈妸锔规嫽婵炶揪缍€濡嫰宕ヨぐ鎺撶厱閻庯綆鍋嗛埥澶愭懚閻愬绠鹃柟瀵稿€戝璺哄嚑闁哄啫鐗婇悡娆撳级閸繂鈷旈柣锝堜含缁辨帡鍩€椤掑嫬绀嬫い鏍ㄧ〒閸橀箖姊虹拠鈥冲箺閻㈩垱甯″畷婵嗩煥閸曨厾顔?
  const handleQuickSwitch = (projectId: string) => {
    if (!projectId || projectId === currentProject?.id) return;
    open(projectId);
  };
  const quickCreateInFlightRef = useRef(false);
  const [isQuickCreatingProject, setIsQuickCreatingProject] = useState(false);
  const handleQuickCreateProject = useCallback(async () => {
    if (quickCreateInFlightRef.current) return;
    quickCreateInFlightRef.current = true;
    setIsQuickCreatingProject(true);
    try {
      await create();
    } catch (error) {
      console.error("Failed to quick create project:", error);
    } finally {
      quickCreateInFlightRef.current = false;
      setIsQuickCreatingProject(false);
    }
  }, [create]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  useEffect(() => {
    setTitleInput(currentProject?.name || untitledProjectLabel);
  }, [currentProject?.id, currentProject?.name, untitledProjectLabel]);
  const commitTitle = async () => {
    const name = titleInput.trim() || untitledProjectLabel;
    try {
      if (currentProject) {
        if (name !== currentProject.name) {
          // 闂傚倸鍊搁崐鐑芥嚄閸洍鈧箓宕奸姀鈥冲簥闂佽澹嗘晶妤呭磻鐎ｎ亖鏀介柣妯诲絻娴滀即鏌ら弶璺ㄤ虎闂囧鏌涜箛鎾虫倯缂傚秵鍨块弻鐔烘兜閸涱喚銆愰柧鑽ゅ仜铻炲Λ棰佺劍缁佷即鏌涜箛鎾存拱闁靛洤瀚板顒勫箰鎼粹剝鐏庨梻浣筋嚃閸犳牠宕查弻銉ョ厺閹兼番鍊楅悿鈧梺鍦檸閸ㄧ増绂嶆ィ鍐╃厽闁绘梻顭堝▍鐐寸箾瀹割喕绨婚梺瑁ゅ€栨穱濠囧Χ閸屾矮澹曟繝纰樻閸嬪懘鏁冮姀銈呯畺濞寸姴顑愰弫宥夋煥濠靛棙鍣洪柣蹇旀尵缁辨挻鎷呴幓鎺嶅濠电姰鍨奸崺鏍礉閺嶎厽鍋傛繛鍡樺灩绾捐棄霉閿濆拋娼犳い蹇撴噺閸欏繘鏌涢妷銏℃澒闁稿鎸鹃幉鎾礋椤掑偆妲梻浣告惈閻楁粓宕滈悢鑲╁祦闊洦绋戝婵嬫煛婢跺鐏╂い鏃€甯″娲偂鎼搭喗缍楅梺绋匡攻濞茬喖骞?
          optimisticRenameLocal(currentProject.id, name);
          await rename(currentProject.id, name);
        }
      } else {
        await create(name);
      }
    } finally {
      setEditingTitle(false);
    }
  };

  // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩顔瑰亾閸愵喖骞㈡俊鐐存礃濡炰粙鐛€ｎ喗鍋愰柣銏☆問濡?濠电姷鏁告慨鐢割敊閺嶎厼闂い鏍ㄧ矊缁躲倕螖閿濆懎鏆欓柦鍐枔閹叉瓕绠涢幘顖涚€婚梺闈涚箞閸婃洖鏁梻浣哥枃濡椼劑鎳楅崼鏇€鍥敋閳ь剙顫忛搹鍦＜婵☆垱妞垮鍨渻閵堝棙鑲犻柛銉戝啫浜堕梺璇叉捣閺佸摜娑甸崼鏇炵；闁规崘鍩栭崰鍡涙煕閺囥劌骞楅柟鍙夌懇閺岋綀绠涢幘鍓侇唹闂佽崵鍠嗛崐妤呮嚍閸楃伝娲敂閸涱亝瀚?
  const [showMemoryDebug, setShowMemoryDebug] = useState(false);
  const [showHistoryDebug, setShowHistoryDebug] = useState(false);
  const [isMembershipOpen, setIsMembershipOpen] = useState(false);
  const [gridSizeInput, setGridSizeInput] = useState(String(gridSize));
  const [saveFeedback, setSaveFeedback] = useState<
    "idle" | "success" | "error"
  >("idle");
  const saveFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const hasAppliedSavedAppearanceRef = useRef(false);

  // Google API Key 缂傚倸鍊搁崐鎼佸磹閻戣姤鍤勯柤鎼佹涧閸ㄦ棃鎮楅棃娑欏暈妞ゎ偅娲熼弻锟犲炊閵夈儳浠肩紓浣哄У閻楁洟鍩為幋锔藉亹闁告瑥顦ˇ鈺呮⒑缁嬫鍎愰柛鏃€鐟╅獮鍐喆閸曨剙顎撶紓浣圭☉椤戝棛绱為崼銉︾厽?
  const [googleApiKeyInfo, setGoogleApiKeyInfo] = useState<GoogleApiKeyInfo>({
    hasCustomKey: false,
    maskedKey: null,
    mode: "official",
  });
  const [googleApiKeyInput, setGoogleApiKeyInput] = useState("");
  const [showGoogleApiKey, setShowGoogleApiKey] = useState(false);
  const [googleApiKeySaving, setGoogleApiKeySaving] = useState(false);
  const [googleApiKeyFeedback, setGoogleApiKeyFeedback] = useState<
    "idle" | "success" | "error"
  >("idle");
  const googleApiKeyFeedbackTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  // 闂傚倸鍊搁崐鐑芥倿閿曗偓椤啴宕归鍛姺闂佺鍕垫當缂佲偓婢跺备鍋撻獮鍨姎妞わ富鍨跺浼村Ψ閿斿墽顔曢梺鐟邦嚟閸嬬偤鎯冮幋锔界厽妞ゆ挾鍠愮亸浼存煏閸パ冾伃鐎殿喕绮欐俊鎼佸Ω閵夘喗顥ら梻鍌欐祰椤曆勵殽閹间讲鈧箓鎮滈挊澶庢憰闂佹寧绻傞幉姗€鎮㈢亸浣圭€婚梺璇″瀻閸曨剛褰庨梻?
  const [creditsInfo, setCreditsInfo] = useState<UserCreditsInfo | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [dailyRewardStatus, setDailyRewardStatus] =
    useState<DailyRewardStatus | null>(null);
  const [dailyRewardLoading, setDailyRewardLoading] = useState(false);
  const [dailyRewardClaiming, setDailyRewardClaiming] = useState(false);
  const [isHelpMenuOpen, setIsHelpMenuOpen] = useState(false);
  const [isPricingCatalogOpen, setIsPricingCatalogOpen] = useState(false);
  const [isWechatQrOpen, setIsWechatQrOpen] = useState(false);
  const [fpsOverlayAdminButtonLayout, setFpsOverlayAdminButtonLayout] = useState<{
    top: number;
    left: number;
    size: number;
  } | null>(null);
  const [wechatQrCodes, setWechatQrCodes] = useState<{
    officialAccount: string;
    wechatGroup: string;
  }>({
    officialAccount: "/qrcode-official.png",
    wechatGroup: "/qrcode-group.png",
  });

  useEffect(() => {
    const fetchQrCodes = async () => {
      try {
        const apiBase =
          (import.meta.env.VITE_API_BASE_URL as string | undefined) || "http://localhost:4000";
        const response = await fetch(`${apiBase}/api/settings/wechat-qrcodes`);
        if (response.ok) {
          const data = await response.json();
          if (data.officialAccount) {
            setWechatQrCodes((prev) => ({ ...prev, officialAccount: data.officialAccount }));
          }
          if (data.wechatGroup) {
            setWechatQrCodes((prev) => ({ ...prev, wechatGroup: data.wechatGroup }));
          }
        }
      } catch (_error) {
        // keep fallback qrcode images
      }
    };
    fetchQrCodes();
  }, []);

  // 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰惈缁犱即鏌熼梻瀵割槮缂佺姷濞€閺岀喖鎮ч崼鐔哄嚒缂?Google API Key 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐蹭画闂侀潧锛忛崨顖滃帬闁荤喐绮庢晶妤冩暜閸ヮ剙鐒垫い鎺嗗亾闁硅櫕锕㈤妴浣割潨閳ь剟骞冮埡鍛鐎瑰壊鍠掗崑鎾斥槈閵忊檧鎷洪梺鍝勫€堕崕鎻掆枍閸涘瓨鐓曢柣鏇氱閻忥箓鎸婂┑鍫熷枑闁哄啫鐗嗛拑?
  useEffect(
    () => () => {
      if (googleApiKeyFeedbackTimerRef.current) {
        clearTimeout(googleApiKeyFeedbackTimerRef.current);
        googleApiKeyFeedbackTimerRef.current = null;
      }
    },
    []
  );

  const handleSaveGoogleApiKey = useCallback(async () => {
    if (googleApiKeySaving) return;
    setGoogleApiKeySaving(true);
    try {
      const trimmedKey = googleApiKeyInput.trim();
      const result = await authApi.updateGoogleApiKey({
        googleCustomApiKey: trimmedKey || null,
        googleKeyMode: trimmedKey ? "custom" : "official",
      });
      if (result.success) {
        setGoogleApiKeyFeedback("success");
        // 闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏇氶檷娴滃綊鏌涢幇鍏哥敖闁活厽鎹囬弻锝夊閵忊晝鍔搁梺钘夊暟閸犲酣鍩為幋锔藉亹闁告瑥顦伴幃娆戠磽娴ｆ彃浜炬繝銏ｅ煐閸旀牠鎮￠悢闀愮箚妞ゆ牗绮岀敮鍫曟煕閺傛鍎戠紒杈ㄥ笚閹峰懎鐣￠弶璺ㄣ偖闂備礁鎼惌澶屽緤閸婄喓浜芥繝鐢靛仜濡瑩宕曢幎钘夌柧闁挎繂顦伴埛?
        const info = await authApi.getGoogleApiKey();
        setGoogleApiKeyInfo(info);
        setGoogleApiKeyInput(""); // 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰惈缁犱即鏌熼梻瀵割槮缂佺姷濞€閺岀喖鎮ч崼鐔哄嚒闂佺粯鎸婚敃銏ゅ蓟閳ユ剚鍚嬮柛鎰╁妼椤绱撻崒姘毙㈡繛宸弮瀵鎮㈤悡搴ｇ暰閻熸粌绉瑰铏綇閳规儳浜炬繛鍫濈仢閺嬬喎鈹戦悙璇ц含鐎?
      } else {
        setGoogleApiKeyFeedback("error");
      }
    } catch (e) {
      console.error("Failed to save Google API Key:", e);
      setGoogleApiKeyFeedback("error");
    } finally {
      setGoogleApiKeySaving(false);
      if (googleApiKeyFeedbackTimerRef.current) {
        clearTimeout(googleApiKeyFeedbackTimerRef.current);
      }
      googleApiKeyFeedbackTimerRef.current = setTimeout(
        () => setGoogleApiKeyFeedback("idle"),
        2500
      );
    }
  }, [googleApiKeyInput, googleApiKeySaving]);

  const handleClearGoogleApiKey = useCallback(async () => {
    if (googleApiKeySaving) return;
    const confirmed = window.confirm(
      t("workspace.settings.aiTab.googleKey.clearConfirm")
    );
    if (!confirmed) return;

    setGoogleApiKeySaving(true);
    try {
      const result = await authApi.updateGoogleApiKey({
        googleCustomApiKey: null,
        googleKeyMode: "official",
      });
      if (result.success) {
        setGoogleApiKeyFeedback("success");
        setGoogleApiKeyInfo({
          hasCustomKey: false,
          maskedKey: null,
          mode: "official",
        });
        setGoogleApiKeyInput("");
      } else {
        setGoogleApiKeyFeedback("error");
      }
    } catch (e) {
      console.error("Failed to clear Google API Key:", e);
      setGoogleApiKeyFeedback("error");
    } finally {
      setGoogleApiKeySaving(false);
      if (googleApiKeyFeedbackTimerRef.current) {
        clearTimeout(googleApiKeyFeedbackTimerRef.current);
      }
      googleApiKeyFeedbackTimerRef.current = setTimeout(
        () => setGoogleApiKeyFeedback("idle"),
        2500
      );
    }
  }, [googleApiKeySaving, t]);

  // 婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柛顐ｆ礀缁犱即鏌熺紒銏犳灈缁炬儳顭烽弻鐔煎箚瑜滈崵鐔虹磼閻樿崵鐣洪柡灞剧洴閸ㄦ儳鐣烽崶鈺婂敹濠电姭鎷冮崟顓炲绩闂佸搫鑻粔鐑铰ㄦ笟鈧弻娑欐償閵忊€斥偓鎰偓瑙勬礃閿曘垽鍨鹃敃鍌氱闁绘劕妯婂▓顖炴⒒閸屾瑧顦﹂柟纰卞亰钘濋梺顒€绉寸壕濠氭煟閹邦剚鎯堥柛銊ュ€圭换婵嬫濞戞艾顤€閻庤娲栧鍫曞箞閵娿儙鐔烘嫚瀹割喗娈洪梻浣侯焾椤戝棝骞愰幖浣哥叀濠㈣泛艌閺嬪孩淇婇婊冨付濠殿喚鍎ょ换婵嬫偨闂堟稐绮堕梺缁橆殔閿曨亜鐣风涵鍛汗闁圭儤鍨归悿鍛存⒑閸︻叀妾搁柛鐘崇墵閻涱噣濮€閳ヨ尙绠氶梺闈涚墕鐎氼垶宕楃仦淇变簻闁冲搫锕ら獮妤冪磼缂佹绠炲┑顔瑰亾闂佹寧绻傞幊鎰板储椤愶附鈷戠紓浣癸供濞堟﹢鏌涚€ｃ劌鈧繈寮幇鐗堝€烽柛婵嗗閸婄偤姊洪崘鍙夋儓闁稿﹥鎮傞、鎾斥槈閵忊檧鎷洪梺鍛婄☉閿曘儳鈧灚鐟╅弻娑樷槈閸楃偞鐏撻梺?
  useEffect(() => {
    if (hasAppliedSavedAppearanceRef.current) return;
    if (typeof window === "undefined") return;
    hasAppliedSavedAppearanceRef.current = true;

    try {
      const raw = window.localStorage.getItem(VIEW_APPEARANCE_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<{
        showGrid: boolean;
        gridStyle: GridStyle;
        gridSize: number;
        gridColor: string;
        gridBgColor: string;
        gridBgEnabled: boolean;
        edgeColorMode: FlowEdgeColorMode;
      }> | null;
      if (!saved || typeof saved !== "object") return;

      if (typeof saved.showGrid === "boolean") setShowGrid(saved.showGrid);
      if (
        saved.gridStyle &&
        Object.values(GridStyle).includes(saved.gridStyle)
      ) {
        setGridStyle(saved.gridStyle);
      }
      if (
        typeof saved.gridSize === "number" &&
        saved.gridSize >= 1 &&
        saved.gridSize <= 200
      ) {
        setGridSize(saved.gridSize);
        setGridSizeInput(String(saved.gridSize));
      }
      if (
        typeof saved.gridColor === "string" &&
        saved.gridColor.startsWith("#")
      ) {
        setGridColor(saved.gridColor);
      }
      if (
        typeof saved.gridBgColor === "string" &&
        saved.gridBgColor.startsWith("#")
      ) {
        setGridBgColor(saved.gridBgColor);
      }
      if (typeof saved.gridBgEnabled === "boolean") {
        setGridBgEnabled(saved.gridBgEnabled);
      }
      if (
        saved.edgeColorMode === FlowEdgeColorMode.STANDARD ||
        saved.edgeColorMode === FlowEdgeColorMode.HANDLE
      ) {
        setEdgeColorMode(saved.edgeColorMode);
      }
    } catch (error) {
      console.warn(
        "[FloatingHeader] Failed to load saved appearance settings:",
        error
      );
    }
  }, [
    setShowGrid,
    setGridStyle,
    setGridSize,
    setGridColor,
    setGridBgColor,
    setGridBgEnabled,
    setEdgeColorMode,
    setGridSizeInput,
  ]);

  // 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰惈缁犱即鏌熼梻瀵割槮缂佺姷濞€閺岀喖鎮ч崼鐔哄嚒缂備胶濮甸悧鏇㈠煘閹达附鍋愰柟缁樺笚濞堝爼姊哄畷鍥ㄥ殌缂佸鏁搁幑銏犫攽鐎ｎ偒妫冨┑鐐村灦閻燁垰螞閵堝鈷戦柛锔诲幗濞呮洖鈹戦悙鈺佷壕闂備礁鎼惉濂稿窗閹捐埖顫曢柟鐑樺殾閻旂厧浼犻柛鏇炵仛缂嶅秹姊婚崒娆戠獢婵炰匠鍏犳椽鏁冮埀顒勶綖濠靛惟闁宠桨鑳堕鍡涙煟鎼搭垳绉甸柛鐘崇墵閹偛煤椤忓懐鍘遍梺纭呭焽閸斿秴鈻嶉幘缈犵箚鐎瑰壊鍠栭悘锔芥叏?
  useEffect(
    () => () => {
      if (saveFeedbackTimerRef.current) {
        clearTimeout(saveFeedbackTimerRef.current);
        saveFeedbackTimerRef.current = null;
      }
    },
    []
  );

  const handleSaveAppearanceSettings = useCallback(() => {
    if (typeof window === "undefined") return;
    const payload = {
      showGrid,
      gridStyle,
      gridSize,
      gridColor,
      gridBgColor,
      gridBgEnabled,
      edgeColorMode,
    };

    try {
      window.localStorage.setItem(
        VIEW_APPEARANCE_STORAGE_KEY,
        JSON.stringify(payload)
      );
      setSaveFeedback("success");
    } catch (error) {
      console.warn(
        "[FloatingHeader] Failed to save appearance settings:",
        error
      );
      setSaveFeedback("error");
    } finally {
      if (saveFeedbackTimerRef.current) {
        clearTimeout(saveFeedbackTimerRef.current);
      }
      saveFeedbackTimerRef.current = setTimeout(
        () => setSaveFeedback("idle"),
        2200
      );
    }
  }, [
    showGrid,
    gridStyle,
    gridSize,
    gridColor,
    gridBgColor,
    gridBgEnabled,
    edgeColorMode,
  ]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsSection, setActiveSettingsSection] =
    useState<SettingsSectionId>("workspace");
  const settingsContentScrollRef = useRef<HTMLDivElement | null>(null);
  const [showReferralNotification, setShowReferralNotification] =
    useState(false);
  const [isGlobalHistoryOpen, setIsGlobalHistoryOpen] = useState(false);
  // 闂傚倸鍊搁崐鐑芥嚄閸洖纾块柣銏㈩焾閻ょ偓绻濇繝鍌滃闁搞劌鍊块弻锝夊閵忊晝鍔哥紓浣哄У閼归箖鈥︾捄銊﹀磯闁惧繐婀辨导鍥╃磼妤ｅ啰鐣虹紒鐘崇墵瀵鎮㈢悰鈥充壕闁汇垺顔栭悞鎯归悩娆忓枤閻斿棝鎮峰▎蹇擃仼濠殿喖娲﹂妵鍕敇閻愭潙浠撮悗瑙勬礀閵堢鐣烽崡鐐嶆棃鍩€椤掑嫬姹查柣鏂挎啞閸欏繘鏌ㄥ┑鍡樺櫧濠⒀嶇畵閺岋紕浠﹂崜褉妲堥梺瀹狀嚙闁帮綁鐛崱妯奸檮濠㈣泛顦遍弫鏍⒑?
  useEffect(() => {
    setGridSizeInput(String(gridSize));
  }, [gridSize]);

  useEffect(() => {
    if (!isSettingsOpen) return;
    if (typeof document === "undefined") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSettingsOpen(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSettingsOpen]);

  useEffect(() => {
    if (!isSettingsOpen) return;
    const container = settingsContentScrollRef.current;
    if (!container) return;
    container.scrollTop = 0;
  }, [activeSettingsSection, isSettingsOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isSettingsOpen) return;
    const today = getTodayDateKey();
    const lastSeen = window.localStorage.getItem(
      REFERRAL_NOTIFICATION_LAST_SEEN_DATE_STORAGE_KEY
    );
    setShowReferralNotification(lastSeen !== today);
  }, [isSettingsOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!showReferralNotification) return;
    if (activeSettingsSection !== "referral") return;
    const today = getTodayDateKey();
    window.localStorage.setItem(
      REFERRAL_NOTIFICATION_LAST_SEEN_DATE_STORAGE_KEY,
      today
    );
    setShowReferralNotification(false);
  }, [activeSettingsSection, showReferralNotification]);

  const commitGridSize = () => {
    const n = parseInt(gridSizeInput, 10);
    if (!isNaN(n) && n > 0 && n <= 200) setGridSize(n);
    else setGridSizeInput(String(gridSize));
  };

  const clearImageHistory = useImageHistoryStore((state) => state.clearHistory);
  const historyCount = useImageHistoryStore((state) => state.history.length);
  const globalHistoryCount = useGlobalImageHistoryStore(
    (state) => state.totalCount
  );
  const fetchGlobalHistoryCount = useGlobalImageHistoryStore(
    (state) => state.fetchCount
  );
  const authUser = useAuthStore((s) => s.user);

  // 闂傚倸鍊搁崐椋庣矆娓氣偓瀹曘儳鈧綆鍠栫壕鍧楁煙閹増顥夐幖鏉戯躬閺屻倝鎳濋幍顔肩墯婵炲瓨绮岀紞濠囧蓟濞戙垹唯妞ゆ梻鍘ч～鈺冪磽娴ｆ彃浜鹃梺绋跨灱閸嬬偤鎮¤箛鎾斀闁绘劘灏欐禒銏ゆ煕閺傝鈧牜鎹㈠┑瀣劦妞ゆ帊绀侀閬嶆倵濞戞瑯鐒介柛妯哄船閳规垿鍩ラ崱妤冧化闂佺绨洪崐婵婃＂濠电姴锕ら幊蹇涘窗閹扮増鐓涘璺哄绾爼鏌涢埡瀣偧闁逞屽墯椤旀牠宕抽鈧畷鎴﹀川椤栨浜鹃梻鍫熺◤閸嬨垻鈧鍠栭悥濂哥嵁鐎ｎ喗鍊婚柛鈩冩礈閺侀箖姊婚崒姘偓鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熸潏楣冩闁稿顑夐弻娑樷槈閸楃偟浠╅梺鎼炲妽缁诲牓鐛弽顬ュ酣顢楅埀顒佷繆婵傚憡鐓欓柣鐔稿閸╋綁鏌＄仦鐐缂佺粯鐩畷褰掝敊閻撳寒娼涢梻鍌欑劍閹爼宕愰弽顐ｆ殰闁跨喓濮撮拑鐔兼煥濠靛棛澧辨俊顖欑椤啴濡堕崱妯垮亖闂佸憡渚楅崹鎶剿囬鐐村€垫鐐茬仢閸旀碍銇勯敂璇茬仯闁绘碍鍎抽鍏煎緞鐎ｎ剙骞嶆俊鐐€栭悧妤冪矙閹次诲鈧綆鍋嗙粻楣冩煕椤愶絿绠橀柛鈺嬬秮閺屸€崇暆鐎ｎ剛袦婵犳鍠掗崑鎾绘⒑閸愬弶鎯堥柛鐕佸亞閺侇噣濡歌绾捐棄霉閿濆嫮鐭欓柛婵婃缁辨帞鎷犻懠顒€鈪甸悗娈垮枛椤嘲鐣烽崡鐐╂婵☆垵娅ｉ埀顒夊幖椤啴濡堕崱妯锋嫽闂佸憡顭嗛崨顔肩毇闁诲函缍嗛崰妤呭煕閹达附鐓曟繝闈涙椤忣偄顭胯瀹曨剟婀佸┑鐘诧工閹冲孩绂掑鍫熺厓閻犲洩灏欐晥婵犵绱曢崗妯讳繆閹间焦鏅查柛鏇ㄥ墰濞兼牠姊婚崒娆戭槮闁圭⒈鍋勭叅闁靛ň鏅涚粣妤呮煙閺夊灝褰勯柛銉憾濡嫰姊虹拠鈥虫灈闁搞垺鐓￠崺銏℃償閳锯偓閺嬪酣鏌熺€电校婵炲牊鎮傞弻锝夋偄閸濄儳鐓佸┑鐘灪閿曘垹鐣烽幇鏉垮瀭妞ゆ梻鍋撳▓楣冩⒑閹稿海绠撻柟宄邦儏閵嗘帗绻濆顓犲幈闂佸湱鍋撻〃鍛村箯鐎ｎ喖鐤€广儱顦伴埛鎺懨归敐鍕劅闁衡偓閹殿喚纾介柛顐ｇ矊瀹撳棛鈧娲橀崝娆忣嚕娴犲鏁冮柨婵嗘椤斿洭姊绘担鍛婅础闁惧繐閰ｅ畷浼村冀椤撶喎鍓瑰┑掳鍊曢幊蹇涙偂閵夛妇绡€闂傚牊绋掗ˉ鐘电磼閻樿尙锛嶇紒杈ㄥ浮閸┾偓?
  useEffect(() => {
    if (!authUser) return;
    fetchGlobalHistoryCount();
  }, [fetchGlobalHistoryCount, authUser]);

  const handleClearImageHistory = React.useCallback(() => {
    if (historyCount === 0) {
      alert(t("workspace.settings.workspaceTab.history.empty"));
      return;
    }
    const confirmed = window.confirm(
      t("workspace.settings.workspaceTab.history.clearConfirm", {
        count: historyCount,
      })
    );
    if (confirmed) {
      clearImageHistory();
    }
  }, [clearImageHistory, historyCount, t]);

  const handleLogoClick = () => {
    logger.debug("Logo clicked - navigating to home");
    navigate("/");
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator
        .share({
          title: t("home.share.title"),
          text: t("home.share.text"),
          url: window.location.href,
        })
        .catch(console.error);
    } else {
      navigator.clipboard
        .writeText(window.location.href)
        .then(() => {
          alert(t("home.linkCopied"));
        })
        .catch(() => {
          alert(t("home.shareLink", { url: window.location.href }));
        });
    }
  };

  // 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰惈缁犱即鏌熼梻瀵割槮缂佺姷濞€閺岀喖鎮ч崼鐔哄嚒闂佺粯鎸婚敃銏ゅ蓟閳ユ剚鍚嬮幖绮光偓宕囶啈闂備胶顭堥鍐礉閹达箑绠栫憸鐗堝笒閻愬﹥銇勮箛鎾愁伀婵絻鍨归—鍐Χ閸涱垳顔夐梺鐟版啞婵炲﹤顕ｇ拠娴嬫闁靛繒濮烽悿鈧俊鐐€栫敮濠勭矆娴ｇ硶鏋嶉柨婵嗘媼濞撳鏌曢崼婵囶棡闁抽攱鍔欓弻娑㈠籍閳ь剟鎮烽埡渚囧殨妞ゆ劑鍩勯崥瀣熆鐠虹尨韬柛鐐舵硾閳规垿鎮╃拠褍浼愰梺纭呮珪閸旀瑩銆佸▎鎾崇睄闁割偆鍟块幏鐑樼箾閺夋垵鎮戦柣鐔濆懐鐭欏┑鐘崇閻撶喖鏌ｉ弮鈧换鍌炲箠閹邦喚鐭嗗┑鐘插亞閻斿棝鏌ら幖浣规锭濠殿喖鐗撻弻?闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏂跨暦椤栫偛閿ゆ俊銈傚亾閻庢艾顦伴妵鍕箳閸℃ぞ澹曢梻浣哥枃椤曆呯矓閹绢喖鐓濋幖娣妼缁狅綁鏌ｅΟ鐓庡姦闁衡偓閸濆嫧鏀介柣姗嗗枛閻忚鲸绻涙径瀣创闁诡垰鐭傚畷鎺楁倷閼碱剦妲梻浣规偠閸庮噣寮插┑鍫濐棜闁芥ê顥㈣ぐ鎺撴櫜闁告侗鍠楅崕鎾绘⒑閸濆嫷鍎忛梺甯秮瀵鏁愭径妯绘櫆闂佸憡鍔戦崝宀€绮婇鈧?
  const handleClearCanvas = () => {
    const confirmed = window.confirm(
      t("workspace.settings.workspaceTab.clearCanvasConfirm")
    );
    if (!confirmed) return;

    void (async () => {
      try {
        // 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰惈缁犱即鏌熼梻瀵割槮缂佺姷濞€閺岀喖鎮ч崼鐔哄嚒缂備胶濮甸悧鏇㈠煘閹达附鍋愰柟缁樺俯娴尖偓缂備胶鍋撻崕鎶藉触鐎ｎ偆鈹嶅┑鐘叉祩閺佸秵鎱ㄥ鍡楀箺闁稿孩鎹囧铏圭磼濡闉嶉梺鎼炲妼濞尖€愁嚕鐠囨祴妲堥柕蹇曞Х閻も偓婵＄偑鍊栫敮濠勭矆娴ｇ硶鏋嶉柨婵嗘媼濞撳鏌曢崼婵囶棡闁抽攱鍔欓弻娑㈠籍閳ь剟鎮ч悩鑽ゅ祦闊洦绋戝婵嬫煛婢跺鐏ラ柤鏉挎健濮婃椽宕崟顒€绐涙繝娈垮枤閸忔﹢銆佸▎鎾崇睄闁割偆鍟块幏鐑樼箾閺夋垵鎮戦柣鐔濆懐鐭欏┑鐘崇閻撶喖鏌ｉ弮鈧娆撳礉濮樿埖顥嗗璺侯儎缁诲棙銇勯弽顐沪闁挎稓鍠愮换娑樼暆婵犱線鍋楅梺鍝勬湰缁嬫挻绂掗敃鍌氱鐟滃繘鎮￠崒姘ｆ斀闁绘劕妯婂Σ鍫曟煕閵娿倗鐭欑€殿喖顭烽弫宥夊礋閵娿儰澹曢梺鎸庣箓缁ㄨ偐鑺辩紒妯镐簻鐎电増婢橀幊鎰閸忛棿绻嗛柕鍫濆€告禍楣冩⒑濞茶澧柕鍫㈩焾閻ｇ兘鎮╃拠鎻掑敤濡炪倖鎸鹃崰搴♀枔閵夆晜鈷戦梻鍫熺〒婢ф洘绻涚仦鍌氣偓婵嬪箖閳ユ剚娼╅柤鍝ヮ暯閹?
        paperSaveService.clearCanvasContent();

        // 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰惈缁犱即鏌熼梻瀵割槮缂佺姷濞€閺岀喖鎮ч崼鐔哄嚒闂佺粯鎸婚敃銏ゅ蓟閳ユ剚鍚嬮柛鎰╁妼椤绻涚€涙ê娈犻柛濠冪箞瀵鎮㈤崗鑲╁姺闂佹寧娲嶉崑鎾绘煟韫囨稐鎲鹃柡宀嬬節閸┾偓妞ゆ帊鑳堕々鐑芥倵閿濆骸浜為柛妯绘倐濮婃椽宕ㄦ繝鍌毿曢梺鍛婎焽閺咁偄鈽夐崹顐犲亝闁告劏鏅濋崢浠嬫⒑闂堟稓澧曢柟鍐查叄椤㈡棃顢旈崱娆戯紲濠德板€曢崯顐﹀几閺冨牊鐓冪憸婊堝礈閵娧冪筏闁兼亽鍎插▍鐘诲箹鏉堝墽鎮奸柣顓炴椤潡鎳滈棃娑橆潔闂佹娊鏀遍崹鍫曞Φ閸曨垰绠抽柛鈩冦仦婢规洟姊绘担绛嬪殭缂佺粯鍨归幑銏ゅ醇濠靛牊娈鹃梺闈涚箞閸婃洖娲块梻浣告啞娓氭绂嶅┑瀣€跺〒姘ｅ亾闁哄矉绲鹃幆鏃堫敍濠婂憛锝夋⒑閸涘﹥灏伴柤褰掔畺閸┿垽骞樺畷鍥ㄦ畷闂侀€炲苯澧撮柛鈹惧亾濡炪倖甯婄欢锟犲疮韫囨稒鐓曢柣妯诲墯濞堟棃鎮￠妶鍡欑瘈濠电姴鍊绘晶鏇㈡煛?
        try {
          (window as any).tanvaImageInstances = [];
        } catch {}
        try {
          (window as any).tanvaModel3DInstances = [];
        } catch {}
        try {
          (window as any).tanvaTextItems = [];
        } catch {}

        // 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰惈缁犱即鏌熼梻瀵割槮缂佺姷濞€閺岀喖鎮ч崼鐔哄嚒缂備胶濮甸悧鏇㈠煘閹达附鍋愰柛娆忣槹閹瑧绱撴担鎻掍壕闂佸壊鍋嗛崰鍡樼濠婂牏鍙撻柛銉ｅ妽鐏忎即鏌熼崗鐓庡闁哄本鐩俊鎼佸煛閳ь剟骞夋ィ鍐╃厸?AI 闂傚倸鍊搁崐鐑芥倿閿曞倸绠栭柛顐ｆ礀绾惧潡鏌＄仦璇插姎缁炬儳娼￠弻鐔煎箚閻楀牜妫勭紒鍓у亾鐎笛囧箞閵娿儙鐔稿緞缁嬫寧鍎撶紓浣瑰劤瑜扮偟鍒掑▎鎾宠摕闁绘梻鍘х粻姘辨喐韫囨稒鏅€广儱顦伴悡娆撴煟閿濆懓瀚伴柍璇茬墦閺岋紕浠︾拠鎻掝瀳闂佸疇妫勯ˇ顖濈亽闂佸吋绁撮弲娑欐叏閸楃偐鏀介柣鎰摠缂嶆垿鏌ｉ妸褍鍘寸€殿喗鐓￠幃鈺呮嚑椤掍焦顔曟繝寰锋澘鈧劙宕戦幘娣簻闁瑰墽鍋ㄩ崑銏⑩偓瑙勬礈閸犳牠銆佸鈧幃鈺呮濞戞鐤囬梻鍌欐祰椤曆呪偓娑掓櫊椤㈡瑩寮介鐐电崶濠德板€愰崑鎾绘偂閵堝棛绡€濠电姴鍊绘晶鏇㈡煛鐎ｂ晝绐旈柡灞炬礋瀹曠厧鈹戦崶鑸殿棧缂傚倷绀佹晶搴ㄥ磻閻旂厧绠熺紒瀣硶閺嗗棝鏌嶈閸撴稑危閹扮増鍊风痪鐗埫禍楣冩煥濠靛棝顎楅柡瀣枛閺?dataURL/base64
        try {
          clipboardService.clear();
        } catch {}
        try {
          contextManager.clearImageCache();
        } catch {}

        // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐叉疄婵°倧绲介崯顐も偓姘槹閵囧嫰骞掗崱妞惧婵＄偑鍊ゆ禍婊堝疮閺夋垹鏆﹂柟鐑樺焾濞尖晠鏌曟径鍫濈仼濞存粓绠栭弻鐔兼倻濮楀棙鐣堕悗鐟版啞缁诲啴濡甸崟顖氬唨妞ゎ厽鍨堕悾鐑芥⒑?Flow 闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堢嵁閺嶎収鏁冮柨鏇楀亾缁惧墽鎳撻埞鎴︽偐鐎圭姴顥濈紒鐐劤椤兘寮婚妸銉㈡斀闁糕剝锕╁Λ銈夋⒑瀹曞洨甯涙俊顐㈠暣閻涱噣寮介‖銉ラ叄椤㈡鍩€椤掑嫬鐒垫い鎺嶇贰濞堟绱掗纰辩吋鐎规洘绮忛ˇ瀵哥棯閹佸仮闁哄瞼鍠栭、娑㈠幢濡も偓閺嗙喐绻涢崼婵囪础缂佽鲸鎸婚幏鍛鐎ｎ亝鎳欑紓鍌欐祰椤曆囨偋閹捐绠栧ù鍏兼儗閺佸鏌嶈閸撶喖鐛繝鍌ょ叆闁割偆鍠庢禒娲⒒閸屾氨澧涚紒瀣尰鐎靛ジ宕堕浣叉嫼闂佺厧顫曢崐鏇炵毈缂傚倷娴囬崺鏍х暆閹间礁违闁稿瞼鍋為弲婊堟煟閹伴潧澧い蹇旀倐濮婅櫣绱掑Ο鑽ゅ弳闂佸憡鑹鹃澶婄暦閻㈢鐐婃い鎺戝€歌ぐ鍕⒑閹肩偛鍔€闁告侗鍘煎В鍫㈢磽閸屾瑩妾烽柛鏂款儔瀹曪繝骞庨挊澶岀暫閻庣懓瀚竟瀣几鎼淬垻绠鹃柛鈩兠悘鈺呮煛閸℃瑥鈻堥柟顔煎槻椤劑宕熼鍌氬殥闂備胶顭堥敃銈夋倶濠靛鏁嬮柨婵嗩樈閺佸棝鏌涢弴銊ヤ簽闁稿﹦鍋ゅ娲箰鎼粹懇鎷婚梺鐑╁墲濡啫鐣烽幋锕€惟闁挎柨澧介鏇㈡⒑閹稿海绠撻柟鍐茬箲瀵板嫰宕熼鐘碉紲闁荤姴娲﹁ぐ鍐焵椤掆偓濞硷繝鐛?
        try {
          const api = useProjectContentStore.getState();
          api.updatePartial(
            { flow: { nodes: [], edges: [] } },
            { markDirty: true }
          );
        } catch {}

        // 缂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏇炲€搁拑鐔兼煏婵炵偓娅撻柡浣稿閺屾稑鈽夐崡鐐茬闂佸搫妫庨崐婵嬪蓟濞戙垹鐒洪柛鎰⒔閸旂兘姊哄畷鍥ㄥ殌缂佸鏁搁幑銏犫攽鐎ｎ偒妫冨┑鐐村灦閻燁垰螞閵堝鈷戦柛锔诲幗濞呮洖鈹戦鑺ュ唉闁糕斂鍎插鍕箛椤掑偆鍟嬫俊鐐€栭悧妤呮儗椤旂晫鐝堕柡鍥╁枔缁♀偓闂佹眹鍨藉褎绂掑鍕箚妞ゆ劑鍨肩€氫即宕￠柆宥嗙厱闁哄洢鍔岄獮妤併亜椤愶絾绀冪紒缁樼箞濡啫鈽夊顒夋澑闂備胶顭堢换鎴犲垝瀹ュ桅闁告洦鍨扮猾宥夋煕閵夋垵鍟崕顏嗙磽?store.paperJson/assets 闂傚倸鍊峰ù鍥х暦閻㈢纾婚柣鎰惈缁€鍕喐閻楀牆绗掔痪鎯ь煼閺屾盯寮撮妸銉т哗缂備胶濮烽弫濠氬蓟瀹ュ浼犻柛鏇ㄥ墮濞呫倝姊虹紒妯虹瑨妞ゎ厾鍏樺濠氭晲婢跺﹦鐫勯梺閫炲苯澧い顏勫暣瀹曞綊顢欏顓熴仢妞ゃ垺顨婂畷鐔碱敆閸屾艾绠洪梻鍌欑閸熷潡骞栭锕€纾圭紓浣股戝▍鐘垫喐閺冨牆绠栫憸鐗堝笒缁犳稒銇勯弬鍨倯闁诲繐鐗撳娲箹閻愭彃顬夐梺绋垮婵炲﹪鍨鹃敃鍌毼╅柍杞扮缁愭稑顪冮妶鍛闁瑰啿绻愰埢宥夊醇閵夛腹鎷绘繛鎾村焹閸嬫挻绻涢懖鈺冨笡濞ｅ洤锕畷鍫曨敆閳ь剛澹曢崸妤佺厪闁割偅绻冮崳鎶芥煛鐎ｎ亞校缂佺粯鐩畷鍗炍熺拠鏌ョ€洪梻?
        try {
          await paperSaveService.saveImmediately();
        } catch {}

        // 闂傚倸鍊搁崐椋庣矆娓氣偓閹潡宕惰閺嬫牠鏌￠崶鈺佹瀻闁搞劍妫冮幃妤呮濞戞瑦鍠愮紓?闂傚倸鍊峰ù鍥х暦閸偅鍙忛柡澶嬪殮濞差亜顫呴柕鍫濇噽閿涚喖姊洪崫鍕潶闁稿氦浜划鏄忋亹閹烘挴鎷洪梺鍓茬厛閸ｎ噣宕曢幇顑芥斀妞ゆ牗姘ㄩ幗鐘电磼缂佹绠栫紒缁樼箞瀹曟帒顫濋鐘辩矚缂傚倸鍊烽悞锕傚船閼姐倗绀婂〒姘ｅ亾鐎殿喖顭烽弫鎾绘偐閼碱剦妲规俊鐐€栭崝鎴﹀磹閺囥垹浼犳繛宸簼閳锋垿姊洪銈呬粶闁兼椿鍨遍弲鍫曨敍濠婂懐锛滃銈嗘閸嬫劖鏅堕姀銏㈢＜妞ゆ洖鎳庨獮妤冣偓鍨緲鐎氫即鐛崶顒夋晢闁稿本绮岄獮鈧繝纰夌磿閸嬫垿宕愰弽顓熷亱婵°倕鍟伴惌娆撴煙閻戞ɑ鐓涢柛瀣崌閹粙宕归锝嗙槗婵犳鍠栭敃锕傚磿閵堝绠氶柡鍐ㄧ墕缁犲鏌涜箛鎾村櫣妞ゃ儲宀稿濠氬磼濞嗘帒鍘￠梺绋款儍閸旀垵鐣烽弴銏″殤妞ゆ帊绀佹惔濠囨⒑瑜版帒浜伴柛鐘愁殜閿濈偤寮撮悘璇茬秺瀹曟宕楅懖鈺冣枏闂佽崵鍠愰悷杈╃不閹捐绠栨慨妞诲亾闁诡喗鐟﹂幏鍛村礃閳哄ň鍋撳Δ鍛拺闁告稑锕ラ悡銉╂倵濮橆厽绶叉い顐㈢箰鐓ゆい蹇撳椤斿矂姊洪崷顓炲妺闁哄鍓熸俊鑸靛緞鐎ｎ剙骞?undo/redo 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩铏珨濠电姷顣藉Σ鍛村磻閸涙番鈧啯寰勯幇顑╋箓鏌熼悧鍫熺凡闂佸崬娲弻锟犲炊閳轰焦鐎惧┑鐐叉噺閻楃娀骞冨Δ鍛濠㈣泛锕ｆ竟鏇㈡⒒娴ｅ憡鍟炴繛璇х畵瀹曟垿宕ㄧ€涙ê浠ч梺姹囧灩閹诧繝鍩涢幋锔藉仩婵炴垶宸婚崑鎾诲礂閸涱収妫滈梻鍌氬€烽懗鍓佸垝椤栫偛绀夐柨鏇炲€哥粈鍫熸叏濡灝鐓愰柡鍜佸墴閹鏁愭惔鈩冪亾闂佸憡鐟﹂幑鍥蓟濞戙垹唯闁靛濡囬妴鎰箾鐎涙鐭岄柛瀣ㄥ€濆璇测槈濡攱鐎婚棅顐㈡处娓氭鍩€椤掍緡娈曢柕鍥у瀵挳顢旈崱娅烘粓鎮楀▓鍨灍闁瑰憡濞婇獮鍐煛閸涱喗鍎銈嗗姧缂嶅棝宕?
        try {
          await historyService.resetToCurrent("clear-canvas");
        } catch {}
      } catch (e) {
        console.error("濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰惈缁犱即鏌熼梻瀵割槮缂佺姷濞€閺岀喖鎮ч崼鐔哄嚒闂佺粯鎸婚敃銏ゅ蓟閳ユ剚鍚嬮幖绮光偓宕囶啈闂備胶顭堥鍐礉閹达箑绠栫憸鐗堝笒閻愬﹥銇勮箛鎾愁伀婵絻鍨归—鍐Χ閸涱垳顔夊┑鐐插悑閻熲晠鍨鹃敃鍌氶敜婵°倐鍋撶紒鐘冲哺閺岀喎鈻撻崹顔界亾缂傚倸鐗撴禍鍫曞蓟?", e);
        alert(t("workspace.settings.workspaceTab.clearCanvasFailed"));
      }
    })();
  };

  const { user, logout, loading, connection } = useAuthStore();

  // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鍨鹃幇浣圭稁缂傚倷鐒﹁摫闁告瑥绻橀弻鐔碱敍閿濆洣姹楅悷婊呭鐢帡鎮欐繝鍐︿簻闁瑰搫绉堕ˇ锕€霉閻樿櫕銇濇慨濠冩そ濡啫鈽夋潏鈺佸綃缂傚倷鑳舵慨鐢稿垂閸ф绠栭柨鐔哄Т閸楁娊鏌曡箛銉х？闁?Google API Key 闂傚倸鍊峰ù鍥х暦閸偅鍙忕€规洖娲ㄩ惌鍡椕归敐鍫綈婵炲懐濮撮湁闁绘ê妯婇崕鎰版煕?
  useEffect(() => {
    if (!user) return;
    authApi.getGoogleApiKey().then(setGoogleApiKeyInfo).catch(console.warn);
  }, [user]);

  // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鍨鹃幇浣圭稁缂傚倷鐒﹁摫闁告瑥绻橀弻鐔碱敍閿濆洣姹楅悷婊呭鐢帡鎮欐繝鍐︿簻闁瑰搫绉堕ˇ锕€霉閻樿櫕銇濇慨濠冩そ濡啫鈽夋潏鈺佸綃缂傚倷鑳舵慨鐢稿垂閸ф绠栭柨鐔哄Т閸楁娊鏌ｅΟ鍏兼毄闁挎稒绮嶇换婵嬪閿濆懐鍘梺鎸庡哺閺岋綀绠涢弴鐐╂瀰闂佸搫鏈惄顖涗繆閹间礁唯闁靛鍠栨俊椋庣磽閸屾瑧顦﹂柣顓炲€圭粋宥夊醇閺囩偞妲梺鍛婃处閸ㄦ壆绮堥崘顏呭枑闊洦娲滈惌鍡涙煃?
  useEffect(() => {
    if (!user) return;
    let canceled = false;
    setCreditsLoading(true);
    setDailyRewardLoading(true);
    Promise.allSettled([getMyCredits(), getDailyRewardStatus()])
      .then(([creditsResult, dailyRewardResult]) => {
        if (canceled) return;
        if (creditsResult.status === "fulfilled")
          setCreditsInfo(creditsResult.value);
        else console.warn(creditsResult.reason);
        if (dailyRewardResult.status === "fulfilled")
          setDailyRewardStatus(dailyRewardResult.value);
        else console.warn(dailyRewardResult.reason);
      })
      .finally(() => {
        if (canceled) return;
        setCreditsLoading(false);
        setDailyRewardLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [user]);

  const refreshCreditsAndDailyReward = useCallback(async () => {
    if (!user) return;
    setCreditsLoading(true);
    setDailyRewardLoading(true);
    try {
      const [creditsResult, dailyRewardResult] = await Promise.allSettled([
        getMyCredits(),
        getDailyRewardStatus(),
      ]);
      if (creditsResult.status === "fulfilled")
        setCreditsInfo(creditsResult.value);
      else console.warn(creditsResult.reason);
      if (dailyRewardResult.status === "fulfilled")
        setDailyRewardStatus(dailyRewardResult.value);
      else console.warn(dailyRewardResult.reason);
    } finally {
      setCreditsLoading(false);
      setDailyRewardLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!isSettingsOpen || !user) return;
    refreshCreditsAndDailyReward();
  }, [isSettingsOpen, refreshCreditsAndDailyReward, user]);

  // 闂傚倸鍊搁崐鐑芥嚄閸洖纾块柣銏㈩焾閻ょ偓绻濇繝鍌滃闁搞劌鍊块弻锝夊閵忊晝鍔哥紓浣哄У閼归箖鈥﹂崸妤佸殝闂傚牊绋戦～宀€绱撴担鎻掍壕闂佺鐬奸崑鐐烘偂韫囨挴鏀介柣鎰皺娴犮垽鏌涢弬璇测偓鏍崲濠靛鐒垫い鎺戝缁犮儲銇勯弬鍨挃闁挎稒绮嶇换婵嬪閿濆懐鍘梺鎸庡哺閺岋綀绠涢弴鐐╂瀰闂佸搫鏈惄顖涗繆閹间礁唯闁宠桨绀侀崣濠囨煟鎼淬値娼愭繛鍙壝悾婵嬪箹娴ｆ瓕鎽曢梺闈浤涢埀顒勫磻閹剧粯鏅查幖绮光偓鑼晼闂備礁鎲¤摫闁告梹鐗滈幑銏犫槈濮橈絽浜炬繛鎴炵懐閻掍粙鏌ｉ鐑囨敾闁靛洤瀚伴獮瀣攽閸♀晙鎮ｉ梻?
  useEffect(() => {
    const handleRefreshCredits = () => {
      refreshCreditsAndDailyReward();
    };
    window.addEventListener("refresh-credits", handleRefreshCredits);
    return () => {
      window.removeEventListener("refresh-credits", handleRefreshCredits);
    };
  }, [refreshCreditsAndDailyReward]);

  const handleClaimDailyReward = useCallback(async () => {
    if (!user || dailyRewardClaiming) return;
    setDailyRewardClaiming(true);
    try {
      const result = await claimDailyReward();
      if (result.success) {
        alert(t("workspace.settings.workspaceTab.dailyReward.success"));
      } else if (result.alreadyClaimed) {
        alert(t("workspace.settings.workspaceTab.dailyReward.alreadyClaimed"));
      } else {
        alert(t("workspace.settings.workspaceTab.dailyReward.failed"));
      }
    } catch (e: any) {
      console.error("Failed to claim daily reward:", e);
      alert(e?.message || t("workspace.settings.workspaceTab.dailyReward.failed"));
    } finally {
      setDailyRewardClaiming(false);
      refreshCreditsAndDailyReward();
    }
  }, [dailyRewardClaiming, refreshCreditsAndDailyReward, t, user]);

  /** 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敃鈧壕鍦磽娴ｈ偂鎴濃枍閻樺厖绻嗛柕鍫濇噺閸ｆ椽鏌涚€ｎ亶妯€闁哄被鍔岄埞鎴﹀幢濡櫣鐛╁┑锛勫仩椤绻涙繝鍥ц摕闁挎繂顦粻娑㈡⒒閸喓鈽夋い顐熸櫊濮婃椽骞囨担椋庢晼闂佽桨鐒﹂幃鍌炲春閳ь剚銇勯幒宥囪窗闁哥喎绻橀弻娑㈡偐閸愬弶璇為悗瑙勬礃閸ㄥ潡鐛鈧畷婊勬媴閻氬搴婃繝鐢靛О閸ㄥジ宕洪弽顓熸櫔闂備浇顕х换鎺撶箾閳ь剟鏌＄仦鍓ф创濠碘剝鎮傛俊鐑芥晜閽樺妫烽梻鍌欑缂嶅﹪藟閹惧绠鹃柍褜鍓熼弻鈩冩媴缁嬪簱鍋撻崸妤€绠板┑鐘插暙缁剁偛鈹戦悩鎻掍簽婵☆偄鐗婄换婵堝枈婢跺瞼锛熼梺绋款儐閸ㄥ灝鐣烽幇顑╂棃宕ㄩ鐔蜂壕闁稿瞼鍎愰弫濠囨煟閹伴潧澧绘繛鑲╁枎閳规垿鎮欓崣澶樻！闂佹悶鍔忛崺鏍礆婵犲啰闄勯柛娑橈功閸橀亶姊洪崷顓炰壕妞ゃ劌鎳橀獮濠呯疀濞戞瑥鈧灚銇勯幘鍗炵仾闁抽攱鍨块弻娑樷槈濮楀牆浼愭繝娈垮枛濞差參寮婚悢鐓庣闁肩⒈鍓涢崝顖炴⒑缁洘鏉归柛瀣尭椤啴濡堕崱妤€娼戦梺绋款儐閹瑰洭寮婚敐澶樻晣婵犻潧鐗忛悰銏狀渻閵堝啫鐏柤褰掔畺閸┿儲寰勯幇顒夋綂闂佺粯顭囬弫鎼佸汲娴煎瓨鈷掑ù锝呮啞閸熺偛銆掑顓ф疁鐎规洘鍨块崺鈧い鎺戝閻撴洟鎮楅敐搴′簼閻忓浚鍘介妵鍕箻閻愯棄浠悗瑙勬礀閻栧ジ宕洪敓鐘茬＜婵炴垶锚婵矂姊?*/
  const openMyCreditsDetailPage = useCallback(() => {
    const base = import.meta.env.BASE_URL || "/";
    const originWithBase = `${window.location.origin}${
      base.endsWith("/") ? base : `${base}/`
    }`;
    const href = new URL("my-credits", originWithBase).href;
    window.open(href, "_blank", "noopener,noreferrer");
  }, []);

  /** 闂傚倸鍊搁崐鐑芥倿閿曞倹鍎戠憸鐗堝笒閸ㄥ倿鏌ゆ慨鎰偓鏇㈠垂濠靛洢浜滈柡宥冨妼閸ゎ剟鏌ｉ弬鎸庮棡濞ｅ洤锕、娑樷槈濮橆叀寮村┑鐐茬摠缁秶鍒掗幘璇茶摕闁靛牆顦导鐘绘煏婢舵盯妾慨锝呭濮婅櫣鍖栭弴鐔哥彅濡炪倧绠掓禍顒€危閹版澘绠抽柟鎯х－缁愮偛鈹戦埥鍡楃仴婵炲拑绲剧粋鎺楀煛閸涱喒鎷洪梺纭呭亹閸嬫稒淇婃總鍛娾拺閻㈩垼鍠氶崚浼存煟閿濆懎妲婚摶鏍煕濞戝崬甯ｉ柕濞炬櫆閻撳繐顭跨捄铏瑰闁告柣鍊楃槐鎺斺偓锝庝憾濡偓濠殿喖锕ュ浠嬬嵁閹邦厽鍎熼柨婵嗗€搁～宀€绱撴担鍝勪壕婵犮垺顭囩划鏃堟偨缁嬭法鏌ч梺鍓插亝濞叉﹢寮插┑瀣厓鐟滄粓宕滈悢绗衡偓浣割潩閼稿灚娅滄繝銏ｆ硾閿曪箓宕?VIP / 缂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾閽樻繂霉閻樺樊鍎忛柛銊ュ€搁湁闁稿繐鍚嬬紞鎴︽煕閵娿儱鈧潡鐛弽顐㈠灊閻熸瑥瀚峰鎴︽⒑閹肩偛鈧牕煤閻旂厧钃熸繛鎴欏灪閺呮粓鎮归崶銊ョ祷缂佺姴顭烽幃?*/
  const openMembershipHub = useCallback(() => {
    setIsMembershipOpen(true);
  }, []);

  const topCreditsText = useMemo(() => {
    if (creditsLoading && !creditsInfo) return "...";
    if (creditsInfo) return creditsInfo.balance.toLocaleString();
    return "--";
  }, [creditsInfo, creditsLoading]);
  const isEnglish = i18n.resolvedLanguage?.toLowerCase().startsWith("en");
  const isDarkTheme = chatTheme === "black";
  const zhThemeToDay = String.fromCharCode(0x5207, 0x6362, 0x5230, 0x767d, 0x5929, 0x4e3b, 0x9898);
  const zhThemeToNight = String.fromCharCode(0x5207, 0x6362, 0x5230, 0x591c, 0x665a, 0x4e3b, 0x9898);
  const themeToggleLabel =
    chatTheme === "black"
      ? isEnglish
        ? "Switch to day theme"
        : zhThemeToDay
      : isEnglish
        ? "Switch to night theme"
        : zhThemeToNight;

  const displayName =
    user?.name ||
    user?.phone?.slice(-4) ||
    user?.email ||
    user?.id?.slice(-4) ||
    t("common.user");
  const secondaryId =
    user?.email ||
    (user?.phone
      ? `${user.phone.slice(0, 3)}****${user.phone.slice(-4)}`
      : "") ||
    "";
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
        return { label: t("common.status.unknown"), color: "#9ca3af" };
    }
  })();
  const normalizedRole = (user?.role || "").trim().toLowerCase();
  const isAdmin = normalizedRole === "admin" || normalizedRole === "normal_admin";
  useEffect(() => {
    if (!isAdmin || typeof window === "undefined") {
      setFpsOverlayAdminButtonLayout(null);
      return;
    }

    const applyOverlayLayout = (detail?: {
      visible?: boolean;
      top?: number;
      left?: number;
      height?: number;
    }) => {
      if (!detail?.visible) {
        setFpsOverlayAdminButtonLayout(null);
        return;
      }

      const top = Number(detail.top);
      const left = Number(detail.left);
      const height = Number(detail.height);
      if (!Number.isFinite(top) || !Number.isFinite(left) || !Number.isFinite(height)) {
        setFpsOverlayAdminButtonLayout(null);
        return;
      }

      const size = Math.max(24, Math.round(height));
      const gap = 8;
      setFpsOverlayAdminButtonLayout({
        top,
        left: Math.max(12, left - gap - size),
        size,
      });
    };

    const handleOverlayLayout = (event: Event) => {
      const detail = (event as CustomEvent<{
        visible?: boolean;
        top?: number;
        left?: number;
        height?: number;
      }>).detail;
      applyOverlayLayout(detail);
    };

    window.addEventListener(
      "tanva:fps-overlay-layout",
      handleOverlayLayout as EventListener
    );

    const overlayEl = document.getElementById("tanva-fps-overlay");
    if (overlayEl) {
      const rect = overlayEl.getBoundingClientRect();
      applyOverlayLayout({
        visible: true,
        top: rect.top,
        left: rect.left,
        height: rect.height,
      });
    } else {
      applyOverlayLayout({ visible: false });
    }

    return () => {
      window.removeEventListener(
        "tanva:fps-overlay-layout",
        handleOverlayLayout as EventListener
      );
    };
  }, [isAdmin]);

  const showLibraryButton = false; // temporarily hide library entry
  const handleLogout = async () => {
    if (loading) return;
    try {
      console.log("[auth] logout start");
      await logout();
      console.log("[auth] logout success, redirecting");
      navigate("/auth/login", { replace: true });
    } catch (err) {
      console.error("[auth] logout failed:", err);
    }
  };

  const recentProjects = useMemo(() => {
    const sliced = projects.slice(0, MAX_QUICK_PROJECTS);
    if (currentProject && !sliced.some((p) => p.id === currentProject.id)) {
      const trimmed = sliced.slice(0, Math.max(MAX_QUICK_PROJECTS - 1, 0));
      return [...trimmed, currentProject];
    }
    return sliced;
  }, [projects, currentProject?.id]);
  const sendShortcutOptions = [
    {
      value: "enter" as const,
      label: t("workspace.settings.aiTab.shortcuts.enterLabel"),
      description: t("workspace.settings.aiTab.shortcuts.enterDesc"),
    },
    {
      value: "mod-enter" as const,
      label: "Ctrl/Cmd + Enter",
      description: t("workspace.settings.aiTab.shortcuts.modEnterDesc"),
    },
  ];
  const wheelZoomModeOptions = [
    {
      value: "modifier" as const,
      label: t("workspace.settings.aiTab.wheel.modifierLabel"),
      description: t("workspace.settings.aiTab.wheel.modifierDesc"),
    },
    {
      value: "direct" as const,
      label: t("workspace.settings.aiTab.wheel.directLabel"),
      description: t("workspace.settings.aiTab.wheel.directDesc"),
    },
  ];
  const renderSettingsContent = () => {
    switch (activeSettingsSection) {
      case "workspace":
        return (
          <div className='pb-6 space-y-5 '>
            {/* User Greeting Section */}
            <div className='flex items-center gap-4 mb-10 mt-8'>
              <div className='w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center text-base font-medium text-slate-600 shrink-0'>
                {displayName.charAt(0).toUpperCase()}
              </div>
              <div className='flex-1 min-w-0'>
                <div className='flex items-center gap-2 mb-0.5'>
                  <span className='text-base font-medium text-slate-900'>
                    {t("workspace.settings.workspaceTab.greeting", {
                      name: displayName,
                    })}
                  </span>
                </div>
                <div className='text-sm text-slate-400'>{secondaryId}</div>
              </div>
              <div className='shrink-0 text-sm leading-none text-right select-none'>
                <AutosaveStatus />
              </div>
            </div>

            {/* 缂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾閽樻繂霉閻樺樊鍎忛柛銊ュ€搁湁闁稿繐鍚嬬紞鎴︽煕閵娿儱鈧潡鐛弽顬ュ酣顢楅埀顒勬倶椤曗偓閺屽秹鎮烽幍顔а囨煛鐏炵晫效闁糕斁鍓濋幏鍛村川婵犲喚鍚欑紓鍌氬€峰ù鍥ㄣ仈閹间焦鍋嬮柣妯款嚙閽冪喐绻涢幋鐑嗙劯闁哄啫鍊甸崑鎾绘晲鎼粹€愁潾闂佹寧绋撻崰鎰崲?*/}
            <div className='p-6 rounded-2xl bg-slate-50'>
              <div className='flex items-center justify-between mb-6'>
                <div className='flex items-center gap-3'>
                  <Zap className='w-4 h-4 text-blue-500' />
                  <span className='text-lg font-medium text-slate-700'>
                    {t("workspace.settings.workspaceTab.credits.title")}
                  </span>
                </div>
                <button
                  type='button'
                  onClick={() => {
                    setIsSettingsOpen(false);
                    openMyCreditsDetailPage();
                  }}
                  className='text-sm text-slate-500 hover:text-slate-700'
                >
                  {t("workspace.settings.workspaceTab.credits.detail")}
                </button>
              </div>

              <div className='flex items-end justify-between py-2'>
                {creditsLoading ? (
                  <div className='text-sm text-slate-500'>
                    {t("workspace.settings.workspaceTab.loading")}
                  </div>
                ) : creditsInfo ? (
                  <div className='flex items-baseline gap-2'>
                    <span className='text-5xl font-bold text-slate-800'>
                      {creditsInfo.balance}
                    </span>
                    <span className='text-base text-slate-400'>
                      {t("workspace.settings.workspaceTab.credits.unit")}
                    </span>
                  </div>
                ) : (
                  <div className='text-sm text-slate-500'>
                    {t("workspace.settings.workspaceTab.credits.empty")}
                  </div>
                )}
              </div>
            </div>

            <div className='grid gap-4 sm:grid-cols-2 pt-5'>
              <button
                className='flex items-center justify-center gap-2 h-12 bg-white border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-colors'
                onClick={() => {
                  setIsSettingsOpen(false);
                  openModal();
                }}
              >
                <Square className='w-4 h-4' />
                {t("workspace.settings.workspaceTab.openManageFile")}
              </button>
              <button
                className='flex items-center justify-center gap-2 h-12 bg-white border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-colors'
                onClick={() => navigate("/")}
              >
                <Home className='w-4 h-4' />
                {t("workspace.settings.workspaceTab.backHome")}
              </button>
            </div>

            <div className='grid gap-3 sm:grid-cols-2'>
              <button
                className='flex items-center justify-center gap-2 h-12 bg-white border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-colors'
                onClick={() => setIsGlobalHistoryOpen(true)}
              >
                <History className='w-4 h-4' />
                {t("workspace.settings.workspaceTab.globalHistory")}
              </button>
              <button
                className='flex items-center justify-center gap-2 h-12 bg-white border border-red-200 rounded-xl text-sm text-red-500 hover:bg-red-50 transition-colors'
                onClick={handleClearCanvas}
              >
                <Trash2 className='w-4 h-4' />
                {t("workspace.settings.workspaceTab.clearCanvas")}
              </button>
            </div>
          </div>
        );
      case "referral":
        return <ReferralRewards />;
      case "appearance":
        return (
          <div className='pb-6 space-y-6'>
            {/* 婵犵數濮烽弫鎼佸磿閹寸姴绶ら柦妯侯棦濞差亝鏅滈柣鎰靛墮鎼村﹪姊虹粙璺ㄧ伇闁稿鍋ゅ畷鎴﹀Χ婢跺鍘繝鐢靛€崘顭戜患闂佸搫顑呴崐鍨潖閾忕懓瀵查柡鍥╁仜閳峰顪冮妶鍐ㄥ婵☆偅绋撻崚鎺斺偓锝庡枛闁卞洭鏌曟径娑橆洭闁告ɑ鎮傞幃妤呯嵁閸喖濮庨梺鐟板暱缁绘ê鐣烽弶璇剧喎效閸ワ妇鐩?*/}
            <div className='border-b border-slate-100 pt-5 pb-6'>
              <div className='flex items-center justify-between'>
                <div>
                  <h3 className='text-base font-medium text-slate-800'>
                    {t("workspace.settings.appearanceTab.saveView.title")}
                  </h3>
                  <p className='text-xs text-slate-400 mt-1'>
                    {t("workspace.settings.appearanceTab.saveView.desc")}
                  </p>
                </div>
                <Button
                  variant='outline'
                  size='sm'
                  className='p-5 rounded-3xl text-sm'
                  onClick={handleSaveAppearanceSettings}
                >
                  {t("workspace.settings.appearanceTab.saveView.button")}
                </Button>
              </div>
              {saveFeedback === "success" && (
                <div className='mt-2 text-xs text-green-600'>
                  {t("workspace.settings.appearanceTab.saveView.saved")}
                </div>
              )}
              {saveFeedback === "error" && (
                <div className='mt-2 text-xs text-red-600'>
                  {t("workspace.settings.appearanceTab.saveView.saveFailed")}
                </div>
              )}
            </div>

            {/* 闂傚倸鍊搁崐宄邦渻閹烘梹顫曟い鏃€鍎崇欢銈吤归悩宸剱闁稿孩顨婇弻娑氫沪閹冩瘓闂佺粯甯婄划娆撳蓟閻斿皝鏋旈柛顭戝枟閻忓秹鏌ｆ惔銏㈩暡缁炬澘绉规俊鐢稿礋椤栨氨顔掑銈嗙墬娓氭鍩€椤掆偓濡繈寮?*/}
            <div className='flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800'>
              <div>
                <div className='text-sm font-medium text-slate-700 dark:text-slate-200'>
                  {t("workspace.appearance.languageTitle")}
                </div>
                <div className='text-xs text-slate-400 mt-0.5 dark:text-slate-500'>
                  {t("workspace.appearance.languageDesc")}
                </div>
              </div>
              <LanguageSwitcher compact />
            </div>

            {/* 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸閻ゎ喗銇勯弽顐粶闁搞劌鍊块弻娑㈩敃閿濆棛顦ㄩ梺绋款儏椤戝洨妲愰幒鏂哄亾閿濆骸寮垮Δ鐘茬箻閺屽秷顧侀柛鎾存皑閺侇噣鍨惧畷鍥ㄦ闂佹寧绻傚Λ妤冩閻愮儤鍊堕柣鎰煐椤ュ鏌?+ 闂傚倸鍊搁崐鐑芥嚄閸撲礁鍨濇い鏍仜妗呭┑鐐村灟閸ㄥ綊鎮块悙顒傜瘈闂傚牊渚楅崕蹇曠磼閻樺磭澧柍瑙勫灴閹晠宕ｆ径瀣€烽梺鑽ゅ枑閻熻京绮婚幘璇茶摕闁绘柨鍚嬮埛鎺楁倵閻㈡鐒惧┑陇妫勯—?*/}
            <div className='flex items-start justify-between gap-10'>
              <div className='flex items-center gap-4 flex-1'>
                <div className='flex-1'>
                  <div className='text-sm font-medium text-slate-700 dark:text-slate-200'>
                    {t("workspace.settings.appearanceTab.gridRender.title")}
                  </div>
                  <div className='text-xs text-slate-400 mt-0.5 dark:text-slate-500'>
                    {t("workspace.settings.appearanceTab.gridRender.desc")}
                  </div>
                </div>
                <Switch
                  checked={showGrid}
                  onCheckedChange={toggleGrid}
                  className='h-5 w-9'
                />
              </div>
              <div className='flex items-center gap-4 flex-1'>
                <div className='flex-1'>
                  <div className='text-sm font-medium text-slate-700 dark:text-slate-200'>
                    {t("workspace.settings.appearanceTab.snap.title")}
                  </div>
                  <div className='text-xs text-slate-400 mt-0.5 dark:text-slate-500'>
                    {t("workspace.settings.appearanceTab.snap.desc")}
                  </div>
                </div>
                <Switch
                  checked={snapAlignmentEnabled}
                  onCheckedChange={toggleSnapAlignment}
                  className='h-5 w-9'
                />
              </div>
            </div>

            {/* 婵犵數濮烽。顔炬閺囥垹纾绘繛鎴欏焺閺佸嫰鏌涘☉鍗炵仚闁稿鎸搁埥澶愬箳閹惧褰嬮梻浣筋嚃閸燁偊宕惰椤旀劖绻涙潏鍓ф偧妞ゎ厼鐗撳畷顒勫Ω閳哄倸鈧敻鏌ｉ悢鍛婄凡妞ゅ浚浜滈…鍧楁偡閻楀牜妫ゅ┑鐐村灩閺佸宕洪埀?+ 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸閻ゎ喗銇勯弽顐粶闁搞劌鍊块弻娑㈩敃閿濆棛顦ㄩ梺绋款儏椤戝寮婚悢鍏尖拻閻庨潧澹婂Σ顔剧磼缂併垹骞愰柛瀣崌濮婄粯鎷呴崨濠冨創濠电偠顕滅粻鎴︼綖濠靛惟鐟滃繘鎯?*/}
            <div className='flex items-start justify-between gap-8'>
              <div className='flex-1'>
                <div className='text-sm font-medium text-slate-700 pb-3 dark:text-slate-200'>
                  {t("workspace.settings.appearanceTab.style.title")}
                </div>
                <div className='inline-flex rounded-full bg-slate-100 p-1 dark:bg-slate-700'>
                  {[
                    {
                      value: GridStyle.LINES,
                      label: t("workspace.settings.appearanceTab.style.grid"),
                    },
                    {
                      value: GridStyle.SOLID,
                      label: t("workspace.settings.appearanceTab.style.solid"),
                    },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type='button'
                      onClick={() => setGridStyle(option.value)}
                      className={cn(
                        "px-4 py-2 rounded-full text-sm transition-all",
                        gridStyle === option.value
                          ? "bg-white text-slate-700 shadow-sm dark:bg-slate-600 dark:text-slate-100"
                          : "text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-300"
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className='flex-1'>
                <div className='text-sm font-medium text-slate-700 pb-3 dark:text-slate-200'>
                  {t("workspace.settings.appearanceTab.gridUnit.title")}
                </div>
                <div className='flex items-center gap-2 border border-slate-200 w-28 rounded-3xl dark:border-slate-600'>
                  <input
                    type='number'
                    min={1}
                    max={200}
                    value={gridSizeInput}
                    onChange={(e) => setGridSizeInput(e.target.value)}
                    onBlur={commitGridSize}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitGridSize();
                      if (e.key === "Escape")
                        setGridSizeInput(String(gridSize));
                      e.stopPropagation();
                    }}
                    className='w-18 px-3 py-2 text-sm text-center focus:border-blue-500 focus:outline-none bg-transparent text-slate-700 dark:text-slate-200'
                  />
                  <span className='text-xs text-slate-400 dark:text-slate-500'>px</span>
                </div>
              </div>
            </div>

            {/* 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹闂佸湱鍎ら崵锕€鈽夊Ο閿嬫杸闂佺硶鈧磭绠查柣蹇庣窔閹嘲顭ㄩ崟顒夋閻?*/}
            <div className='border-b border-slate-100 dark:border-slate-700'></div>

            {/* 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌ｉ姀銏╃劸闁汇倗鍋撶换婵囩節閸屾粌顣哄┑鈽嗗亝閿氶柕鍡樺笒椤繈鏁愰崨顒€顥氶梺璇叉唉椤煤閳哄啫绶ゅù鐘差儛閺佸洭鏌涜箛鏇炲付缂佸墎鍋炴穱濠囶敍濠靛棗鎯為梺鍝勮嫰閻楁挸顫忔繝姘＜婵炲棙鍨肩粣妤呮⒑缁嬫鍎忔俊顐ｇ箓閻ｇ兘鎮ч崼鐔峰妳闂佹寧绻傞崐鍛婄?*/}
            <div>
              <div className='text-sm font-medium text-slate-700 dark:text-slate-200'>
                {t("workspace.settings.appearanceTab.zoom.title")}
              </div>
              <div className='text-xs text-slate-400 mt-0.5 mb-4 dark:text-slate-500'>
                {t("workspace.settings.appearanceTab.zoom.desc")}
              </div>
              <div className='flex items-center gap-4'>
                <input
                  type='range'
                  min={1}
                  max={10}
                  step={1}
                  value={zoomSensitivity}
                  onChange={(e) => setZoomSensitivity(Number(e.target.value))}
                  className='flex-1 h-1 rounded-full appearance-none cursor-pointer bg-slate-200 accent-slate-400 dark:bg-slate-600'
                />
                <span className='text-sm text-slate-500 w-6 text-right dark:text-slate-400'>
                  {zoomSensitivity}
                </span>
              </div>
            </div>

            {/* 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹闂佸湱鍎ら崵锕€鈽夊Ο閿嬫杸闂佺硶鈧磭绠查柣蹇庣窔閹嘲顭ㄩ崟顒夋閻?*/}
            <div className='border-b border-slate-100 dark:border-slate-700'></div>

            {/* 闂傚倸鍊搁崐宄懊归崶銊х彾闁割偁鍎荤紞鏍ь熆鐠鸿櫣鏄傚ù婊冪秺閺屾盯骞囬棃娑欑亪缂佹儳褰炵划娆忣潖婵犳艾閱囬柣鏂垮槻楠炲繘姊虹紒妯烩拻闁告鍥ㄥ€剁€规洖娲犻崑鎾舵喆閸曨剛顦ュ┑鐐茬湴閸旀垿濡?*/}
            <div className='flex items-center justify-between'>
              <div>
                <div className='text-sm font-medium text-slate-700 dark:text-slate-200'>
                  {t("workspace.settings.appearanceTab.gridColor.title")}
                </div>
              </div>
              <div className='flex items-center'>
                <input
                  type='color'
                  value={gridColor}
                  onChange={(e) => setGridColor(e.target.value)}
                  className='w-8 h-8 rounded-full border-0 cursor-pointer overflow-hidden'
                  style={{ WebkitAppearance: "none" }}
                />
              </div>
            </div>

            {/* 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹闂佸湱鍎ら崵锕€鈽夊Ο閿嬫杸闂佺硶鈧磭绠查柣蹇庣窔閹嘲顭ㄩ崟顒夋閻?*/}
            <div className='border-b border-slate-100 dark:border-slate-700'></div>

            {/* 闂傚倸鍊风粈渚€骞栭位鍥敃閿曗偓閻ょ偓绻濋棃娑卞剰缁炬儳顭烽弻锝夊籍閸屾艾浠橀梺鍛婅壘缂嶅﹪鐛弽顓炵妞ゆ挾鍠撶粣娆戠磽娴ｇ懓鏁剧紒鎻掑⒔閹广垹鈹戦崶鈺冪槇闂佺鏈笟妤€螞閻愬樊娓?*/}
            <div>
              <div className='text-sm font-medium text-slate-700 dark:text-slate-200'>
                {t("workspace.settings.appearanceTab.edgeColorMode.title")}
              </div>
              <div className='text-xs text-slate-400 mt-0.5 mb-3 dark:text-slate-500'>
                {t("workspace.settings.appearanceTab.edgeColorMode.desc")}
              </div>
              <div className='inline-flex rounded-full bg-slate-100 p-1 dark:bg-slate-700'>
                <button
                  type='button'
                  onClick={() => setEdgeColorMode(FlowEdgeColorMode.STANDARD)}
                  className={cn(
                    "px-4 py-1 rounded-full text-sm transition-all",
                    edgeColorMode === FlowEdgeColorMode.STANDARD
                      ? "bg-white text-slate-700 shadow-sm dark:bg-slate-600 dark:text-slate-100"
                      : "text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-300"
                  )}
                >
                  {t("workspace.settings.appearanceTab.edgeColorMode.standard")}
                </button>
                <button
                  type='button'
                  onClick={() => setEdgeColorMode(FlowEdgeColorMode.HANDLE)}
                  className={cn(
                    "px-4 py-1 rounded-full text-sm transition-all",
                    edgeColorMode === FlowEdgeColorMode.HANDLE
                      ? "bg-white text-slate-700 shadow-sm dark:bg-slate-600 dark:text-slate-100"
                      : "text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-300"
                  )}
                >
                  {t("workspace.settings.appearanceTab.edgeColorMode.handle")}
                </button>
              </div>
            </div>

            {/* 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹闂佸湱鍎ら崵锕€鈽夊Ο閿嬫杸闂佺硶鈧磭绠查柣蹇庣窔閹嘲顭ㄩ崟顒夋閻?*/}
            <div className='border-b border-slate-100 dark:border-slate-700'></div>

            {/* AI 闂傚倸鍊峰ù鍥敋瑜嶉湁闁绘垼妫勯弸渚€鏌熼梻鎾闁逞屽厸閻掞妇鎹㈠┑瀣倞闁靛鍎辨晶楣冩⒒娴ｈ棄袚闁挎碍銇勯敃浣诡棄闂囧鏌″搴″箺闁绘挻娲熼弻宥夊煛娴ｅ憡鐏撻梺缁樺笩濡嫰鈥﹂崸妤佸仭闂侇叏闄勯埢鍫ユ⒑?*/}
            <div>
              <div className='text-sm font-medium text-slate-700 mb-3 dark:text-slate-200'>
                {t("workspace.settings.appearanceTab.chatStyle.title")}
              </div>
              <div className='inline-flex rounded-full bg-slate-100 p-1 dark:bg-slate-700'>
                <button
                  type='button'
                  onClick={() => setExpandedPanelStyle("transparent")}
                  className={cn(
                    "px-4 py-1 rounded-full text-sm transition-all",
                    expandedPanelStyle === "transparent"
                      ? "bg-white text-slate-700 shadow-sm dark:bg-slate-600 dark:text-slate-100"
                      : "text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-300"
                  )}
                >
                  {t("workspace.settings.appearanceTab.chatStyle.transparent")}
                </button>
                <button
                  type='button'
                  onClick={() => setExpandedPanelStyle("solid")}
                  className={cn(
                    "px-5 py-2 rounded-full text-sm transition-all",
                    expandedPanelStyle === "solid"
                      ? "bg-white text-slate-700 shadow-sm dark:bg-slate-600 dark:text-slate-100"
                      : "text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-300"
                  )}
                >
                  {t("workspace.settings.appearanceTab.chatStyle.solid")}
                </button>
              </div>
            </div>

          </div>
        );
      case "ai":
        return (
          <div className='pb-6 space-y-6'>
            <div className='flex flex-col gap-4 p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur dark:border-slate-700 dark:bg-slate-800/90 sm:flex-row sm:items-center sm:justify-between'>
              <div>
                <div className='text-sm font-medium text-slate-700 dark:text-slate-200'>
                  {t("workspace.settings.aiTab.imageOnly.title")}
                </div>
                <div className='text-xs text-slate-500 dark:text-slate-400'>
                  {t("workspace.settings.aiTab.imageOnly.desc")}
                </div>
              </div>
              <Switch
                checked={imageOnly}
                onCheckedChange={setImageOnly}
                className='h-5 w-9'
              />
            </div>

            <div className='p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur dark:border-slate-700 dark:bg-slate-800/90'>
              <div className='flex items-start gap-2 mb-3'>
                <Send className='w-4 h-4 text-blue-600 dark:text-blue-400' />
                <div>
                  <div className='text-sm font-medium text-slate-700 dark:text-slate-200'>
                    {t("workspace.settings.aiTab.shortcuts.title")}
                  </div>
                  <div className='text-xs text-slate-500 dark:text-slate-400'>
                    {t("workspace.settings.aiTab.shortcuts.desc")}
                  </div>
                </div>
              </div>
              <div className='grid gap-2 sm:grid-cols-2'>
                {sendShortcutOptions.map((option) => {
                  const active = sendShortcut === option.value;
                  return (
                    <button
                      key={option.value}
                      type='button'
                      onClick={() => setSendShortcut(option.value)}
                      className={cn(
                        "w-full rounded-xl border px-3 py-3 text-left transition-all",
                        active
                          ? "border-blue-500 bg-blue-50 shadow-sm dark:border-blue-400 dark:bg-blue-900/30"
                          : "border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/40 dark:border-slate-600 dark:bg-slate-700 dark:hover:border-blue-500 dark:hover:bg-blue-900/20"
                      )}
                    >
                      <div className='flex items-center justify-between gap-2'>
                        <div className='text-sm font-medium text-slate-700 dark:text-slate-100'>
                          {option.label}
                        </div>
                        {active && <Check className='w-4 h-4 text-blue-600 dark:text-blue-400' />}
                      </div>
                      <div className='mt-1 text-xs text-slate-500 dark:text-slate-400'>
                        {option.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className='p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur dark:border-slate-700 dark:bg-slate-800/90'>
              <div className='flex items-start gap-2 mb-3'>
                <Globe className='w-4 h-4 text-indigo-600 dark:text-indigo-400' />
                <div>
                  <div className='text-sm font-medium text-slate-700 dark:text-slate-200'>
                    {t("workspace.settings.aiTab.wheel.title")}
                  </div>
                  <div className='text-xs text-slate-500 dark:text-slate-400'>
                    {t("workspace.settings.aiTab.wheel.desc")}
                  </div>
                </div>
              </div>
              <div className='grid gap-2 sm:grid-cols-2'>
                {wheelZoomModeOptions.map((option) => {
                  const active = wheelZoomMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type='button'
                      onClick={() => setWheelZoomMode(option.value)}
                      className={cn(
                        "w-full rounded-xl border px-3 py-3 text-left transition-all",
                        active
                          ? "border-indigo-500 bg-indigo-50 shadow-sm dark:border-indigo-400 dark:bg-indigo-900/30"
                          : "border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40 dark:border-slate-600 dark:bg-slate-700 dark:hover:border-indigo-500 dark:hover:bg-indigo-900/20"
                      )}
                    >
                      <div className='flex items-center justify-between gap-2'>
                        <div className='text-sm font-medium text-slate-700 dark:text-slate-100'>
                          {option.label}
                        </div>
                        {active && <Check className='w-4 h-4 text-indigo-600 dark:text-indigo-400' />}
                      </div>
                      <div className='mt-1 text-xs text-slate-500 dark:text-slate-400'>
                        {option.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className='p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur dark:border-slate-700 dark:bg-slate-800/90'>
              <div className='mb-4 text-sm font-medium text-slate-700 dark:text-slate-200'>
                {t("workspace.settings.aiTab.provider.title")}
              </div>
              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                {/* 闂傚倸鍊搁崐鐑芥倿閿曞倸绠栭柛顐ｆ礀绾惧潡鏌熷▓鍨灈闁搞劍绻冪换娑㈠幢濡や胶顩伴梺璇叉唉閸╂牠濡甸崟顖氬唨妞ゆ劦婢€濞岊亪姊虹粙娆惧剰妞ゆ垵顦靛璇测槈閵忊晜鏅濋梺闈涚墕閹冲繘鎮楁繝姘拺濞村吋鐟ч悾杈ㄣ亜椤撶偛妲绘い顐㈢箻閹煎綊宕烽鈶╂敽闂佽鍑界紞鍡樼濠靛鍊堕柛顐犲劜閳锋垿鏌涘☉姗堝伐闁诲繐绉归弻宥堫檨闁告挻宀稿鍛婄附缁嬪灝鍤戦梺鍝勭▉閸樹粙鎮¤箛鎾斀闁绘劙娼ф禍鐐箾閸涱厽鍣虹紒?
                <button
                  onClick={() => setAIProvider("gemini-pro", { source: "global" })}
                  className={cn(
                    "relative rounded-xl border-2 p-4 text-left transition-all",
                    aiProvider === "gemini-pro"
                      ? "border-green-500 bg-green-50"
                      : "border-slate-200 bg-white hover:border-green-300 hover:bg-green-50/30"
                  )}
                >
                  <div className='flex items-start justify-between'>
                    <div className='flex-1'>
                      <div className='flex items-center gap-2 mb-1'>
                        <Sparkles className='w-4 h-4 text-green-600' />
                        <span className='text-sm font-medium text-slate-700'>
                          闂傚倸鍊搁崐鐑芥倿閿曞倸绠栭柛顐ｆ礀绾惧潡鏌熷▓鍨灈闁搞劍绻冪换娑㈠幢濡や胶顩伴梺璇叉唉閸╂牠濡甸崟顖氬唨妞ゆ劦婢€濞岊亪姊?
                        </span>
                      </div>
                      <div className='text-xs text-slate-500'>
                        闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐蹭画濡炪倖鐗滈崑娑㈠垂閸屾稏浜滈柡宥冨妿閵嗘帞绱掗悩鑽ょ暫闁哄本鐩俊鐑筋敊閻撳寒娼介梻浣侯焾椤戝啴宕濋幋锕€钃熼柡鍥╁枔缁犻箖鏌涢…鎴濇灀闁稿鎸搁埞鎴犫偓锝庝簻閹偤鏌ｆ惔顖滅У闁逞屽厵閸ㄥ骞婇幘鐑┾偓锕傚Ω閳轰礁绐涘銈嗙墬閸掆偓妞ゃ劎甯撴繝鐢靛Х閺佹悂宕戦悙鍝勫瀭闁割偅娲栫粻浼存煕濠靛嫬鍔ら柣顓熸崌閺岋綁濮€閵忊剝姣勯梺娲诲幗閹瑰洭寮婚敐澶婄闁挎繂鎲涢幘缁樼厱闁靛牆鍊告禍鎯р攽閻樿尙妫勯柡澶婄氨閸嬫捇寮撮姀鐘哄煘濡炪倖鎸鹃崑鎰板绩娴犲鍊甸柨婵嗛娴滄繃绻?
                      </div>
                    </div>
                    {aiProvider === "gemini-pro" && (
                      <Check className='flex-shrink-0 w-5 h-5 text-green-600' />
                    )}
                  </div>
                </button>
                */}

                <button
                  onClick={() => setAIProvider("banana", { source: "global" })}
                  className={cn(
                    "relative rounded-xl border-2 p-4 text-left transition-all",
                    aiProvider === "banana"
                      ? "border-amber-500 bg-amber-50 dark:border-amber-400 dark:bg-amber-900/30"
                      : "border-slate-200 bg-white hover:border-amber-300 hover:bg-amber-50/30 dark:border-slate-600 dark:bg-slate-700 dark:hover:border-amber-500 dark:hover:bg-amber-900/20"
                  )}
                >
                  <div className='flex items-start justify-between'>
                    <div className='flex-1'>
                      <div className='flex items-center gap-2 mb-1'>
                        <Zap className='w-4 h-4 text-amber-600 dark:text-amber-400' />
                        <span className='text-sm font-medium text-slate-700 dark:text-slate-100'>
                          {t("workspace.settings.aiTab.provider.banana")}
                        </span>
                      </div>
                      <div className='text-xs text-slate-500 dark:text-slate-400'>
                        {t("workspace.settings.aiTab.provider.bananaDesc")}
                      </div>
                    </div>
                    {aiProvider === "banana" && (
                      <Check className='flex-shrink-0 w-5 h-5 text-amber-600 dark:text-amber-400' />
                    )}
                  </div>
                </button>

                <button
                  onClick={() => setAIProvider("banana-3.1", { source: "global" })}
                  className={cn(
                    "relative rounded-xl border-2 p-4 text-left transition-all",
                    aiProvider === "banana-3.1"
                      ? "border-rose-500 bg-rose-50 dark:border-rose-400 dark:bg-rose-900/30"
                      : "border-slate-200 bg-white hover:border-rose-300 hover:bg-rose-50/30 dark:border-slate-600 dark:bg-slate-700 dark:hover:border-rose-500 dark:hover:bg-rose-900/20"
                  )}
                >
                  <div className='flex items-start justify-between'>
                    <div className='flex-1'>
                      <div className='flex items-center gap-2 mb-1'>
                        <Sparkles className='w-4 h-4 text-rose-600 dark:text-rose-400' />
                        <span className='text-sm font-medium text-slate-700 dark:text-slate-100'>
                          {t("workspace.settings.aiTab.provider.banana31")}
                        </span>
                      </div>
                      <div className='text-xs text-slate-500 dark:text-slate-400'>
                        {t("workspace.settings.aiTab.provider.banana31Desc")}
                      </div>
                    </div>
                    {aiProvider === "banana-3.1" && (
                      <Check className='flex-shrink-0 w-5 h-5 text-rose-600 dark:text-rose-400' />
                    )}
                  </div>
                </button>

                <button
                  onClick={() => setAIProvider("banana-2.5", { source: "global" })}
                  className={cn(
                    "relative rounded-xl border-2 p-4 text-left transition-all",
                    aiProvider === "banana-2.5"
                      ? "border-orange-500 bg-orange-50 dark:border-orange-400 dark:bg-orange-900/30"
                      : "border-slate-200 bg-white hover:border-orange-300 hover:bg-orange-50/30 dark:border-slate-600 dark:bg-slate-700 dark:hover:border-orange-500 dark:hover:bg-orange-900/20"
                  )}
                >
                  <div className='flex items-start justify-between'>
                    <div className='flex-1'>
                      <div className='flex items-center gap-2 mb-1'>
                        <Zap className='w-4 h-4 text-orange-600 dark:text-orange-400' />
                        <span className='text-sm font-medium text-slate-700 dark:text-slate-100'>
                          {t("workspace.settings.aiTab.provider.banana25")}
                        </span>
                      </div>
                      <div className='text-xs text-slate-500 dark:text-slate-400'>
                        {t("workspace.settings.aiTab.provider.banana25Desc")}
                      </div>
                    </div>
                    {aiProvider === "banana-2.5" && (
                      <Check className='flex-shrink-0 w-5 h-5 text-orange-600 dark:text-orange-400' />
                    )}
                  </div>
                </button>
              </div>
            </div>

            {/* Nano Banana/Gemini 闂傚倸鍊峰ù鍥х暦閸偅鍙忕€规洖娲︽刊浼存煥閺囩偛鈧悂宕归崒鐐寸厵闁诡垳澧楅ˉ澶愭煕濮橆剛绉烘鐐寸墬濞煎繘宕滆钃卞┑鐘愁問閸ㄤ即濡堕幖浣歌摕婵炴垯鍨圭粻缁樹繆閵堝倸浜鹃梺鐟板暱缁绘﹢骞?*/}
            <div className='p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur dark:border-slate-700 dark:bg-slate-800/90'>
              <div className='mb-1 text-sm font-medium text-slate-700 dark:text-slate-200'>
                {t("workspace.settings.aiTab.bananaRoute.title")}
              </div>
              <div className='mb-4 text-xs text-slate-500 dark:text-slate-400'>
                {t("workspace.settings.aiTab.bananaRoute.desc")}
              </div>
              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <button
                  type='button'
                  onClick={() => setBananaImageRoute("normal")}
                  className={cn(
                    "relative rounded-xl border-2 p-4 text-left transition-all",
                    bananaImageRoute === "normal"
                      ? "border-sky-500 bg-sky-50 dark:border-sky-400 dark:bg-sky-900/30"
                      : "border-slate-200 bg-white hover:border-sky-300 hover:bg-sky-50/30 dark:border-slate-600 dark:bg-slate-700 dark:hover:border-sky-500 dark:hover:bg-sky-900/20"
                  )}
                >
                  <div className='flex items-start justify-between'>
                    <div className='flex-1'>
                      <div className='flex items-center gap-2 mb-1'>
                        <Zap className='w-4 h-4 text-sky-600 dark:text-sky-400' />
                        <span className='text-sm font-medium text-slate-700 dark:text-slate-100'>
                          {t("workspace.settings.aiTab.bananaRoute.normal")}
                        </span>
                      </div>
                      <div className='text-xs text-slate-500 dark:text-slate-400'>
                        {t("workspace.settings.aiTab.bananaRoute.normalDesc")}
                      </div>
                    </div>
                    {bananaImageRoute === "normal" && (
                      <Check className='flex-shrink-0 w-5 h-5 text-sky-600 dark:text-sky-400' />
                    )}
                  </div>
                </button>

                <button
                  type='button'
                  onClick={() => setBananaImageRoute("stable")}
                  className={cn(
                    "relative rounded-xl border-2 p-4 text-left transition-all",
                    bananaImageRoute === "stable"
                      ? "border-emerald-500 bg-emerald-50 dark:border-emerald-400 dark:bg-emerald-900/30"
                      : "border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/30 dark:border-slate-600 dark:bg-slate-700 dark:hover:border-emerald-500 dark:hover:bg-emerald-900/20"
                  )}
                >
                  <div className='flex items-start justify-between'>
                    <div className='flex-1'>
                      <div className='flex items-center gap-2 mb-1'>
                        <Star className='w-4 h-4 text-emerald-600 dark:text-emerald-400' />
                        <span className='text-sm font-medium text-slate-700 dark:text-slate-100'>
                          {t("workspace.settings.aiTab.bananaRoute.stable")}
                        </span>
                      </div>
                      <div className='text-xs text-slate-500 dark:text-slate-400'>
                        {t("workspace.settings.aiTab.bananaRoute.stableDesc")}
                      </div>
                    </div>
                    {bananaImageRoute === "stable" && (
                      <Check className='flex-shrink-0 w-5 h-5 text-emerald-600 dark:text-emerald-400' />
                    )}
                  </div>
                </button>
              </div>
              {!bananaProviderSelected && (
                <div className='mt-3 text-xs text-amber-600 dark:text-amber-400'>
                  {t("workspace.settings.aiTab.bananaRoute.hint")}
                </div>
              )}
            </div>

            {false && (
            <div className='p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur'>
              <div className='flex items-center gap-2 mb-4'>
                <Key className='w-4 h-4 text-green-600' />
                <div className='text-sm font-medium text-slate-700'>
                  Google Gemini API Key
                </div>
              </div>
              <div className='mb-4 text-xs text-slate-500'>
                闂傚倸鍊搁崐椋庢濮橆剦鐒介柤濮愬€栫€氬鏌ｉ弮鍌氬付缂佲偓婢跺ň鏀介柣妯哄级閹兼劙鏌ｉ幒鎴犱粵闁靛洤瀚伴獮鎺楀幢濡炴儳顥氶梻鍌欑閸氬顪冮崸妤€鍨傚ù鐓庣摠缁犳帗绻濆閿嬫緲閳ь剚娲熼獮濠呯疀濞戞鍘遍梺鍝勫暙閻楀﹪鎮￠弴鐔虹闁瑰瓨绻傞懜褰掓煟韫囨洖校闁靛洤瀚伴弫鎰板川椤愵澀鍒掗梻浣告惈閺堫剙煤閻旈鏆﹂柛妤冨€ｉ弮鍫濈闁告劘娉曠壕璺ㄧ磼鏉堛劌绗掗摶鏍煃瑜滈崜鐔肩嵁婵犲懐鐤€闁瑰灝鍟伴崝鐑芥椤愩垺澶勭紒瀣灩缁粯绻濆顓犲幈闂佸綊鍋婇崢鑲╁緤缂佹ɑ鍙忛悷娆忓閸欌偓濠殿喖锕ュ浠嬪箖閳╁啯鍎熸い鏃傛櫕閺嬪啫鈹戦悙鑼憼缂侇喖绉堕崚鎺撴償閵娿儳顔夐梺闈涢獜缁辨洟鎮疯ぐ鎺撶厓鐟滄粓宕滈悢濂夊殨?Google API Key
                闂傚倸鍊风粈渚€骞栭位鍥敃閿曗偓閻ょ偓绻濇繝鍌涘櫧闁活厽鐟╅弻鈥愁吋鎼粹€崇闂侀€炲苯鍘哥紒鑸靛哺閻涱喚鈧綆鍠楅弲婊堟煢濡警妲风紓鍌涙崌濮婄粯鎷呴搹鐟扮濠碘槅鍋勯崯鏉戭嚕閵婏附缍囬柍鍝勫暟閻掑潡姊洪崜鎻掍簴闁稿孩鐓￠幃锟犲Ψ閿斿墽顔曢梺鐟邦嚟娴兼繈顢旈崼娑掑亾閸愩劉鏋庨柟瀵稿Х閿涙粌鈹戞幊閸婃劙宕戦幘娣簻闁挎棁顕ч悘锕傛煕閳瑰灝鍔滅€垫澘瀚伴獮鍥敆閸曨偅鏆梻鍌欑劍鐎笛呮崲閸岀偛纾归柛娑橈功椤╂煡鏌ｉ幇闈涘幐缂佽妫濋弻鏇㈠醇濠靛洤娅ｉ梺杞扮贰娴滄繄鎹㈠┑瀣棃婵炴垵宕崜鎵磽娴ｆ彃浜鹃梺绯曞墲缁嬫帡鎮￠弴銏＄厓闁宠桨绀侀弳娆忊攽椤旂懓浜鹃梻鍌欒兌椤牓顢栭崱娑樼闁搞儜鍛闂佸湱鍎ら崹鐔煎几鎼淬劍鐓欓悗鐢殿焾鏍￠梺鍝ュУ鐢€愁潖濞差亜浼犻柛鏇炵仛绗戦梻浣虹帛椤ㄥ懘鏁冮鍫㈠祦闁圭増婢樼粻鐟懊归敐鍛喐闁绘挻鍨垮铏瑰寲閺囩偛鈷夌紓浣割儐閸ㄥ湱鍒掗崼銉ュ耿婵☆垵鍋愰鏇㈡⒑缁洖澧叉い銊ワ躬椤㈡挸螖閸涱喚鍘撻柣鐘叉穿鐏忔瑧绮绘繝姘厸鐎光偓鐎ｎ剛袦闂佹寧绻勯崑銈夈€佸Δ鍛劦妞ゆ帊妞掔换鍡涙煕瑜庨〃鍡涘煕閹寸偑浜滈柡鍐ㄥ€甸幏锟犳煕閵堝洤鏋旂紒杈ㄥ笚濞煎繘濡搁妷锕佺檨闂備浇顕栭崰鎾诲垂娴犲绠犻柡宥庡幖閻撴稑霉閿濆嫯顒熼柛瀣斿洦鈷?Key闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熸潏楣冩闁稿顑呴埞鎴︽偐閹绘帩浼€闂佹椿鍘介幑鍥蓟閿濆绠ｉ柨婵嗘啗閹剧粯鐓曢柕鍫濆€告禍鎯р攽閻樿尙妫勯柡澶婄氨閸嬫捇寮撮姀鐘哄煘濡炪倖鎸鹃崑鎰板绩娴犲鍊甸柨婵嗙凹缁ㄨ姤銇勯敂璇蹭喊婵﹨娅ｉ崠鏍即閻曚焦缍夐梻浣告啞閿氬褏鏅崚鎺楀醇閵夈儱鑰垮┑鐐村灦閻熝囧矗?
              </div>

              <div className='p-3 mb-4 border rounded-xl bg-slate-50 border-slate-100'>
                <div className='flex items-center justify-between'>
                  <div className='text-xs text-slate-600'>
                    闂傚倷娴囧畷鐢稿窗閹邦喖鍨濋幖娣灪濞呯姵淇婇妶鍛櫣缂佺姳鍗抽弻娑樷槈濮楀牊鏁惧┑鐐叉噽婵炩偓闁哄矉绲借灒闁告繂瀚ˉ婵嬫⒑缂佹ɑ鈷掗柛妯犲洦鍊剁€规洖娲犻崑鎾舵喆閸曨剛顦ュ┑鐐茬湴閸旀垿濡存笟鈧畷銊р偓娑櫱氶幏?
                    <span
                      className={cn(
                        "ml-1 font-medium",
                        googleApiKeyInfo.mode === "custom"
                          ? "text-green-600"
                          : "text-blue-600"
                      )}
                    >
                      {googleApiKeyInfo.mode === "custom"
                        ? "婵犵數濮烽弫鎼佸磻閻樿绠垫い蹇撴缁€濠囨煃瑜滈崜姘辨崲濞戞瑥绶為悗锝庡亞椤︿即鎮楀▓鍨珮闁稿锕ユ穱濠囨嚋闂堟稓绐為柣搴秵娴滄繈鎮挎担閫涚箚闁绘劦浜滈埀顒佹礈閹广垽骞囬鐟颁壕婵鍘у▍宥団偓娈垮枦濞呮洜鈧絻鍋愰埀顒佺⊕椤洭宕?Key"
                        : "婵犵數濮烽弫鎼佸磻閻樿绠垫い蹇撴缁€濠囨煃瑜滈崜姘辨崲濞戞瑥绶為悗锝庡亞椤︿即鎮楀▓鍨珮闁稿锕ユ穱濠囧醇閺囩偟鍊為悷婊冪Ч椤㈡俺顦规慨濠冩そ閹剝鎯旈鐣岀◥闂備胶顭堥敃銉┿€冩繝鍌滄殾婵炲樊浜濋崑鎰偓鐟板閸犳宕戦妷銉㈡斀闁绘劖娼欓悘锕傛煟閻曚礁鐏﹂柟顔惧仱閹瑩顢栭崣銉х泿?Key"}
                    </span>
                  </div>
                  {googleApiKeyInfo.hasCustomKey &&
                    googleApiKeyInfo.maskedKey && (
                      <div className='font-mono text-xs text-slate-500'>
                        {googleApiKeyInfo.maskedKey}
                      </div>
                    )}
                </div>
              </div>

              {/* 闂傚倸鍊风粈渚€骞栭位鍥敍閻愭潙浜辨繝鐢靛Т濞层倗绮绘导瀛樼厵闂傚倸顕ˇ锕傛煟椤撶噥娈滈柡灞剧洴閸╁嫰宕橀浣割潓闂?*/}
              <div className='flex flex-col gap-3'>
                <div className='relative'>
                  <input
                    type={showGoogleApiKey ? "text" : "password"}
                    value={googleApiKeyInput}
                    onChange={(e) => setGoogleApiKeyInput(e.target.value)}
                    placeholder={
                      googleApiKeyInfo.hasCustomKey
                        ? "闂傚倸鍊风粈渚€骞栭位鍥敍閻愭潙浜辨繝鐢靛Т濞层倗绮绘导瀛樼厵闂傚倸顕ˇ锕傛煟椤撶噥娈滈柡灞剧洴閸╁嫰宕橀浣诡潔婵犵妲呴崑鍛存晝閵忋倕钃熼柣鏂跨殱閺嬫棃鏌涢…鎴濇灍闁诲繐绉瑰?Key 婵犵數濮烽弫鎼佸磻濞戙埄鏁嬫い鎾跺枑閸欏繐霉閸忓吋缍戠痪鎯ф健閺岀喓绱掑Ο铏诡攨濠电偛妯婃禍婊堟煥閵堝棔绻嗛柕鍫濆閸斿秵绻?.."
                        : "闂傚倸鍊风粈渚€骞栭位鍥敍閻愭潙浜辨繝鐢靛Т濞层倗绮绘导瀛樼厵闂傚倸顕ˇ锕傛煟?Google Gemini API Key..."
                    }
                    className='w-full px-3 py-2 pr-10 font-mono text-sm border rounded-lg border-slate-200 focus:border-green-500 focus:outline-none'
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && googleApiKeyInput.trim()) {
                        handleSaveGoogleApiKey();
                      }
                      e.stopPropagation();
                    }}
                  />
                  <button
                    type='button'
                    onClick={() => setShowGoogleApiKey(!showGoogleApiKey)}
                    className='absolute p-1 -translate-y-1/2 right-2 top-1/2 text-slate-400 hover:text-slate-600'
                    title={showGoogleApiKey ? "Hide key" : "Show key"}
                  >
                    {showGoogleApiKey ? (
                      <EyeOff className='w-4 h-4' />
                    ) : (
                      <Eye className='w-4 h-4' />
                    )}
                  </button>
                </div>

                <div className='flex gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    className={cn(
                      "flex-1 rounded-xl text-sm border-green-200 text-green-600 hover:bg-green-50",
                      googleApiKeySaving && "opacity-70"
                    )}
                    disabled={googleApiKeySaving || !googleApiKeyInput.trim()}
                    onClick={handleSaveGoogleApiKey}
                  >
                    {googleApiKeySaving ? "Saving..." : "Save Key"}
                  </Button>
                  {googleApiKeyInfo.hasCustomKey && (
                    <Button
                      variant='outline'
                      size='sm'
                      className={cn(
                        "rounded-xl text-sm border-red-200 text-red-600 hover:bg-red-50",
                        googleApiKeySaving && "opacity-70"
                      )}
                      disabled={googleApiKeySaving}
                      onClick={handleClearGoogleApiKey}
                    >
                      Clear
                    </Button>
                  )}
                </div>

                {/* 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐蹭画闂侀潧锛忛崨顖滃帬闁荤喐绮庢晶妤冩暜閸ヮ剙鐒垫い鎺嗗亾闁硅櫕锕㈤妴浣割潨閳ь剟骞冮姀銏″仒闁斥晛鍟弳銈夋⒒閸屾瑧鍔嶉柡瀣偢瀵彃鈽夐姀鐘垫焾闂佸啿鎼崯顖烇綖?*/}
                {googleApiKeyFeedback === "success" && (
                  <div className='text-xs text-green-600'>Saved</div>
                )}
                {googleApiKeyFeedback === "error" && (
                  <div className='text-xs text-red-600'>Save failed, please retry</div>
                )}
              </div>
            </div>
            )}
          </div>
        );
      case "advanced":
        return (
          <div className='pb-6 space-y-6'>
            {import.meta.env.DEV && (
              <div className='flex flex-col gap-3 p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur dark:border-slate-700 dark:bg-slate-800/90 sm:flex-row sm:items-center sm:justify-between'>
                <div>
                  <div className='text-sm font-medium text-slate-700 dark:text-slate-200'>
                    {t("workspace.settings.advancedTab.memory.title")}
                  </div>
                  <div className='text-xs text-slate-500 dark:text-slate-400'>
                    {t("workspace.settings.advancedTab.memory.desc")}
                  </div>
                </div>
                <Button
                  variant='outline'
                  className='text-sm rounded-xl'
                  onClick={() => setShowMemoryDebug(!showMemoryDebug)}
                >
                  <Activity className='w-4 h-4 mr-2' />
                  {showMemoryDebug
                    ? t("workspace.settings.advancedTab.closePanel")
                    : t("workspace.settings.advancedTab.openPanel")}
                </Button>
              </div>
            )}
            {import.meta.env.DEV && (
              <div className='flex flex-col gap-3 p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur dark:border-slate-700 dark:bg-slate-800/90 sm:flex-row sm:items-center sm:justify-between'>
                <div>
                  <div className='text-sm font-medium text-slate-700 dark:text-slate-200'>
                    {t("workspace.settings.advancedTab.history.title")}
                  </div>
                  <div className='text-xs text-slate-500 dark:text-slate-400'>
                    {t("workspace.settings.advancedTab.history.desc")}
                  </div>
                </div>
                <Button
                  variant='outline'
                  className='text-sm rounded-xl'
                  onClick={() => setShowHistoryDebug(!showHistoryDebug)}
                >
                  <History className='w-4 h-4 mr-2' />
                  {showHistoryDebug
                    ? t("workspace.settings.advancedTab.closePanel")
                    : t("workspace.settings.advancedTab.openPanel")}
                </Button>
              </div>
            )}
            <div className='flex flex-col gap-3 p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur dark:border-slate-700 dark:bg-slate-800/90 sm:flex-row sm:items-center sm:justify-between'>
              <div>
                <div className='text-sm font-medium text-slate-700 dark:text-slate-200'>
                  {t("workspace.settings.advancedTab.sandbox.title")}
                </div>
                <div className='text-xs text-slate-500 dark:text-slate-400'>
                  {t("workspace.settings.advancedTab.sandbox.desc")}
                </div>
              </div>
              <Button
                variant='outline'
                className='text-sm text-gray-900 rounded-xl border-gray-800/20 hover:bg-gray-800/10 dark:text-gray-100 dark:border-gray-600 dark:hover:bg-gray-800'
                onClick={() => {
                  const { toggleSandboxPanel } = useUIStore.getState();
                  toggleSandboxPanel();
                  setIsSettingsOpen(false);
                }}
              >
                <Code className='w-4 h-4 mr-2' />
                {t("workspace.settings.advancedTab.sandbox.open")}
              </Button>
            </div>
            <div className='flex flex-col gap-3 p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur dark:border-slate-700 dark:bg-slate-800/90 sm:flex-row sm:items-center sm:justify-between'>
              <div>
                <div className='text-sm font-medium text-slate-700 dark:text-slate-200'>
                  {t("workspace.settings.advancedTab.logout.title")}
                </div>
                <div className='text-xs text-slate-500 dark:text-slate-400'>
                  {t("workspace.settings.advancedTab.logout.desc")}
                </div>
              </div>
              <Button
                variant='outline'
                className={cn(
                  "rounded-xl text-sm border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-900/20",
                  loading ? "opacity-70" : ""
                )}
                disabled={loading}
                onClick={handleLogout}
              >
                <LogOut className='w-4 h-4 mr-2' />
                {loading
                  ? t("workspace.settings.advancedTab.logout.loading")
                  : t("workspace.settings.advancedTab.logout.button")}
              </Button>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <div
        aria-hidden={focusMode}
        className={cn(
          "tanva-header-shell fixed top-4 left-0 right-0 z-50 px-4 flex items-start justify-between gap-4 transition-all duration-[50ms] ease-out pointer-events-none",
          showLayerPanel ? "left-[306px]" : "left-0",
          focusMode && "hidden"
        )}
      >
        {/* 闂傚倷娴囬褎顨ラ崫銉х濠电姴鍋嗛悞浠嬫煠婵劕鈧澹曢懞銉﹀弿婵☆垱瀵х涵楣冩煟閵堝鐣洪柡灞剧洴椤㈡洟鏁愰崱娆樻К闂備礁鎲￠崝蹇涘磻閹剧粯鈷掑┑鐘查娴滄粍绻涚仦鍌氱伈鐎规洘娲栭悾鐑藉炊閳哄啫绠垫繝纰樺墲椤ㄥ牓銆侀崳淇?+ Beta + 婵犵數濮烽。顔炬閺囥垹纾婚柟杈剧畱绾惧綊鏌￠崶鈺佸壋闁兼澘娼￠弻娑樜旈崘褏闂梺缁樺灦閿氭い鏇憾閺屸剝寰勭€ｎ亞浼囬悶姘箞閺岋絾鎯旈敍鍕殯闂佺楠稿畷顒勫煝?*/}
        <div className='tanva-header-card tanva-header-card-left flex items-center gap-2 md:gap-3 px-4 md:px-6 py-2 h-[46px] rounded-2xl bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass transition-all duration-300 pointer-events-auto'>
          {/* Logo */}
          <div
            className='tanva-brand-logo-wrap flex w-[88px] h-[24px] items-center justify-center cursor-pointer hover:opacity-80 transition-opacity select-none'
            onClick={handleLogoClick}
            title={t("workspace.header.backHome")}
          >
            <img
              src={chatTheme === "black" ? "/tanvas_ai.png" : "/TAI-logo-2.png"}
              className='tanva-brand-logo-img h-6 w-auto object-contain'
              alt='Logo'
              draggable='false'
              style={{
                imageRendering: "auto",
                WebkitFontSmoothing: "antialiased",
              }}
            />
          </div>
          {/* 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹闂佸湱鍎ら崵锕€鈽夊Ο閿嬫杸闂佺硶鈧磭绠查柣蹇庣窔閹嘲顭ㄩ崟顒夋閻?*/}
          <div className='tanva-header-divider w-px h-5 bg-gray-300/40' />

          {/* 婵犵數濮烽。顔炬閺囥垹纾婚柟杈剧畱绾惧綊鏌￠崶鈺佸壋闁兼澘娼￠弻娑樜旈崘褏闂梺缁樺灦閿氭い鏇憾閺屸剝寰勭€ｎ亞浼囬悶姘箞閺岋絾鎯旈敍鍕殯闂佺楠稿畷顒勫煝閺冨牊鏅濋柛灞剧☉閳ь剛鍏橀幃妤呮偨閻㈢偣鈧﹪鏌＄€ｎ偆澧甸柡宀€鍠栭幊鏍煛閸曞﹤顦甸弻娑㈠箻鐎靛摜鐣鹃梺闈涙处閸旀瑦淇婇悜钘夌厸闁稿本顨嗙€氬吋淇婇悙顏勨偓鏍礉閹达箑纾归柡鍥ュ灩閸戠娀骞栧ǎ顒€濡介柣鎾存礋閺屾洘绻涢崹顔煎Б缂備胶濮撮…鐑藉蓟?*/}
          <div className='items-center hidden gap-1 sm:flex'>
            {editingTitle ? (
              <input
                autoFocus
                className='h-6 text-sm px-2 rounded border border-slate-300 bg-white/90 min-w-[200px] max-w-[380px]'
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitTitle();
                  if (e.key === "Escape") setEditingTitle(false);
                  e.stopPropagation();
                }}
              />
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(
                    "tanva-project-selector flex items-center gap-1 px-2 py-1 transition-colors bg-transparent border-none rounded-full cursor-pointer select-none",
                    isDarkTheme ? "hover:bg-slate-700/45" : "hover:bg-slate-100"
                  )}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setEditingTitle(true);
                  }}
                >
                  <ChevronDown
                    className={cn("w-4 h-4", isDarkTheme ? "text-slate-300" : "text-slate-500")}
                  />
                  <span
                    className={cn(
                      "truncate text-sm max-w-[260px]",
                      isDarkTheme ? "text-slate-100" : "text-gray-800"
                    )}
                    title={t("workspace.header.renameHint")}
                  >
                    {localizeProjectName(currentProject?.name)}
                  </span>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align='start'
                  sideOffset={12}
                  className={cn(
                    "tanva-project-dropdown-content min-w-[220px] rounded-xl px-2 py-1.5 overflow-hidden",
                    isDarkTheme
                      ? "border border-slate-700 bg-slate-800"
                      : "border border-slate-200 bg-white shadow-lg"
                  )}
                  style={
                    isDarkTheme
                      ? {
                          boxShadow: "0 20px 44px rgba(0, 0, 0, 0.5)",
                        }
                      : undefined
                  }
                >
                  <DropdownMenuLabel
                    className={cn(
                      "px-2 pb-1 text-[11px] font-medium",
                      isDarkTheme ? "text-slate-400" : "text-slate-400"
                    )}
                  >
                    {t("workspace.header.switchProject")}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator
                    className='mb-1'
                    style={isDarkTheme ? { background: "rgba(148, 163, 184, 0.25)" } : undefined}
                  />
                  <div className='max-h-[340px] overflow-y-auto space-y-0.5'>
                    {recentProjects.length === 0 ? (
                      <DropdownMenuItem
                        disabled
                        className={cn(
                          "cursor-default",
                          isDarkTheme ? "text-slate-500" : "text-slate-400"
                        )}
                      >
                        {t("workspace.header.noProjects")}
                      </DropdownMenuItem>
                    ) : (
                      recentProjects.map((project) => (
                        <DropdownMenuItem
                          key={project.id}
                          onClick={(event) => {
                            event.preventDefault();
                            handleQuickSwitch(project.id);
                          }}
                          className={cn(
                            "flex items-center justify-between gap-3 px-2 py-1 text-sm",
                            isDarkTheme
                              ? "text-slate-100 hover:!bg-slate-700/70"
                              : "text-slate-700"
                          )}
                        >
                          <span
                            className={cn(
                              "truncate",
                              isDarkTheme ? "text-slate-100" : "text-slate-700"
                            )}
                          >
                            {localizeProjectName(project.name)}
                          </span>
                          {project.id === currentProject?.id && (
                            <Check className='w-4 h-4 text-blue-600' />
                          )}
                        </DropdownMenuItem>
                      ))
                    )}
                  </div>
                  <DropdownMenuSeparator
                    className='my-1'
                    style={isDarkTheme ? { background: "rgba(148, 163, 184, 0.25)" } : undefined}
                  />
                  <DropdownMenuItem
                    onClick={(event) => {
                      event.preventDefault();
                      openModal();
                    }}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1 text-sm",
                      isDarkTheme
                        ? "text-blue-300 hover:text-blue-200 hover:!bg-slate-700/70"
                        : "text-blue-600 hover:text-blue-700"
                    )}
                  >
                    <FolderOpen className='w-4 h-4' />
                    {t("workspace.header.openManageFile")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(event) => {
                      event.preventDefault();
                      void handleQuickCreateProject();
                    }}
                    disabled={isQuickCreatingProject}
                    className={cn(
                      "flex items-center justify-between gap-3 px-2 py-1 text-sm",
                      isDarkTheme
                        ? "text-blue-300 hover:text-blue-200 hover:!bg-slate-700/70"
                        : "text-blue-600 hover:text-blue-700"
                    )}
                  >
                    <span className='flex items-center gap-2'>
                      <span className='inline-flex items-center justify-center w-4 h-4 text-xs border border-current rounded-full'>
                        +
                      </span>
                      {t("workspace.header.newProject")}
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <button
              type='button'
              onClick={() => {
                void handleQuickCreateProject();
              }}
              disabled={isQuickCreatingProject}
              className={cn(
                "tanva-header-new-project-btn inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-500 transition-colors",
                isQuickCreatingProject
                  ? "cursor-not-allowed opacity-60"
                  : "hover:text-slate-700"
              )}
              title={t("workspace.header.newProject")}
              aria-label={t("workspace.header.newProject")}
            >
              <Plus className='w-3.5 h-3.5' />
            </button>
          </div>
        </div>

        {isAdmin && !fpsOverlayAdminButtonLayout && (
          <div className='flex items-center h-[46px] pointer-events-auto'>
            <Button
              variant='ghost'
              size='sm'
              className='h-8 w-8 p-0 text-slate-600 transition-all duration-200 border rounded-full bg-white/80 border-slate-300 hover:bg-slate-100 hover:text-slate-700'
              onClick={() => navigate("/admin")}
              title='Admin panel'
              aria-label='Open Admin panel'
            >
              <Activity className='w-3.5 h-3.5' />
            </Button>
          </div>
        )}
        {isAdmin && fpsOverlayAdminButtonLayout && (
          <div
            className='pointer-events-auto'
            style={{
              position: "fixed",
              top: fpsOverlayAdminButtonLayout.top,
              left: fpsOverlayAdminButtonLayout.left,
              zIndex: 1001,
            }}
          >
            <Button
              variant='ghost'
              size='sm'
              className='p-0 text-slate-600 transition-all duration-200 border rounded-full bg-white/80 border-slate-300 hover:bg-slate-100 hover:text-slate-700'
              style={{
                width: fpsOverlayAdminButtonLayout.size,
                height: fpsOverlayAdminButtonLayout.size,
              }}
              onClick={() => navigate("/admin")}
              title='Admin panel'
              aria-label='Open Admin panel'
            >
              <Activity className='w-3.5 h-3.5' />
            </Button>
          </div>
        )}

        {/* 缂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾闁诡垰鏈幏鍛寲閺囩喓鈧椽姊洪幐搴ｇ畵闁瑰啿顦靛绋款吋閸ャ劌鏋戦梺鍝勫暙閻楀繐鐣垫笟鈧悡顐﹀炊閵婏妇鍙嗙紓浣稿閸嬫盯鈥︾捄銊﹀磯闁绘碍娼欐导鎰攽?*/}
        <div className='flex-1' />

        {/* 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐蹭画闂侀潧顦弲娑㈠磼閵娾晜鐓涚€广儱楠搁獮鏍煟閵堝鐣洪柡灞剧洴椤㈡洟鏁愰崱娆樻К闂備礁鎲￠崝蹇涘磻閹剧粯鈷掑┑鐘查娴滄粍绻涚仦鍌氱伈鐎规洘娲栭悾鐑藉炊閳哄啫绠垫繝寰锋澘鈧洟骞婅箛娑欏亗闁哄洢鍨洪悡娑㈡煕閹扳晛濡奸柍褜鍓氶幃鍌氼嚕缁嬪簱鏋庨柟鎯ь嚟閸橀亶妫呴銏″婵☆偅鍨块幊鎾诲箰鎼搭喗顔旈梺缁樺姈濞兼瑦鎱ㄩ崼鈶╁亾閸偅绶查悗姘嵆閻涱噣宕堕澶嬫櫍闂佺粯鍔曞鍫曞极?*/}
        <div className='pointer-events-auto'>
          <div className='tanva-header-card tanva-header-card-right flex items-center gap-1.5 md:gap-2 px-4 md:px-6 py-2 h-[46px] rounded-2xl bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass transition-all duration-300'>
            {/* 缂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊閵娧屾锤濡炪倖甯婇悞锕傚矗韫囨稒鈷掗柛顐ゅ枍缁堕亶鏌ｉ幒鏇炐撳ǎ鍥э躬婵″爼宕熼鐐差瀴闂備胶顭堝ù鐑藉窗閺嶎厼钃熼柣鏂垮悑閸婇攱銇勯幒宥堝厡缂佸娲鐑樺濞嗘垹鏆犲銈庡幘閸忔ê顕?*/}
            {showLibraryButton && (
              <Button
                onClick={toggleLibraryPanel}
                variant='ghost'
                size='sm'
                className={cn(
                  "h-7 text-xs flex items-center rounded-full transition-all duration-200",
                  "bg-liquid-glass-light backdrop-blur-minimal border border-liquid-glass-light text-gray-600",
                  "hover:bg-gray-900 hover:text-white hover:border-gray-900",
                  showLibraryPanel ? "text-gray-900" : "",
                  "w-8 sm:w-auto px-0 sm:px-3 gap-0 sm:gap-1"
                )}
                title={
                  showLibraryButton
                    ? t("workspace.header.closeLibrary")
                    : t("workspace.header.openLibrary")
                }
              >
                <Library className='w-3 h-3' />
                <span className='hidden sm:inline'>{t("workspace.header.library")}</span>
              </Button>
            )}

            <Button
              variant='ghost'
              size='sm'
              className='h-7 px-2.5 text-xs rounded-full border border-liquid-glass-light bg-liquid-glass-light backdrop-blur-minimal text-gray-700 hover:bg-liquid-glass-hover transition-all duration-200 flex items-center gap-1.5'
              title={t("workspace.header.myCredits")}
              onClick={openMembershipHub}
            >
              <span className='relative flex items-center justify-center w-4 h-4 rounded-full bg-gradient-to-br from-amber-300 via-amber-400 to-orange-500 shadow-[0_1px_4px_rgba(245,158,11,0.5)]'>
                <span className='absolute inset-[1px] rounded-full bg-gradient-to-br from-amber-200/85 to-amber-500/80' />
                <Star className='relative w-2.5 h-2.5 text-amber-50 fill-amber-100/90' />
              </span>
              <span className='tabular-nums font-medium'>{topCreditsText}</span>
            </Button>

            <WorkflowHistoryButton projectId={currentProject?.id ?? null} />

            <Button
              variant='ghost'
              size='sm'
              className='p-0 text-gray-600 transition-all duration-200 border rounded-full h-7 w-7 bg-liquid-glass-light backdrop-blur-minimal border-liquid-glass-light hover:bg-liquid-glass-hover'
              title={themeToggleLabel}
              aria-label={themeToggleLabel}
              onClick={() =>
                setChatTheme(chatTheme === "black" ? "white" : "black")
              }
            >
              {chatTheme === "black" ? (
                <Moon className='w-3.5 h-3.5' />
              ) : (
                <Sun className='w-3.5 h-3.5' />
              )}
            </Button>

            {/* 闂傚倸鍊烽悞锕傛儑瑜版帒鏄ラ柛鏇ㄥ灠閸ㄥ倸鈹戦崒婊庣劸缂佹劖顨婇弻鈥愁吋閸愩劌顬夐梺鍛婄懃缁绘垿濡甸崟顔剧杸闁规崘娉涢。铏圭磽娴ｅ搫校婵犮垺锕㈤垾锕傚锤濡や礁娈濋梻鍌氱墛缁嬫垿锝炲澶嬬厽?*/}
            <div
              className='relative'
              onMouseEnter={() => setIsHelpMenuOpen(true)}
              onMouseLeave={() => setIsHelpMenuOpen(false)}
            >
              {isHelpMenuOpen && (
                <div className='absolute top-full left-1/2 -translate-x-1/2 pt-2 z-[100] animate-in fade-in slide-in-from-top-2 duration-200'>
                  <div className='tanva-help-dropdown w-[156px] p-1.5 rounded-2xl bg-white/95 backdrop-blur-md border border-slate-200 shadow-[0_12px_28px_rgba(15,23,42,0.12)] flex flex-col gap-0.5'>
                    <button
                      type='button'
                      className='tanva-help-dropdown-item w-full h-9 px-3 rounded-xl text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300'
                      onClick={() => {
                        window.open(USER_MANUAL_URL, "_blank", "noopener,noreferrer");
                        setIsHelpMenuOpen(false);
                      }}
                    >
                      {t("workspace.header.userManual")}
                    </button>
                    <button
                      type='button'
                      className='tanva-help-dropdown-item w-full h-9 px-3 rounded-xl text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300'
                      onClick={() => {
                        setIsPricingCatalogOpen(true);
                        setIsHelpMenuOpen(false);
                      }}
                    >
                      {t("workspace.header.pricingCatalog")}
                    </button>
                    <button
                      type='button'
                      className='tanva-help-dropdown-item w-full h-9 px-3 rounded-xl text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300'
                      onClick={() => {
                        window.open(CHANGELOG_URL, "_blank", "noopener,noreferrer");
                        setIsHelpMenuOpen(false);
                      }}
                    >
                      {t("workspace.header.changelog")}
                    </button>
                  </div>
                </div>
              )}

              <Button
                variant='ghost'
                size='sm'
                className='p-0 text-gray-600 transition-all duration-200 border rounded-full h-7 w-7 bg-liquid-glass-light backdrop-blur-minimal border-liquid-glass-light hover:bg-liquid-glass-hover'
                title={t("workspace.header.help")}
                onClick={() => setIsHelpMenuOpen((prev) => !prev)}
              >
                <HelpCircle className='w-4 h-4' />
              </Button>
            </div>

            <div
              className='relative'
              onMouseEnter={() => setIsWechatQrOpen(true)}
              onMouseLeave={() => setIsWechatQrOpen(false)}
            >
              {isWechatQrOpen && (
                <div className='absolute top-full right-0 mt-2 p-4 rounded-2xl bg-black/80 backdrop-blur-md border border-white/10 shadow-2xl z-[100] animate-in fade-in slide-in-from-top-2 duration-200'>
                  <div className='flex gap-4'>
                    <div className='flex flex-col items-center'>
                      <div className='w-28 h-28 bg-white rounded-lg p-2 mb-2'>
                        <img
                          src={wechatQrCodes.officialAccount}
                          alt={t("home.wechat.followOfficial")}
                          className='w-full h-full object-contain'
                          onError={(event) => {
                            (event.target as HTMLImageElement).src = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23f0f0f0" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23999" font-size="12">${encodeURIComponent(t("home.wechat.noImage"))}</text></svg>`;
                          }}
                        />
                      </div>
                      <span className='text-xs text-white/80 whitespace-nowrap'>
                        {t("home.wechat.followOfficial")}
                      </span>
                    </div>
                    <div className='flex flex-col items-center'>
                      <div className='w-28 h-28 bg-white rounded-lg p-2 mb-2'>
                        <img
                          src={wechatQrCodes.wechatGroup}
                          alt={t("home.wechat.joinGroup")}
                          className='w-full h-full object-contain'
                          onError={(event) => {
                            (event.target as HTMLImageElement).src = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23f0f0f0" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23999" font-size="12">${encodeURIComponent(t("home.wechat.noImage"))}</text></svg>`;
                          }}
                        />
                      </div>
                      <span className='text-xs text-white/80 whitespace-nowrap'>
                        {t("home.wechat.joinGroup")}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <Button
                variant='ghost'
                size='sm'
                className='p-0 text-gray-600 transition-all duration-200 border rounded-full h-7 w-7 bg-liquid-glass-light backdrop-blur-minimal border-liquid-glass-light hover:bg-liquid-glass-hover'
                title='WeChat'
              >
                <MessageCircle className='w-4 h-4' />
              </Button>
            </div>

            {/* 闂傚倸鍊峰ù鍥х暦閸偅鍙忕€规洖娲ㄩ惌鍡椕归敐鍫綈婵炲懐濮撮湁闁绘ê妯婇崕鎰版煕鐎ｅ吀閭柡灞剧洴閸╁嫰宕橀浣诡潔缂傚倷鑳舵慨闈涱熆濮椻偓閳ワ箓宕稿Δ浣告疂闂傚倸鐗婄粙鎴︼綖瀹ュ鐓?*/}
            <Button
              variant='ghost'
              size='sm'
              className='p-0 text-gray-600 transition-all duration-200 border rounded-full h-7 w-7 bg-liquid-glass-light backdrop-blur-minimal border-liquid-glass-light hover:bg-liquid-glass-hover'
              title={t("workspace.header.settings")}
              onClick={() => {
                setActiveSettingsSection("workspace");
                setIsSettingsOpen(true);
              }}
            >
              <Menu className='w-4 h-4' />
            </Button>
          </div>
        </div>

        {isSettingsOpen &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              className='tanva-settings-overlay fixed inset-0 z-[1000] flex items-center justify-center bg-transparent px-4'
              onClick={() => setIsSettingsOpen(false)}
            >
              <div
                className='tanva-settings-modal relative flex h-[90vh] max-h-[700px] w-full max-w-[1000px] flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white/95 shadow-[0_32px_80px_rgba(15,23,42,0.18)] backdrop-blur-xl'
                onClick={(event) => event.stopPropagation()}
              >
                <div className='tanva-settings-layout flex flex-1 h-full pt-4 overflow-hidden sm:pt-0'>
                  <aside className='tanva-settings-sidebar hidden w-[230px] h-full py-5 border-r shrink-0 border-slate-100 bg-white sm:flex sm:flex-col'>
                    {/* 婵犵數濮烽。顔炬閺囥垹纾婚柟杈剧畱绾惧綊鏌￠崶銉ョ仾闁稿顦埞鎴﹀磼濠婂海鍔哥紒鐐劤濞硷繝寮婚悢铏圭＜闁靛繒濮甸悘鍫ユ⒑閸涘﹤濮€闁稿鎹囧缁樻媴鐟欏嫬浠╅梺绋垮濡炶棄鐣峰鍫熸櫇闁稿本纰嶆潏?*/}
                    <div className='flex items-center gap-2 px-6 mb-6 my-1'>
                      <svg
                        className='w-4 h-4 text-slate-400'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        strokeWidth='2'
                      >
                        <circle cx='12' cy='12' r='3' />
                        <path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z' />
                      </svg>
                      <span className='text-sm text-slate-500'>
                        {t("workspace.settings.title")}
                      </span>
                    </div>

                    {/* 闂傚倸鍊峰ù鍥敋瑜忛懞閬嶆嚃閳轰胶绛忕紓鍌欑劍椤洭鎮甸崼鏇熺厱妞ゆ劗濮撮崝姘舵煛閸曗晛鍔﹂柡灞剧☉閳藉螣閸忓吋鍠栭梻浣规偠閸婃牕煤濡吋宕叉繝闈涙川缁♀偓闂佺鏈喊宥呪枔椤撶姷纾藉ù锝嗗絻娴?*/}
                    <div className='flex-1 px-4 space-y-2'>
                      {SETTINGS_SECTIONS.map((section) => {
                        const Icon = section.icon;
                        const isActive = activeSettingsSection === section.id;
                        const hasNotification =
                          section.id === "referral" && showReferralNotification;
                        return (
                          <button
                            key={section.id}
                            type='button'
                            onClick={() => setActiveSettingsSection(section.id)}
                            className={cn(
                              "tanva-settings-nav-item w-full flex items-center gap-3 rounded-3xl px-4 py-3 text-sm transition-colors",
                              isActive
                                ? "tanva-settings-nav-item-active"
                                : ""
                            )}
                          >
                            <Icon className='w-4 h-4' />
                            <span>{t(section.labelKey)}</span>
                            {hasNotification && (
                              <span className='w-2 h-2 bg-red-500 rounded-full ml-auto' />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* 闂傚倸鍊风粈浣革耿闁秴鍌ㄧ憸鏃堝箖濞差亜惟闁靛鍟浠嬪箖閵忋倖鍋傞幖杈剧秶缁辩敻姊绘担鍛婅础闁惧繐閰ｅ畷鏉课旈崨顓狅紱闂侀潧艌閺呮粓鎮¤箛鎾斀闁绘灏欑粻鎶芥煟閿濆鎲鹃柡宀嬬秮楠炴鈧稒顭囬ˇ銉╂煠閹稿骸濮嶉柡灞剧洴婵＄兘顢涘鍐ㄧ厒濠电姭鎷冮崟顐ょシ闂?*/}
                    <div className='px-6 pt-4 mt-auto'>
                      <div className='flex items-center gap-2'>
                        <div className='w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-medium text-white'>
                          {displayName.charAt(0).toUpperCase()}
                        </div>
                        <span className='text-sm text-slate-600'>
                          {displayName}
                        </span>
                      </div>
                    </div>
                  </aside>
                  <div
                    ref={settingsContentScrollRef}
                    className='tanva-settings-content flex-1 px-4 py-6 overflow-y-auto sm:px-6'
                  >
                    <div className='flex flex-wrap gap-2 mb-4 sm:hidden'>
                      {SETTINGS_SECTIONS.map((section) => {
                        const Icon = section.icon;
                        const isActive = activeSettingsSection === section.id;
                        return (
                          <button
                            key={section.id}
                            type='button'
                            onClick={() => setActiveSettingsSection(section.id)}
                            className={cn(
                              "flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition-colors",
                              isActive
                                ? "border-gray-800 bg-gray-800 text-white shadow-sm"
                                : "border-slate-200 bg-white/90 text-slate-600"
                            )}
                          >
                            <Icon className='w-3 h-3' />
                            <span>{t(section.labelKey)}</span>
                          </button>
                        );
                      })}
                    </div>
                    {renderSettingsContent()}
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )}

        {isMembershipOpen &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              className='fixed inset-0 z-[1300] flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur-[2px]'
              onClick={() => setIsMembershipOpen(false)}
            >
              <div
                className={cn(
                  "relative flex h-[min(300dvh,760px)] w-full max-w-[min(100%,1300px)] flex-col overflow-hidden rounded-[10px]",
                  chatTheme === "white"
                    ? "bg-white shadow-[0_32px_80px_rgba(15,23,42,0.18)]"
                    : "bg-[#0a0a0f] shadow-[0_32px_80px_rgba(0,0,0,0.5)]"
                )}
                onClick={(event) => event.stopPropagation()}
              >
                <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain px-0'>
                  <MembershipPanel
                    onBack={() => setIsMembershipOpen(false)}
                    onPaymentSuccess={() => {
                      setIsMembershipOpen(false);
                      window.dispatchEvent(new CustomEvent("refresh-credits"));
                    }}
                  />
                </div>
              </div>
            </div>,
            document.body
          )}

        {/* 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鑼槷闂佸搫娲㈤崹鍦不閻樿绠规繛锝庡墮婵′粙鏌涚€ｃ劌鈧繈寮婚弴鐔虹鐟滃秶鈧凹鍓熼、鏃堝煛閸涱喒鎷洪梺鍛婄☉閿曘倖鎱ㄩ敃鍌涚厱婵☆垵顕ч崝銈夊础闁秵鐓欓梻鍌氼嚟閸斿秹鏌嶉柨瀣诞闁哄本鐩、鏇㈡晲閸ワ絾顫嶉梻浣筋嚙濞存碍绂嶅┑鍫熷床?*/}
        <MemoryDebugPanel
          isVisible={showMemoryDebug}
          onClose={() => setShowMemoryDebug(false)}
        />

        {/* 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩铏珨濠电姷顣藉Σ鍛村磻閸涙番鈧啯寰勯幇顑╋箓鏌熼悧鍫熺凡缂佲偓閸緷褰掓晲閸ャ劌娈屽銈呭閻╊垰顫忓ú顏勪紶闁告洖鐏氭瓏婵犵數鍋涢ˇ鏉棵哄鍛灊闁哄啫鐗嗛柨銈嗕繆閵堝嫮顦﹀ù鐙€鍨堕弻锝嗘償椤栨粎校婵炲瓨绮嶇划鎾愁嚕閹惰棄顫呴柕鍫濇閸樹粙姊洪幐搴㈩梿妞ゆ泦鍥ㄥ€堕柨鏃€鍨濈换鍡樸亜閹扳晛鐏╅柡鍡到閳规垿顢欓悷棰佸闂傚倷鐒﹂弸濂稿疾濞戙垹鐤ù鍏兼綑缁€?*/}
        <HistoryDebugPanel
          isVisible={showHistoryDebug}
          onClose={() => setShowHistoryDebug(false)}
        />

        {/* 婵犵數濮烽。顔炬閺囥垹纾婚柟杈剧畱绾惧綊鏌￠崶鈺佸壋闁兼澘娼￠弻娑樜旈崘褏闂┑鐐叉▕娴滄粎绮婚妷锔轰簻闁哄倸鐏濈紞鏍磼濡も偓椤﹂潧顫忓ú顏勭閹艰揪绲哄Σ鍫ユ煟鎼淬垹鍤柛娆忓暙閻ｇ兘骞囬悧鍫濃偓鐑芥煟閹寸儐鐒介柛姗€浜跺娲箰鎼达絿鐣靛┑鐐差嚟閸忔ê鐣烽姀鐙€鐓ラ柛娑卞灣閿涙粓鏌℃径濠勫闁告柨閰ｉ獮濠囧炊閳规儳浜炬繛鍫濈仢濞呮﹢鏌涢幘璺烘瀻闁伙絿鍏樺畷濂稿即閻斿憡鐝曠紓鍌欑劍缁嬫垿顢栭崨顔绢浄婵炲樊浜濋埛鎺楁煕鐏炲墽鎳呴悹鎰嵆閺屾稓鈧綆浜滈顓㈡寠濠靛鐓欐繛鍫濈仢閺嬫捇鏌涚€ｎ偅灏い顐ｇ箞婵＄兘濡烽妷顔锯偓铏繆閻愵亜鈧牕煤閳哄啰绀婂ù锝呮憸閺嗭箓鏌ｉ幋鐘垫憘闁轰礁娲弻锝呂熼崹顔炬闂佺锕﹂崑銈咁潖?*/}
        <ProjectManagerModal />

        {/* 闂傚倸鍊搁崐鐑芥嚄閸洍鈧箓宕奸姀鈥冲簥闂佸壊鍋侀崕杈╃矆婢跺备鍋撻崗澶婁壕闂佸憡娲﹂崜娆撳礈閸愬樊娓婚柕鍫濇缁楁帡鎮楀鐓庡⒋闁诡喗鐟︾换婵嬪炊閵娧冨箞闂備礁婀遍崑鎾汇€冮崨鏉戠獥婵娉涘Ч鍙夈亜閹烘垵顏柍閿嬪灴閺屾稑鈽夊Ο宄邦潓濡炪倕绻愮€氣偓婵炴垶顭傞弮鍫濈闁宠　鍋撴慨瑙勵殜濮婃椽鎮℃惔銏″枑闂佺顑戠徊鍓х矉瀹ュ拋鐓ラ柛顐ゅ枔閸樹粙姊洪棃娑氱濠殿喚鏁诲畷顖炴倷缂堢姷绠?*/}
        <GlobalImageHistoryPage
          isOpen={isGlobalHistoryOpen}
          onClose={() => setIsGlobalHistoryOpen(false)}
        />

        <PricingCatalogModal
          isOpen={isPricingCatalogOpen}
          onClose={() => setIsPricingCatalogOpen(false)}
        />
      </div>
    </>
  );
};

export default FloatingHeader;

