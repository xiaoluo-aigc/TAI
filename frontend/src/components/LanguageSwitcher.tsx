import { Globe } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

type LanguageSwitcherProps = {
  className?: string;
  tone?: "light" | "dark";
  compact?: boolean;
  showIcon?: boolean;
  style?: "pill" | "simple";
};

const normalizeLanguage = (lng: string): "zh-CN" | "en-US" => {
  const value = String(lng || "").toLowerCase();
  if (value.startsWith("en")) return "en-US";
  return "zh-CN";
};

export default function LanguageSwitcher({
  className,
  tone = "light",
  compact = false,
  showIcon = true,
  style = "pill",
}: LanguageSwitcherProps) {
  const { t, i18n } = useTranslation();
  const current = useMemo(() => normalizeLanguage(i18n.resolvedLanguage || i18n.language), [i18n.language, i18n.resolvedLanguage]);
  const languageTitle =
    t("common.language", { defaultValue: "Language" }) || "Language";

  const changeLanguage = (next: "zh-CN" | "en-US") => {
    if (current === next) return;
    void i18n.changeLanguage(next);
  };

  const isSimple = style === "simple";

  return (
    <div
      className={cn(
        "inline-flex items-center",
        isSimple
          ? "gap-1.5"
          : "rounded-full border px-1.5 py-1",
        !isSimple &&
          (tone === "dark"
            ? "border-white/25 bg-white/10 text-white"
            : "border-liquid-glass-light bg-liquid-glass-light text-gray-700"),
        compact ? "gap-1" : "gap-1.5",
        className
      )}
      role='group'
      aria-label={languageTitle}
      title={languageTitle}
    >
      {showIcon && <Globe className={cn("shrink-0", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />}
      <button
        type='button'
        onClick={() => changeLanguage("zh-CN")}
        className={cn(
          isSimple
            ? "px-1 py-0 text-xs font-semibold transition-colors"
            : "rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
          isSimple
            ? current === "zh-CN"
              ? tone === "dark"
                ? "text-white"
                : "text-slate-900"
              : tone === "dark"
                ? "text-white/65 hover:text-white/90"
                : "text-slate-500 hover:text-slate-700"
            : current === "zh-CN"
              ? tone === "dark"
                ? "bg-white text-black"
                : "bg-white text-slate-900"
              : tone === "dark"
                ? "text-white/80 hover:text-white"
                : "text-slate-500 hover:text-slate-700"
        )}
      >
        中
      </button>
      {isSimple && (
        <span className={cn("text-xs", tone === "dark" ? "text-white/45" : "text-slate-300")}>
          /
        </span>
      )}
      <button
        type='button'
        onClick={() => changeLanguage("en-US")}
        className={cn(
          isSimple
            ? "px-1 py-0 text-xs font-semibold transition-colors"
            : "rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
          isSimple
            ? current === "en-US"
              ? tone === "dark"
                ? "text-white"
                : "text-slate-900"
              : tone === "dark"
                ? "text-white/65 hover:text-white/90"
                : "text-slate-500 hover:text-slate-700"
            : current === "en-US"
              ? tone === "dark"
                ? "bg-white text-black"
                : "bg-white text-slate-900"
              : tone === "dark"
                ? "text-white/80 hover:text-white"
                : "text-slate-500 hover:text-slate-700"
        )}
      >
        EN
      </button>
    </div>
  );
}
