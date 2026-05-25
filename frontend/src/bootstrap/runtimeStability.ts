type RuntimeErrorKind = "error" | "unhandledrejection" | "resource-error";

type RuntimeErrorPayload = {
  kind: RuntimeErrorKind;
  message: string;
  stack: string | null;
  source: string | null;
  appVersion: string;
  buildTime: string;
  href: string;
  userAgent: string;
  timestamp: string;
  traceId: string;
};

const APP_VERSION = __APP_VERSION__;
const BUILD_TIME = __BUILD_TIME__;
const STORAGE_SCHEMA_VERSION = (() => {
  const parsed = Number.parseInt(__STORAGE_SCHEMA_VERSION__, 10);
  if (Number.isFinite(parsed)) return Math.max(1, parsed);
  return 1;
})();

const FRONTEND_ERROR_ENDPOINT_PATH = "/api/telemetry/frontend-error";
const STORAGE_SCHEMA_KEY = "tanva:storage-schema-version";
const VERSION_RELOAD_ATTEMPT_KEY = "tanva:version-reload-attempted";
const VERSION_MISMATCH_ACK_KEY = "tanva:version-mismatch-ack";
const MIGRATION_KEY_PREFIX = "tanva_idb_migrated_";
const VERSION_POLL_INTERVAL_MS = 5 * 60 * 1000;
const VERSION_FETCH_TIMEOUT_MS = 6000;
const MAX_ERROR_REPORTS_PER_PAGE = 20;
const TELEMETRY_REQUEST_TIMEOUT_MS = 2500;
const TELEMETRY_CIRCUIT_BREAK_MS = 5 * 60 * 1000;
const TRACE_HEADER = "x-trace-id";
const TRACE_PARENT_HEADER = "traceparent";

const LOCAL_STORAGE_KEYS_TO_CLEAR = [
  "canvas-settings",
  "flow-settings",
  "tool-settings",
  "ui-preferences",
  "sandbox-preferences",
  "ai-chat-preferences",
  "tanva_aiChat_sessions",
  "tanva_aiChat_activeSessionId",
  "image-history",
  "personal-library",
];

const INDEXEDDB_NAMES_TO_CLEAR = [
  "tanva_project_cache",
  "tanva_unified_storage",
];

const shouldReportRuntimeErrors = (() => {
  const raw = String(import.meta.env.VITE_RUNTIME_ERROR_REPORTING ?? "true").toLowerCase();
  return !["0", "false", "off", "no"].includes(raw);
})();
const shouldEnableTelemetry = (() => {
  const fallback = "true";
  const raw = String(import.meta.env.VITE_ENABLE_TELEMETRY ?? fallback).toLowerCase();
  return ["1", "true", "on", "yes"].includes(raw);
})();

const randomHex = (size: number): string => {
  const chars = "0123456789abcdef";
  let output = "";
  for (let i = 0; i < size; i += 1) {
    output += chars[Math.floor(Math.random() * chars.length)];
  }
  return output;
};

