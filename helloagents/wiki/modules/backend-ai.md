# 后端模块：AI（backend-ai�?

## 作用
- 提供图像生成/编辑/融合/分析、文本对话、背景移除�?D�?D、图片扩展、视频生成、Paper.js/向量化等能力�?

## 关键文件
- `backend/src/ai/ai.controller.ts`：`/ai/*` 路由集合（主要入口）
- `backend/src/ai/ai.service.ts`：AI 业务逻辑（Gemini 等）
- `backend/src/ai/tool-selection-json.util.ts`：工具选择响应提取/解析（支持前后缀文本/markdown code fence/非严�?JSON/从文本提取工具名�?
- `backend/src/ai/services/*`：不同能�?供应商的服务拆分
- `backend/src/ai/providers/*`：供应商适配（以实现为准�?
- `backend/src/ai/dto/*`：请�?响应 DTO

## API（前缀 `/api/ai`，节选）
- `POST tool-selection`
- `POST generate-image`：返�?`imageUrl`（后端上�?OSS 后给前端），不再返回 base64 `imageData`
- `POST edit-image` / `blend-images`
- `POST analyze-image` / `text-chat`
- `POST remove-background`（含 public 变体�? `GET background-removal-info`
- `POST convert-2d-to-3d` / `GET convert-2d-to-3d/task/:taskId` / `expand-image`
- `POST generate-video` / `generate-video-provider` / `GET video-task/:provider/:taskId`
- `POST video-task-success` / `POST video-task-refund`（异步视频任务前端轮询后的成�?失败回写�?
- `POST generate-paperjs` / `img2vector`
- `GET veo/models` / `POST veo/generate`
- `POST dashscope/generate-wan2-6-*`
- `POST analyze-video`
- `POST minimax-speech` / `POST minimax-music`

