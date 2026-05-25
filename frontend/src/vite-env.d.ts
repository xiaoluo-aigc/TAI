/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_APP_ENV?: string;
  readonly VITE_OPENOBSERVE_LOGS_URL_LOCAL?: string;
  readonly VITE_OPENOBSERVE_LOGS_URL_TEST?: string;
  readonly VITE_OPENOBSERVE_LOGS_URL_PROD?: string;
  readonly VITE_STORAGE_SCHEMA_VERSION?: string;
  readonly VITE_RUNTIME_ERROR_REPORTING?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;
declare const __STORAGE_SCHEMA_VERSION__: string;