const createTraceId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now().toString(16)}${randomHex(32)}`.slice(0, 32);
};

const createTraceParent = (traceId: string, spanId = randomHex(16)): string =>
  `00-${traceId}-${spanId}-01`;

const seenErrorSignatures = new Set<string>();
let reportedErrorCount = 0;
let versionCheckInFlight = false;
let telemetryDisabledUntil = 0;

const isTelemetryTemporarilyDisabled = (): boolean =>
  telemetryDisabledUntil > Date.now();

const tripTelemetryCircuitBreaker = (): void => {
  telemetryDisabledUntil = Date.now() + TELEMETRY_CIRCUIT_BREAK_MS;
};

const getLocalStorage = (): Storage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

const getSessionStorage = (): Storage | undefined => {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
};

const safeStorageGet = (storage: Storage | undefined, key: string): string | null => {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

const safeStorageSet = (storage: Storage | undefined, key: string, value: string): void => {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // noop
  }
};

const safeStorageRemove = (storage: Storage | undefined, key: string): void => {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // noop
  }
};

const getApiBase = (): string => {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "";
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toErrorInfo = (reason: unknown): { message: string; stack: string | null } => {
  if (reason instanceof Error) {
    return {
      message: reason.message || "Unknown error",
      stack: reason.stack || null,
    };
  }
  if (typeof reason === "string") {
    return {
      message: reason,
      stack: null,
    };
  }
  if (isObject(reason)) {
    const message =
      typeof reason.message === "string"
        ? reason.message
        : typeof reason.error === "string"
          ? reason.error
          : JSON.stringify(reason);
    const stack = typeof reason.stack === "string" ? reason.stack : null;
    return {
      message: message || "Unknown error object",
      stack,
    };
  }
  return {
    message: String(reason),
    stack: null,
  };
};

const reportRuntimeError = (
  kind: RuntimeErrorKind,
  message: string,
  stack: string | null,
  source: string | null
): void => {
  if (!shouldReportRuntimeErrors) return;
  if (!shouldEnableTelemetry) return;
  if (isTelemetryTemporarilyDisabled()) return;
  if (reportedErrorCount >= MAX_ERROR_REPORTS_PER_PAGE) return;

  const signature = `${kind}|${message}|${source ?? ""}`;
  if (seenErrorSignatures.has(signature)) return;
  seenErrorSignatures.add(signature);
  reportedErrorCount += 1;

  const payload: RuntimeErrorPayload = {
    kind,
    message: message.slice(0, 2000),
    stack: stack ? stack.slice(0, 8000) : null,
    source,
    appVersion: APP_VERSION,
    buildTime: BUILD_TIME,
    href: typeof window !== "undefined" ? window.location.href : "unknown",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
    timestamp: new Date().toISOString(),
    traceId: createTraceId(),
  };

  const body = JSON.stringify(payload);
  const endpoint = `${getApiBase()}${FRONTEND_ERROR_ENDPOINT_PATH}`;
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.set(TRACE_HEADER, payload.traceId);
  headers.set(TRACE_PARENT_HEADER, createTraceParent(payload.traceId));

  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      const sent = navigator.sendBeacon(endpoint, blob);
      if (sent) return;
    }
  } catch {
    // noop
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), TELEMETRY_REQUEST_TIMEOUT_MS);

  fetch(endpoint, {
    method: "POST",
    headers,
    body,
    credentials: "omit",
    keepalive: true,
    signal: controller.signal,
  })
    .then((response) => {
      if (!response.ok) {
        tripTelemetryCircuitBreaker();
      }
    })
    .catch(() => {
      tripTelemetryCircuitBreaker();
    })
    .finally(() => {
      window.clearTimeout(timeout);
    });
};

const installGlobalErrorHandlers = (): void => {
  window.addEventListener(
    "error",
    (event: Event | ErrorEvent) => {
      if (event instanceof ErrorEvent) {
        reportRuntimeError(
          "error",
          event.message || "Uncaught runtime error",
          event.error instanceof Error ? event.error.stack || null : null,
          event.filename || null
        );
        return;
      }

      const target = (event as Event).target;
      if (!(target instanceof HTMLElement)) return;

      const source =
        target instanceof HTMLScriptElement ||
        target instanceof HTMLLinkElement ||
        target instanceof HTMLImageElement
          ? target.getAttribute("src") || target.getAttribute("href")
          : null;

      reportRuntimeError(
        "resource-error",
        `Failed to load resource: ${source || "unknown"}`,
        null,
        source
      );
    },
    true
  );

  window.addEventListener("unhandledrejection", (event) => {
    const info = toErrorInfo(event.reason);
    reportRuntimeError(
      "unhandledrejection",
      info.message || "Unhandled promise rejection",
      info.stack,
      null
    );
  });
};

const clearSchemaLocalStorage = (): void => {
  let storage: Storage | undefined;
  try {
    storage = window.localStorage;
  } catch {
    return;
  }

  for (const key of LOCAL_STORAGE_KEYS_TO_CLEAR) {
    safeStorageRemove(storage, key);
  }

  const dynamicKeys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(MIGRATION_KEY_PREFIX)) {
        dynamicKeys.push(key);
      }
    }
  } catch {
    return;
  }

  for (const key of dynamicKeys) {
    safeStorageRemove(storage, key);
  }
};

const clearSchemaIndexedDb = (): void => {
  if (typeof indexedDB === "undefined") return;
  for (const dbName of INDEXEDDB_NAMES_TO_CLEAR) {
    try {
      indexedDB.deleteDatabase(dbName);
    } catch {
      // noop
    }
  }
};

const applyStorageSchemaGuard = (): void => {
  if (typeof window === "undefined") return;

  const localStorageRef = getLocalStorage();
  const sessionStorageRef = getSessionStorage();

  if (!localStorageRef) return;
  const nextSchema = String(STORAGE_SCHEMA_VERSION);
  const currentSchema = safeStorageGet(localStorageRef, STORAGE_SCHEMA_KEY);
  if (currentSchema === nextSchema) return;

  clearSchemaLocalStorage();
  clearSchemaIndexedDb();

  safeStorageSet(localStorageRef, STORAGE_SCHEMA_KEY, nextSchema);
  safeStorageRemove(sessionStorageRef, VERSION_RELOAD_ATTEMPT_KEY);
};

const readRemoteVersion = async (): Promise<string | null> => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), VERSION_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`/version.json?_t=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Cache-Control": "no-cache",
      },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as unknown;
    if (!isObject(data)) return null;
    const version = data.version;
    return typeof version === "string" && version.trim() ? version.trim() : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
};

