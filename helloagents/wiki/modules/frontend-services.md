# 前端模块：服务层（frontend-services）

## 作用
- 封装与后端交互的 HTTP 调用、AI 相关请求、上传/素材访问等逻辑，降低 UI 与 API 的耦合。

## 关键目录
- `frontend/src/services/`：API client、具体业务服务（以文件实现为准）

## 约定
- 后端 API 前缀 `/api`，开发环境下由 Vite proxy 转发到 `http://localhost:4000`（见 `frontend/vite.config.ts`）。
- 前端所有网络请求统一使用 `fetchWithAuth`（`frontend/src/services/authFetch.ts`），默认携带登录态并在 401/403 时触发退出；对第三方/公开资源可通过 `auth: "omit"` 与 `credentials: "omit"` 控制鉴权与凭据。
- 静态资源默认直连 OSS/CDN（`VITE_ASSET_PUBLIC_BASE_URL` 拼接 `projects/...` 等 key），仅在需要代理时显式开启 `VITE_PROXY_ASSETS=true`。
- 长耗时 AI 能力优先走“创建任务 + 轮询状态”模式；`convert2Dto3DService.ts` 现通过 `POST /api/ai/convert-2d-to-3d` 创建任务，再轮询 `GET /api/ai/convert-2d-to-3d/task/:taskId`，避免单次长请求在生产代理层超时。