## 注意事项
- OSS/TOS direct image uploads verify readability through `/api/assets/proxy` with credential-less Range requests and short retries; `206 Partial Content` is expected and treated as readable.
- Volc review group reuse normally persists to `volcReviewGroup`, and bio-auth history reuse normally persists to `bioAuthGroup`; if those Prisma tables/columns are missing, both services now fall back to process-local memory and log one warning.
- Volc API proxy calls used by asset review and bio-auth have explicit timeouts; frontend requests fail after 30s and backend upstream calls fail after 25s so node state can recover from invalid/inaccessible image URLs.
- Volc asset review lives under `/api/volc-asset/*`; bio-auth lives under `/api/bio-auth/*`. Bio-auth callback accepts both GET and POST plus common `BytedToken` / `ResultCode` casing variants before updating the in-memory task and polling asset status.
- `generate-image` 在上游仅返回外链 `imageUrl`（如 Seedream/Nano2）时，会统一下载并转�?OSS 后返回稳�?URL；管理员/白名单只跳过水印，不再直返第三方临时链接�?
- 图像同步接口（`generate-image` / `edit-image` / `blend-images`）现要求“成功响应必须包含可用图像载荷（`imageData` �?`imageUrl`）”；若上游出�?`HTTP 200` 但空图返回，接口会按失败处理并进入积分失�?退款路径，避免假成功扣分�?
- Seedream5 supports system setting key seedream5_provider (doubao / watcha), defaulting to doubao when missing.
- Watcha Seedream channel env vars: WATCHA_SEEDREAM_API_KEY, optional WATCHA_SEEDREAM_ENDPOINT, optional WATCHA_SEEDREAM_MODEL.
- Tencent route for `kling-2.6` uses official start-end mapping: first frame goes to `FileInfos` (`Usage=FirstFrame`) and tail frame goes to `LastFrameUrl`; non-start-end reference images use `Usage=Reference`.
- Tencent `kling-2.6` output constraints are normalized server-side: duration `5/10`, resolution `720P/1080P`, and start-end mode always sends `OutputConfig.AudioGeneration=Disabled`.
- `generateVideo` now prioritizes `klingModel=kling-v3-0` as managed `kling-3.0` routing, even if payload provider is `kling-o3`, to avoid accidentally entering `kling-3.0-omni` execution path.
- `queryTask` now detects managed Tencent task prefixes before provider-branch routing, ensuring `kling-v3-0` polling remains correct even when request provider is `kling-o3`.
- Seedance（doubao）视频任务成功后，后端会将上游视频拉取并上传�?OSS，仅返回自有 OSS 公网链接给前端�?
- Seedance 2.0 现在统一�?`seedance-2.0` 模型管理键，但运行时可按请求里的 `seedanceModel` �?`doubao-seedance-2-0-260128` �?`doubao-seedance-2-0-fast-260128` 间切换；`ai.controller` �?Seedance 2 权益校验也会同时识别 `2.0` �?`2.0-fast`�?
- `generate-video-provider` 在解析到模型管理线路后，会把该线路 `pricing.displayConfig.defaultSelections` 补进缺失的计费参数（如 Seedance 2.0 默认 `resolution=720P`、`duration=5`），确保对话框等非画布入口也能命中规格定价。
- 快乐马 `POST /api/ai/dashscope/generate-happyhorse-video` 默认仅允许已登录付费用户调用：成功支付过任意订单（充值或会员）可用；未支付过的会员用户需当前有效套餐 metadata 显式配置 `happyhorseAccess: "enabled"`；免费档默认不支持。该接口创建 DashScope 任务后立即返回 `taskId/apiUsageId`，前端通过 `/api/ai/dashscope/task/:taskId` 轮询并在成功/失败时回写积分状态。
- Seedance 2.0 直连方舟链路已支持媒体优先请求：�?prompt 但有图片/视频/音频参考时不再错误拼接 `undefined` 文本；并同步放宽到官�?`4-15s`、`480P/720P`�? 种宽高比以及多模态参考组合�?
- Seedance 2.0 模式选择会通过 `video_mode` 下发到方舟请求体，确�?`Seedance 2.0` 节点的模式化输入在上游生效�?
- 异步视频计费为“先扣费 + 后确认”：创建任务后记录保�?`pending`，前端轮询成功调�?`video-task-success` 标记 `success`，失败调�?`video-task-refund` 标记失败并退款�?
- `convert-2d-to-3d` 已改为异步任务模式：创建接口立即返回 `taskId`，控制器在后台继续执行混元 3D `submit/query` 轮询与 OSS 持久化，前端通过 `/api/ai/convert-2d-to-3d/task/:taskId` 查询状态，避免线上代理在长轮询时返回 `504`。
- `edit-image` / `blend-images` 支持 `sourceImageUrl(s)`，后端会�?OSS 白名单拉取并转换�?dataURL�?
- Banana 文本链路（`text-chat` / `tool-selection`）支持独立于图像链路的供应商配置�?`banana_text_provider`：`auto`（Apimart�?47）、`legacy_auto`�?47→Apimart）、`apimart`、`legacy`�?
- Banana 文本�?Apimart 时使�?`https://api.apimart.ai/v1/chat/completions`（OpenAI Chat Completions 兼容格式），鉴权复用 `NANO2_API_KEY`�?
- Banana 文本链路按档位映射：`Fast (banana-2.5) -> gemini-2.5-flash`、`Pro (banana) -> gemini-3-pro-preview`、`Ultra (banana-3.1/nano2) -> gemini-3.1-pro-preview`；其�?Ultra �?147 �?Apimart 通道均统一使用 `gemini-3.1-pro-preview`�?
- `POST /api/ai/analyze-image` 默认优先使用 `gemini-3.1-pro`（语言模型）做多模态分析；`banana-2.5` 仍保�?`gemini-2.5-flash-image-preview`�?
- 图像分析链路遇到上游配额/限流�?29 / quota / resource exhausted）时，后端会在退款后透传 HTTP `429`，不再统一返回 `500`�?
- `minimax-music` 默认强制 `output_format=url`、`stream=false`，并在上游返�?`status=1`（合成中）或请求超时时返回友好错误提示�?

## 配置项（以代码与环境为准�?
- Gemini/第三方：`GOOGLE_GEMINI_API_KEY`、`RUNNINGHUB_API_KEY` �?
- 视频/供应商：`DASHSCOPE_API_KEY`、`SORA2_API_ENDPOINT`、`BANANA_API_KEY` �?
- Banana/Apimart 文本与图像：`BANANA_API_KEY`�?47）、`NANO2_API_KEY`（Apimart�?

## 2026-04-24 Update
- Nano2/GPT-Image-2 request passthrough supports `official_fallback` boolean; backend default fallback for `gpt-image-2` is now `false` when frontend does not specify it.
- Backend node default metadata for `gptImage2` now exposes `resolutions: [1K,2K,4K]` and enables `showResolutionSelector`.