const handleVersionMismatch = (remoteVersion: string): void => {
  if (!remoteVersion || remoteVersion === APP_VERSION) return;

  const localStorageRef = getLocalStorage();
  const sessionStorageRef = getSessionStorage();
  const mismatchKey = `${APP_VERSION}->${remoteVersion}`;
  const attemptedVersion = safeStorageGet(sessionStorageRef, VERSION_RELOAD_ATTEMPT_KEY);
  if (attemptedVersion !== remoteVersion) {
    safeStorageSet(sessionStorageRef, VERSION_RELOAD_ATTEMPT_KEY, remoteVersion);
    window.location.reload();
    return;
  }

  const acknowledged = safeStorageGet(localStorageRef, VERSION_MISMATCH_ACK_KEY);
  if (acknowledged === mismatchKey) return;

  const shouldReload = window.confirm(
    "A new version is available. Reload now to update?"
  );
  if (shouldReload) {
    window.location.reload();
    return;
  }

  safeStorageSet(localStorageRef, VERSION_MISMATCH_ACK_KEY, mismatchKey);
};

const checkVersionNow = async (): Promise<void> => {
  if (versionCheckInFlight) return;
  versionCheckInFlight = true;
  try {
    const remoteVersion = await readRemoteVersion();
    if (!remoteVersion) return;
    handleVersionMismatch(remoteVersion);
  } finally {
    versionCheckInFlight = false;
  }
};

const installVersionGuard = (): void => {
  if (!import.meta.env.PROD) return;

  void checkVersionNow();
  window.setInterval(() => {
    void checkVersionNow();
  }, VERSION_POLL_INTERVAL_MS);

  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void checkVersionNow();
    }
  });

  window.addEventListener("focus", () => {
    void checkVersionNow();
  });
};

export const initializeRuntimeStability = (): void => {
  if (typeof window === "undefined") return;
  const runtimeWindow = window as Window & {
    __tanva_runtime_stability_initialized__?: boolean;
  };
  if (runtimeWindow.__tanva_runtime_stability_initialized__) return;
  runtimeWindow.__tanva_runtime_stability_initialized__ = true;

  applyStorageSchemaGuard();
  installGlobalErrorHandlers();
  installVersionGuard();
};
