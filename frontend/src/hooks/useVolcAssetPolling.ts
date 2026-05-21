import React from "react";
import { getVolcAssetStatus, type VolcAssetStatus } from "../services/volcAssetAPI";

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000;

export interface VolcAssetPollingOptions {
  assetId?: string;
  status?: VolcAssetStatus;
  onUpdate: (next: { status: VolcAssetStatus; errorMessage?: string }) => void;
}

/**
 * status === 'processing' 时自动轮询至 terminal；其他状态不工作。
 * 超时强制置 failed。
 */
export function useVolcAssetPolling({ assetId, status, onUpdate }: VolcAssetPollingOptions) {
  const onUpdateRef = React.useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  React.useEffect(() => {
    if (!assetId || status !== "processing") return;
    let cancelled = false;
    const startedAt = Date.now();
    const timeoutReached = () => Date.now() - startedAt > POLL_TIMEOUT_MS;

    const tick = async () => {
      if (cancelled) return;
      try {
        const result = await getVolcAssetStatus(assetId);
        if (cancelled) return;
        if (result.status === "processing") {
          if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
            onUpdateRef.current({ status: "failed", errorMessage: "审核超时，请重试" });
            return;
          }
          setTimeout(tick, POLL_INTERVAL_MS);
        } else {
          onUpdateRef.current({ status: result.status, errorMessage: result.errorMessage });
        }
      } catch (err: any) {
        if (cancelled) return;
        if (timeoutReached()) {
          onUpdateRef.current({ status: "failed", errorMessage: err?.message || "审核超时，请重试" });
          return;
        }
        // 轮询阶段遇到临时网络/502 错误时继续重试，避免偶发抖动立刻失败。
        setTimeout(tick, POLL_INTERVAL_MS);
      }
    };
    const t = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [assetId, status]);
}
