# API 手册（概览）

## 基本信息
- Base URL：`/api`
- Swagger：`/api/docs`

## 路由前缀（按 Controller）
以下为后端 Controller 路由前缀（不含全局 `/api`）：
- `auth`：认证
- `users`：用户
- `projects`：项目
- `assets`：素材资源
- `uploads`：上传
- `video-frames`：视频帧相关
- `video-gif`：视频转 GIF
- `ai`：AI 能力
- `public/ai`：公开 AI API
- `credits`：积分/计费
- `payment`：充值支付
- `admin`：管理后台
- `invites`：邀请码
- `personal-library`：个人素材库
- `global-image-history`：全局图片历史
- `templates`：公共模板
- `health`：健康检查
- `telemetry`：前端错误上报与观测埋点

> 具体请求/响应以 Swagger 与 Controller 实现为准。

## Telemetry
- `POST /api/telemetry/frontend-error`
  - 用途：前端运行时错误上报，后端会转发到 OpenObserve `frontend_errors` stream。
  - 鉴权：无需登录，可匿名调用。
  - 建议请求头：`Content-Type: application/json`，并尽量带 `x-trace-id` / `traceparent`。
  - 请求体字段：`kind`、`message`、`stack`、`source`、`appVersion`、`buildTime`、`href`、`userAgent`、`timestamp`、`traceId`
  - 响应：`204 No Content`

## 近期接口变更（摘要）
- `POST /api/ai/convert-2d-to-3d`：
  - 由同步返回 `modelUrl` 改为异步创建任务，立即返回 `taskId/status/message`。
  - 新增 `GET /api/ai/convert-2d-to-3d/task/:taskId`，前端轮询直到拿到 `modelUrl` 或失败状态。
- `POST /api/ai/analyze-image`：
  - 新增可选 `sourceImages: string[]`，支持多图分析。
  - 兼容原有 `sourceImage: string` 单图请求。
  - `sourceImage/sourceImages` 同时支持图片与 PDF 的 `data:` URL 或纯 base64；后端会按 MIME 统一转为模型可消费的 inline file parts。
  - 两者同时传入时会合并去重后统一参与分析。
