import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

type PackageJson = {
  version?: string;
};

const packageJsonPath = fileURLToPath(new URL('./package.json', import.meta.url));
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as PackageJson;
const packageVersion = packageJson.version || '0.0.0';
const buildTime = new Date().toISOString();
const commitSha =
  (process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA || '').trim().slice(0, 12) || null;
const appVersion =
  (process.env.VITE_APP_VERSION || process.env.APP_VERSION || `${packageVersion}-${buildTime}`)
    .trim();
const storageSchemaVersionRaw = (process.env.VITE_STORAGE_SCHEMA_VERSION || '1').trim();
const parsedStorageSchemaVersion = Number.parseInt(storageSchemaVersionRaw, 10);
const storageSchemaVersion = Number.isFinite(parsedStorageSchemaVersion)
  ? Math.max(1, parsedStorageSchemaVersion)
  : 1;

const versionManifest = {
  version: appVersion,
  buildTime,
  commitSha,
  storageSchemaVersion,
};

function emitVersionManifest(): PluginOption {
  return {
    name: 'tanva-version-manifest',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify(versionManifest, null, 2)}\n`,
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), emitVersionManifest()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_TIME__: JSON.stringify(buildTime),
    __STORAGE_SCHEMA_VERSION__: JSON.stringify(String(storageSchemaVersion)),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 在本地开发时监听所有网络接口 (0.0.0.0)
    // 这样其他PC可以通过 http://192.168.2.115:5173 访问
    host: '0.0.0.0',
    port: 5173,
    
    // 允许 Cloudflare Tunnel 和其他内网穿透工具的域名访问
    // 允许所有 trycloudflare.com 的子域名（用于 Cloudflare Tunnel）
    allowedHosts: [
      '.trycloudflare.com',  // 允许所有 trycloudflare.com 的子域名
      '.tanvas.cn',          // 允许所有 tanvas.cn 的子域名（Cloudflare Tunnel）
      'tgtai.com',           // 主域名
      'www.tgtai.com',       // www 子域名
      'rhyuvfgbjqxc.sealoshzh.site',
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
    ],

    proxy: {
      '/api': {
        // 后端服务器地址
        // 后端服务器地址
        // 本地开发时使用 localhost, 其他PC访问时自动转发到 0.0.0.0:4000
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
