# Changelog

All notable changes to this knowledge base will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning (knowledge-base versioning).

## [Unreleased]
### Fixed
- Frontend OpenObserve production logs URL no longer carries a separate `www.tgtai.com` fallback: `frontend/.env` and `frontend/src/utils/openobserve.ts` now only use `VITE_OPENOBSERVE_LOGS_URL_PROD`, matching the current `www.tgtai.com -> tgtai.com` redirect setup.

### Fixed
- AI file analysis now uses a shared prompt builder for image/PDF inputs across the default Gemini service and `gemini-pro` fallback provider; `/api/ai/analyze-image` docs/types/messages were also aligned to treat `sourceImage/sourceImages` as generic file inputs instead of image-only payloads.

### Fixed
- Gemini backend key resolution now follows current Google naming for document/image analysis paths: server-side Gemini initialization and PDF/video analysis fallbacks accept `GEMINI_API_KEY` and `GOOGLE_API_KEY`, while keeping legacy `GOOGLE_GEMINI_API_KEY` / `VITE_GOOGLE_GEMINI_API_KEY` as backward-compatible fallbacks.

### Added
- Backend telemetry now standardizes OpenObserve integration through a dedicated NestJS telemetry module: global request logging, global exception capture, OTLP HTTP tracing, frontend runtime error forwarding, and shared upstream request sanitization all emit trace-correlated payloads to OpenObserve streams.
- Frontend admin API records now use a shared OpenObserve log-jump utility and button component, so failed business records can open environment-specific `/web/logs` URLs with prefilled stream/query filters instead of relying on a hardcoded test-only console URL.

### Fixed
- 2D转3D 改为异步任务流：`POST /api/ai/convert-2d-to-3d` 现在只负责创建任务并立即返回 `taskId`，后端在请求外继续执行混元 3D 提交/轮询/持久化，新增 `GET /api/ai/convert-2d-to-3d/task/:taskId` 供前端轮询，避免线上长请求在网关层触发 `504`。
- Windows background removal local fallback now runs in an isolated worker process instead of the Nest main process, so `@imgly/background-removal-node` native crashes no longer take down the backend or wipe frontend session state during “极速抠图”.

### Fixed
- Fast background removal now follows a single backend provider chain: frontend always posts current image base64 to `/api/public/ai/remove-background`, backend prefers `remove.bg` when `REMOVE_BG_API_KEY` is configured, and otherwise attempts local `@imgly/background-removal-node` even on Windows in best-effort mode instead of hard-disabling local fallback.

### Fixed
- Background removal diagnostics now align with the actual public API path: frontend availability/info checks use `/api/public/ai/background-removal-info`, and backend info responses include `platform` plus a concrete unavailable `reason` (notably the Windows + missing `REMOVE_BG_API_KEY` case), reducing false suspicion of missing dependencies during “极速抠图” failures.

### Fixed
- OSS image upload readability checks now call the public asset proxy without credentials and retry briefly after direct PUT upload, preventing `Access-Control-Allow-Origin=*` credential-mode failures from making readable thumbnails look broken.
- Volc review groups and bio-auth history groups now degrade to in-memory reuse when `volcReviewGroup` / `bioAuthGroup` persistence is unavailable, logging only one warning instead of breaking review/auth flows.
- Volc asset review and bio-auth API calls now have frontend and backend timeouts, so inaccessible image URLs or slow upstream Volc requests fail back to node state instead of leaving Image buttons spinning indefinitely.
- Flow/Image review and bio-auth buttons now resolve a public source URL from the current image node, crop base, or upstream image connection instead of only `data.imageUrl`, so connected/cropped image nodes can use the Volc asset review and face-auth flows.
- Bio-auth callback handling now accepts GET or POST callbacks and common `BytedToken` / `ResultCode` parameter casings, reducing stuck `processing` tasks when the upstream callback shape differs.
- Asset proxy read path now uses real async signed OSS URLs (`OssService.signUrl`) instead of pseudo-sync fallback behavior, improving private bucket compatibility and reducing false 404s on `/api/assets/proxy?key=...`.
- Project cloud-save now validates newly introduced managed asset keys before persistence; if OSS objects are missing, save is blocked with `400` to prevent persisting broken references.

### Integration
- GPT-Image-2 routing now follows global `normal/stable` route in `nano2`: `stable` uses official model/profile (`gpt-image-2-official` with official parameter set), while `normal` keeps existing GPT2 behavior.
- GPT-Image-2 official submission now includes clearer upstream error observability (`requestId` + raw body logging), transient 5xx submit retry, and a single automatic fallback from `4k` to `2k` for stable-route official requests when upstream 5xx occurs.

### Changed
- Frontend welcome background: replaced `OpenVideo.mp4` backgrounds on Home (`/`), Login (`/auth/login`), and Register (`/auth/register`) with reusable Three.js shader animation components (`frontend/src/components/background/WelcomeShaderBackground.tsx`, `frontend/src/components/background/ShaderPlaneBackground.tsx`).
- Auth UI: removed Watcha OAuth button and WeChat QR-scan login entry from login page and login-expired modal; login methods are now limited to phone/password and SMS code (`frontend/src/pages/auth/Login.tsx`, `frontend/src/components/auth/LoginModal.tsx`).
- Credits: 免费用户月度额度进入新周期前会先清空旧周期剩余额度，并新增定时兜底清理 `free_monthly_quota` 过期 lot，避免 30 天滚动周期下两笔 500 积分在账户余额中叠加。

### Updated
- Payment/Credits: removed recharge double-bonus campaign from frontend display and package policy docs; recharge packages are now fixed tiers (`25=2500`, `50=5000`, `100=10000`, `200=20000`, `500=50000`, `1000=100000`) and visible to all users without VIP gating.

### Fixed
- AI Chat Video: 对话框视频生成默认模型改回 `seedance-1.5-pro`，并将聊天视频时长选项收敛到 Seedance 1.5 支持的 `3/4/5/6/8/10s`。
- Flow/HappyHorse: 快乐马视频生成改为前端 `taskId` 轮询恢复模式；后端创建 DashScope 任务后立即返回 `taskId/apiUsageId` 并保持积分 `pending`，前端成功回写、失败/超时退款，刷新页面后可从节点 `taskId` 继续轮询。
- Auth Fetch: 403 responses are now treated as business authorization failures instead of expired login sessions, so paid-feature denials such as HappyHorse entitlement checks no longer force logout or open the login page (`frontend/src/services/authFetch.ts`).
- Credits/Text Route Pricing: `gemini-text` and `gemini-prompt-optimize` now both use flat route pricing by channel for Fast/Pro/Ultra (`normal=5`, `stable=10`) in preview and deduction.
- Flow/Text Nodes: `PromptOptimize` now has a working Fast/Pro/Ultra node-level model switch (synced to backend request params), and `PromptOptimize` + `TextChat` Run-button credit badge interaction is aligned with image-node behavior.
- Credits/Tool Selection: `/api/ai/tool-selection` now skips credit deduction entirely; Gemini tool-routing no longer consumes user credits.
- Credits Config: `gemini-tool-selection` default `creditsPerCall` is now `0` to prevent accidental charge paths.
- My Credits UI: transaction row metadata now prioritizes showing quantity (`数量：xN`) before route/model and removes aggressive truncation, so grouped multi-image deductions are auditable at a glance.
- Credits/Text: `gemini-prompt-optimize` uses the same route matrix as `gemini-text` (`normal: 5`, `stable: 10`; Fast/Pro/Ultra unified per route).
- Credits/Image Output Count: backend deduction now supports `unit credits × outputImageCount` for Gemini Banana image generate/edit/blend service types when requests carry multi-output count.
- Flow/My Credits: route-aware credits calculation now covers `promptOptimize`; `/my-credits` transaction items now show route channel label (`普通/尊享/官方`) and backend billing remark for clearer route-pricing audit.
- Gemini text billing: `gemini-text` follows normal/stable route pricing in backend deduction and preview quote (`normal: 5`, `stable: 10`; Fast/Pro/Ultra unified per route), and text-chat credit request forwards `providerOptions` so route info is preserved.
- Flow/Text Chat: run-button credit display for `textChat` node is now route-aware and tier-aware, aligned with backend Gemini text billing.
- Banana image billing: aligned normal/stable route resolution pricing across backend deduction tables and frontend credit displays (`FlowOverlay` + `FloatingHeader`) for generate/edit/blend fast/pro/ultra tiers, including stable ultra `1K/2K` and stable fast baseline.
- Banana image resolution routing: normalized `imageSize` tokens (`0.5K/1K/2K/4K`, case-insensitive input) before frontend request send, backend provider mapping, and Tencent VOD `OutputConfig.Resolution` submission to avoid selected `4K` being downgraded to fallback `1K`.
- Flow/Edge Reconnect: fixed legacy flow edge hydration where `sourceHandle` values like `image` / `image1` were not normalized to current handle ids (`img` / `img1`) on reopen, which could make existing node links appear disconnected after page load. Added source-handle normalization in Flow edge mapping and a compatibility output handle for `ImageCompressNode` (`frontend/src/components/flow/FlowOverlay.tsx`, `frontend/src/components/flow/nodes/ImageCompressNode.tsx`).
- AI Image Pipeline: 生图/改图/融合链路新增“成功结果必须包含有效图像载荷”校验；当上游返�?`HTTP 200` 但无 `imageData/imageUrl` 时，后端统一按失败处理并走退款路径，前端统一标记 `NO_IMAGE_PAYLOAD`，避免“显示成功但出图失败且重复扣分”�?
- Flow/Zoom: 修复节点文本输入区（`TextPrompt/TextPromptPro/Analysis/VideoAnalysis` �?`textarea`）内执行缩放时触发浏览器整页缩放的问题。当前按 `wheelZoomMode` 计算后，缩放手势会优先作用于画布；非缩放滚轮继续保留输入区原生滚动。同�?`GlobalZoomCapture` 已覆�?Flow 区域�?`gesturestart/gesturechange`，避免触控板 pinch 落到浏览器页面缩放（`frontend/src/components/flow/FlowOverlay.tsx`, `frontend/src/components/flow/nodes/TextPromptNode.tsx`, `frontend/src/components/flow/nodes/TextPromptProNode.tsx`, `frontend/src/components/flow/nodes/AnalyzeNode.tsx`, `frontend/src/components/flow/nodes/VideoAnalyzeNode.tsx`, `frontend/src/components/canvas/GlobalZoomCapture.tsx`）�?
- Flow Clipboard: 针对部分浏览器下 `Ctrl/Cmd + Shift + V` 可能不稳定触�?`paste` 事件的问题，Flow 新增键盘层兜底；当内�?Flow 剪贴板已有节点数据时会直接执行“保留连线粘贴”（`frontend/src/components/flow/FlowOverlay.tsx`）�?
- Membership UI: 会员页年付入口不再硬编码为禁用状态，现按后端返回�?`billingCycle=yearly` 套餐动态启用；同时移除“年付即将开放”的固定文案，并让结算摘要按实际周期展示“年�?月卡”（`frontend/src/components/payment/MembershipPanel.tsx`）�?
- Video Provider: 修复 `viduq3-pro` 在收�?`reference2video` 请求时错误回退�?`text2video` 的问题。后端现已补�?Q3 �?`reference2video` 模式推断、endpoint 映射�?payload 组装，避免“明明传�?prompt 却被上游�?text_video 缺少 prompt”�?
- Flow/Video: `Seedance/Kling/Vidu/Wan/Sora2` 视频节点移除了运行态固�?`30%` 进度，统一改为使用 `GenerationProgressBar` �?5 分钟渐进模拟（运行期缓慢递增�?95%，成功后�?100%），避免“假进度�?30%”�?
- Flow/Image: 图片生成节点统一改为 `GenerationProgressBar` 动态渐进并支持配置时长，`Generate/GeneratePro/GenerateReference/Midjourney/Nano2/Seedream5/ViewAngle` 已切换为 `60s` 渐进�?`95%`（成功后�?`100%`）�?

### Added
- Admin/API Records: 后台 API 记录支持按用户关键词过滤，可匹配用户 ID、手机号、邮箱和昵称。
- Flow Clipboard: `GeneratePro / ImagePro / GeneratePro4` 的右键“复制节点”改为写�?Flow 剪贴板（不再直接生成副本），可配�?`Ctrl/Cmd + Shift + V` 使用“保留原连线粘贴”（`Ctrl/Cmd + V` 仍保持常规粘贴）�?
- Flow Model Switch: `Generate` / `Agent(generatePro)` 节点新增节点本地 `modelProvider` 持久化，节点�?Fast/Pro/Ultra 切换不再改写全局 `aiProvider`；同时全局设置/对话框切换会广播 `flow:sync-model-provider`，可一键批量同步相关节点（`generate/generatePro/generatePro4/analysis/textChat`）到统一模型档位�?
- Flow/Analysis: analysis node now has an independent Fast/Pro/Ultra model switch (node-local state), and no longer mutates global aiProvider.
- Flow/Text Chat: text chat node now has an independent Fast/Pro/Ultra model switch (`modelProvider`) and still participates in global model-tier sync.
- Flow/Analysis: analysis requests are pinned to Banana normal route in-node, so global normal/stable channel switching does not affect analysis execution.
- Flow/Analysis: analysis node now routes Fast/Pro/Ultra to the same text-model mapping as Text Chat (multimodal language model path), replacing prior image-model mapping.
- Credits: image-analysis pricing is now unified to 10 credits across Fast/Pro/Ultra (`gemini-2.5-image-analyze` / `gemini-image-analyze` / `gemini-3.1-image-analyze`) for preview and backend deduction consistency.
- Gemini/Banana Pricing: 统一模型管理默认目录与定价回�?migration 现按家族映射对齐 Gemini 图片模型价格，`gemini-2.5-*` 对齐 Nano Banana Fast、`gemini-image-* / gemini-3-pro-*` 对齐 Nano Banana Pro、`gemini-3.1-*` 对齐 Nano Banana 2；同时修�?`BananaProvider.analyzeImage` �?`gemini-2.5-flash-image-preview` 的旧 147 模型名归一化，避免图像分析继续命中未配置价格的 preview 型号�?
- Model Management Pricing: 新增 Prisma migration `202604140001_backfill_missing_managed_model_pricing_from_defaults`，按当前代码写死的默认配置回�?`model_provider_mapping_v2` 中缺失的统一模型管理 pricing，覆�?Banana 图片链路、Gemini 图像分析、Seedream5、Midjourney、Wan 2.6/2.7，以及按 `model` 维度补齐 Sora 2 �?pricing v2 规则�?
- Flow/Model Management: 图像分析节点默认配置改为挂接统一模型管理 `gemini-2.5-image-analyze`，并新增 Prisma migration `20260413203033_backfill_analysis_node_managed_routes_from_mapping` 回填既有 `NodeConfig.analysis` �?`modelKeys / managedModelKey / managedRoutes`，避免分析节点继续停留在�?`gemini-image-analyze` 单节点计费配置而无法命中统一模型路由�?
- 新增产品定价策略文档，统一整理三类积分、免费用户额度�?9/199/599 档会员权益与待确认规则（`frontend/docs/39-产品定价策略.md`）�?
- 新增面向官网/支付页的会员定价展示文案，包含标题、副标题、套餐卡片、对比表、积分说明与年费展示口径（`frontend/docs/40-会员定价展示文案.md`）�?
- Prisma migration fix: added `202604120001_fix_wechat_login_session_profile_columns` to backfill missing `WechatLoginSession.nickname` / `avatarUrl` columns that were omitted from the initial公众号扫码登录建�?migration, preventing `/api/auth/wechat-official/sessions/:id` from failing with Prisma missing-column errors on upgraded environments.
- Flow Credits Display: run-button credit badges now resolve with effective default parameters for video nodes and apply Kling 2.6/3.0 dynamic credit matrix so displayed credits match actual deduction.
- Workspace Safety: added global leave-risk warning banner and upgraded leave confirmation logic to cover both uploading tasks and running Flow tasks; leaving during in-flight tasks now warns about potential data loss.
- Runtime Stability: weak-network image delivery hardening for OSS/CDN resources, including adaptive timeout/retry in frontend image fetch (`imageSource.ts`) and proxy upstream timeout/retry in backend `/api/assets/proxy`.
- Runtime Stability: custom CDN host `tai.tarvas.cn` added to frontend managed/proxy allowlist for direct public URL and fallback proxy compatibility.
- Admin/Model Management: 后台“系统设置”新增“统一模型管理”tab，可直接编辑完整 `model_provider_mapping_v2` JSON，并支持通过 `models[].vendors[].metadata.specPricing` 配置按规格匹配的积分规则；默认模型目录补齐平台内图片模型（Nano Banana Fast/Pro/2、图像编辑、图像融合、Gemini 图像分析），模型列表新增搜索与类型筛选，图片规格积分按模型能力维度展示，不再只覆盖视频模型�?
- Seedance 2.0 模式参数补齐：模型管�?V2 请求体新�?`video_mode` 字段，前端模式选择可完整传递至方舟上游�?
- 认证系统新增“公众号扫码登录”闭环：后端支持带参数二维码会话、微信公众平台回调验签与 `subscribe/SCAN` 自动登录；前端登录页新增公众号扫码二维码面板与轮询消费登录会话�?
- Credits Backend 基础设施新增多形态积�?groundwork：Prisma 增加 `CreditLot` / `CreditConsumePolicy`，`CreditTransaction` 增加 lot / policy 审计字段；后端新�?`credit-lot-policy.ts` 用于 lot 过滤、优先级排序和扣减规划�?
- Credits Backend 已将三条发放链路接入 lot：充值成功、管理员补发、新用户注册赠送；当前均按 permanent lot 落库，为后续切换�?lot 真值扣减做准备�?
- Credits Backend 进一步接入每日签�?lot 化、hybrid lot 扣减�?lot 级退款恢复；`CreditConsumePolicy` 支持读取 `global_default` 配置并在 migration 中完成初始化�?
- Membership Backend P0 最小闭环：新增 `MembershipPlan` / `UserMembershipSubscription` / `MembershipEntitlementSnapshot`，`PaymentOrder` 支持 `membership` 订单类型；支付成功后可激�?续期订阅，并发放 `membership_bound` 积分 lot�?
- Membership Backend P1 补齐到期收口：新增会员到期小时级扫描任务；过期订阅会被标�?`expired`，其 `membership_bound` lot 会归零并写入 `membership_expire` 流水，权益快照回落到 `free/inactive`�?
- Membership Backend P1 继续补齐权益调度：新增每日赠送积分衰减任务（`gift_decay`）和年费会员月度额度刷新任务（`membership_refresh`），均由 `MembershipSchedulerService` 驱动�?
- Credits/Membership Backend 进一步对齐定价策略：新增免费用户月度额度发放（`free_monthly_quota`）闭环，默认消费优先级调整为 `月卡 -> 赠�?-> 固定`，`membership_credit_policy` 新增 `freeUserMonthlyQuotaCredits` 配置项�?
- Credits/Membership Backend 继续对齐签到策略：免费签到继续走策略配置，活�?VIP 的签到奖励改为只读取当前会员套餐 `dailyGiftCredits`，不叠加免费签到额度；第 7 天支持按倍率发放�?
- Membership Backend 新增读接口：`GET /api/membership/current` 返回当前订阅/套餐/权益聚合视图，`GET /api/membership/entitlement` 返回当前权益快照，供前端会员页接入�?
- 认证系统新增观猹 OAuth2 登录：后端增�?`/api/auth/watcha/authorize` + `/api/auth/watcha/callback`，支持授权回调后自动登录、绑�?创建本地账号（`watchaUserId`）�?
- 登录页在“登录”按钮下方新增观猹入口按钮，复用后端授权跳转链路并支持回调错误提示�?
- 工作流历史版本：新增 `WorkflowHistory` 表（�?`userId + projectId + updatedAt` 复合主键），后端提供查询接口；前端右上角增加 n8n 风格历史按钮与“恢复并保存”交互�?
- 画布�?AI 对话框支�?JSON 复制/导入（右�?+ `Ctrl/Cmd+Shift+C/V`），导出内容�?`Project.contentJson` 保持一致�?
- Flow 新增 `MiniMax 音乐生成` 节点（`minimaxMusic`）：支持 `prompt`、`lyrics`、`isInstrumental`、`lyricsOptimizer`，输出音�?URL 并支持历史回�?下载；后端新�?`POST /api/ai/minimax-music`，接�?MiniMax `music_generation` 接口并纳入积分服�?`minimax-music`�?
- 新增用户模板云端持久化：后端增加 `UserTemplate` 数据模型�?`/api/user-templates` 鉴权 CRUD，前端“我的模板”从本地 IndexedDB 优先切换为后端存储（保留本地回退与迁移）�?
- 前端右侧库面板新增双标签：`全局历史` �?`手动素材`，全局历史支持搜索、类型筛选、页码分页（`1 2 ... N`）、拖�?发送到画板；同时修复库面板内容区在部分视口下无法下滑的问题�?

### Changed
- Membership/Payment UI: `MembershipPanel` 的积分充值入口从“仅月卡会员”调整为“任�?active 会员（含年卡）或白名单用户（`noWatermark`）可见”，并同步更新充值区提示文案（`frontend/src/components/payment/MembershipPanel.tsx`）�?
- AI Text Model Routing: Fast/Pro/Ultra 文本模型映射更新�?`banana-2.5 -> gemini-2.5-flash`、`banana -> gemini-3-pro-preview`、`banana-3.1/nano2 -> gemini-3.1-pro-preview`；前�?`auto` 工具选择请求现在显式携带文本模型，且 Banana Ultra �?147 �?Apimart 通道统一使用 `gemini-3.1-pro-preview`�?
- Flow/Performance: workflow 画布在大节点量场景下启用自适应性能策略：`onlyRenderVisibleElements` 默认改为开启，并在节点数较大时自动强制“仅渲染可见元素”；同时大图模式会自动关闭节点吸附对齐，减少拖拽时的全图对齐计算开销（`frontend/src/stores/flowStore.ts`, `frontend/src/components/flow/FlowOverlay.tsx`）�?
- Flow/Performance: 优化节点局部更新与连线扫描热点。`FlowOverlay` �?`flow:updateNodeData` 改为按节�?id 定位并只更新目标节点，避免每�?patch 全量 `map` 节点数组；`Generate/GeneratePro` 输入图选择器改为单次遍历边并优先读�?`nodeLookup`，`GenericVideo` 将多�?`edges` 扫描合并为一次统计，减少大图场景的重复计算（`frontend/src/components/flow/FlowOverlay.tsx`, `frontend/src/components/flow/nodes/GenerateNode.tsx`, `frontend/src/components/flow/nodes/GenerateProNode.tsx`, `frontend/src/components/flow/nodes/GenericVideoNode.tsx`）�?
- Flow/Performance: `ImageNode` 进一步收�?store 热点读取。将 `hasInputConnection` �?`connectedFrameImage` 合并为单�?selector（共享边/节点索引），并把 `imageSplitCropInfo` 的链路解析改为使用预构建 `nodeById` �?`img` 入边索引，减少重�?`edges.find` / `getNodes().find` 扫描（`frontend/src/components/flow/nodes/ImageNode.tsx`）�?
- Flow/Performance: `ImageNode` 节点卡片展示改为“缩略图优先、原图兜底”，避免节点视图优先加载原图导致的解码与重绘开销（`frontend/src/components/flow/nodes/ImageNode.tsx`）�?
- Flow/Performance: 优化导入�?JSON 后的拖拽链路。拖拽期间的 `nodes/edges` 同步 effect 现在会在转换前直接短路，避免每帧执行 `rfNodesToTplNodes/rfEdgesToTplEdges`；同时导入模板时会将节点 `history` 数组压缩为最新一条，降低运行态对象体积与后续重渲染开销（`frontend/src/components/flow/FlowOverlay.tsx`）�?
- Flow/Performance: 继续优化大图拖拽路径。`collapsedChildToGroupId` 改为签名缓存，避免普通拖拽时触发全量边映射重算；`nodesWithHandlers` 引入按节点对象命中缓存，减少每帧对全量节点重新包装；节点数较大时自动隐藏 `MiniMap` �?`MiniMapImageOverlay`，降低缩略图层与全图映射的额外开销（`frontend/src/components/flow/FlowOverlay.tsx`）�?
- Flow/Performance: 恢复 `MiniMap` 常驻显示，仅在大图场景自动关�?`MiniMapImageOverlay` 图片叠加层；并优化双�?触控板缩放链路：`Canvas -> Flow` 视口同步改为 `RAF` 合帧，且缩放时将 `pan/zoom` 合并为单�?store 写入，减少缩放过程的重复 `setViewport` 与重绘（`frontend/src/components/flow/FlowOverlay.tsx`, `frontend/src/components/canvas/GlobalZoomCapture.tsx`）�?
- Flow/Performance: 关闭“仅渲染可见”的自动强制策略，并�?`flow-settings` v2 默认值回退为全量渲染（`onlyRenderVisibleElements=false`），减少节点进入视窗时的重挂载抖动；前端开关改为纯手动控制（`frontend/src/components/flow/FlowOverlay.tsx`, `frontend/src/stores/flowStore.ts`）�?
- Flow/Performance: 按需恢复“仅渲染可见”策略（含大图自动强制开启）；`flow-settings` 升级�?v3 并将 `onlyRenderVisibleElements` 默认恢复�?`true`，工具栏开关在大图场景显示“自动”状态（`frontend/src/components/flow/FlowOverlay.tsx`, `frontend/src/stores/flowStore.ts`）�?
- Flow/Performance: 新增“低缩放降级”策略。节点数达到阈值后，缩�?`<=40%` 自动进入低细节模式（`45%` 退出滞回）：节点缩略图改灰色占位、`SmartImage` 暂停图片解析转换、关键裁切缩略图 `canvas` 停止渲染；同时在该模式下隐藏连线�?MiniMap（节�?UI 保留），进一步降低全图缩小时�?SVG 重绘与样式计算开销（`frontend/src/components/flow/FlowOverlay.tsx`, `frontend/src/components/flow/FlowRenderModeContext.tsx`, `frontend/src/components/ui/SmartImage.tsx` 及相关节点组件）�?
- Backend/Video Provider: 统一放宽视频生成接口 `VideoProviderRequestDto.prompt` 校验上限，从 `2500` 提升�?`5000` 字符，覆�?Seedance/Kling/Vidu 共用链路（`backend/src/ai/dto/video-provider.dto.ts`）�?
- Membership/Credits: removed frontend auto check-in at app bootstrap. Daily reward now requires an explicit user check-in action, and paid-tier `dailyGiftCredits` is defined as the member's daily check-in credit amount rather than an automatically issued daily grant.
- Credits Detail UI: `My Credits` transaction list and Admin `细分积分明细` now show `模型` under each record item, using API usage model when available and `--` fallback when absent.
- AI Analyze/Text defaults: `ai.controller` now defaults text/analyze model to `gemini-3.1-pro`, while `banana-2.5` analyze keeps `gemini-2.5-flash-image-preview`; Banana image-analyze adds quota-aware fast fallback (`3.1-pro -> 3-pro-image -> 2.5`) and stops same-model retries on explicit 429/quota errors.
- Flow / Agent Pro Node: replaced the run-toolbar resolution control from `NodeSelect` dropdown to chat-style `HD` button + segmented popup (`Auto/1K/2K/4K`, and `0.5K` for Ultra), with matching interaction (outside-click close, active state, and value persistence to `imageSize`).
- Flow/Video: 腾讯渠道 `Kling O3` 自定义分镜改�?C 端可用上传交互（图片/视频上传替代手填 URL），运行时会把节点上传素材并�?`referenceImages/referenceVideo` 并按腾讯文档校验（图片上�?`7`，视频参考场景图片上�?`4`，视频时�?`3-10s`），确保 FileInfos 参数可直接对齐下发（`frontend/src/components/flow/nodes/KlingO3VideoNode.tsx`, `frontend/src/components/flow/FlowOverlay.tsx`）�?
- Membership/Credits: `VIP 69` no longer participates in legacy automatic daily-gift issuance, and now follows the same manual check-in reward path as other paid tiers. `dailyGiftCredits` is treated as check-in credits instead of an auto grant; frontend `/my-credits` still hides legacy `VIP 69 ... 每日赠送积分` rows.
- Credits/Quota: 免费用户生成配额改为按“是否存�?`paymentOrder.status=paid`”统一判定；未付费用户默认执行 `日生�?0、月生图100、日视频3、月视频10`（UTC 口径），管理员角色仍豁免（`backend/src/credits/credits.service.ts`）�?
- Credits/Quota: 免费用户�?`Run` 触发超限时，后端错误文案统一追加“免费额度已用尽，请前往充值，享有更多权限后可继续生成”，覆盖�?月图与日/月视频四类上限场景（`backend/src/credits/credits.service.ts`）�?
- Chat/Banana route: stable (Tencent) now applies explicit capability guards: manual `Analysis` mode is hidden/blocked, Tencent reference-image limits are enforced (Fast=3, Pro/Ultra=14), and auto tool-selection no longer picks `analyzeImage` on stable route.
- Flow/Video: disabled Run-button hover credit swap for video nodes (e.g. Kling, Vidu, Seedance). Hover/focus now keeps `Run` text and no longer shows points badge in-place (`frontend/src/components/flow/flow.css`).
- Flow/Video: 修复 `Seedance 2.0` 在切换到 `多图参�?/ 智能多帧` 后仍只能连接 1 张上游图片的问题；节点现会渲染与 `FlowOverlay` 分槽逻辑一致的 `image-slot-*` 目标句柄，确保多图连线可实际落到独立 slot（`frontend/src/components/flow/nodes/GenericVideoNode.tsx`）�?
- Flow/Video: `Seedance 2.0` �?`多图参�?/ 智能多帧` 现改为显式展示全部图片槽位句柄（最�?`9/10` 个），方便直接看到当前模式的最大接图数量与空闲 slot（`frontend/src/components/flow/nodes/GenericVideoNode.tsx`）�?
- Flow/Video: `Seedance 2.0` 改为“最大输入能�?+ 自动推导模式”；前端移除手动模式切换，固定展�?`text / 9 �?/ 尾帧 / video / audio` 句柄，并按当前连线自动推�?`video_mode`，旧 `smart_frames` 配置自动兼容�?`reference_images`（`frontend/src/components/flow/nodes/GenericVideoNode.tsx`, `frontend/src/components/flow/FlowOverlay.tsx`, `backend/src/admin/services/node-config.service.ts`）�?
- Flow/Video: `Seedance 2.0` 节点补齐官方规格，新�?`Seedance 2.0 Fast` 模型选择、模式化句柄（文�?首帧/首尾�?多图/视频/音频组合）、`1-9` 图全能参考、`2-10` 智能多帧、`4-15s` 时长�? 种比例和 `480P/720P` 分辨率配置；运行时同步支持图/视频/音频多模态请求拼装（`frontend/src/components/flow/nodes/GenericVideoNode.tsx`, `frontend/src/components/flow/FlowOverlay.tsx`, `frontend/src/services/videoProviderAPI.ts`）�?
- Backend/Admin: Seedance 2.0 模型管理与默认节点配置同步升级，`seedance-2.0` 统一支持 `seedance-2.0 / seedance-2.0-fast` 两个模型别名，请求路由按 `seedanceUpstreamModelId` 动态下发到官方 `260128 / fast-260128` 模型 ID，并修正后台默认能力描述、输入模式和输出规格（`backend/src/ai/services/video-provider.service.ts`, `backend/src/ai/services/model-routing.service.ts`, `backend/src/admin/services/node-config.service.ts`, `frontend/src/pages/Admin.tsx`）�?
- 认证页移动端适配：`/auth/login` �?`/auth/register` 在小屏下改为可纵向滚动的顶部对齐卡片，收紧内边距，三标签切换改为紧凑布局，验证码区和协议区适配窄屏换行，避免登�?注册页在手机端出现横向挤压和底部内容被遮挡（`frontend/src/pages/auth/Login.tsx`, `frontend/src/pages/auth/Register.tsx`）�?
- 登录页与登录弹窗统一改为三标签结构：`微信登录 / 密码登录 / 验证码登录`，默认进入微信登录；公众号扫码登录不再与手机号表单同时展开，减少界面拥挤与选择成本（`frontend/src/pages/auth/Login.tsx`, `frontend/src/components/auth/LoginModal.tsx`）�?
- OpenObserve `backend_request` 写入前新增请求体整体长度上限：`body` 序列化后若超�?`4096` 字符，会改写为包�?`preview` / `originalLength` 的摘要对象，避免完整 base64 请求体原样落�?`backend_requests`；可通过 `OPENOBSERVE_BACKEND_REQUEST_BODY_MAX_LENGTH` 调整（`backend/src/telemetry/openobserve-telemetry.service.ts`）�?
- 公众号明文模式回调新�?OpenObserve 结构化事件日志：收到 `/api/auth/wechat-official/callback` 时会把原�?XML 明文写入 `backend_events` 流，并在命中扫码登录授权后追加一条授权成功事件，便于直接�?OpenObserve 中排查公众号回调内容（`backend/src/auth/auth.service.ts`, `backend/src/telemetry/openobserve-telemetry.service.ts`）�?
- OpenObserve 改为默认保留明文请求日志并在生产默认开启：`backend_requests` 新增原始请求�?请求体，`upstream_requests` 不再对文�?header/body 做脱敏或截断，`frontend_error` 前端上报在生产默认开启，后端 tracing 也改为生产默认启用（`backend/src/telemetry/*`, `frontend/src/bootstrap/runtimeStability.ts`）�?
- Canvas：`ImageContainer` 的“高清放大”现在会先读取原图尺寸并推导最近似长宽比，一并传�?`gemini-3-pro-image-preview`；同时强化提示词，明确要求保持原始宽高比、禁止裁�?补边/拉伸/改构图，降低 4K 放大时输出尺寸漂移的概率（`frontend/src/components/canvas/ImageContainer.tsx`）�?
- Membership Backend 调整到期口径：订阅积分优先消耗，会员到期时重置订阅积分；免费用户继续�?30 天周期发�?`freeUserMonthlyQuotaCredits`（默�?`500`）�?

### Fixed
- Referral / Credits: 手动签到接口 `/api/referral/check-in` 现已复用 `CreditsService.claimDailyReward`，并沿用同一�?3AM 业务日、事务锁与幂等判断，避免重复发放�?
- Workspace / Membership Entry: 顶栏积分入口改为就地弹出 `MembershipPanel`，不再通过 `/membership` 路由切换页面；支付成功后仅刷新积分状态并关闭弹窗（`frontend/src/components/layout/FloatingHeader.tsx`）�?
- Backend / Seedance 2.0: 修正 `seedance_api` 直连时的 `resolution` 映射，Seedance V2 请求会把前端/节点里的 `480P/720P` 规范成上游要求的 `480p/720p`，避免规格已透传但因分辨率值格式不匹配被方舟拒绝（`backend/src/ai/services/video-provider.service.ts`）�?
- Backend / Seedance 2.0: �?`seedance_api` 直连�?`r2v` 请求增加分支保护，检测到参考图/视频/音频模式时自动省�?`resolution`，避免方舟返�?`the parameter resolution ... is not valid for model doubao-seedance-2-0 in r2v`（`backend/src/ai/services/video-provider.service.ts`）�?
- Backend / Model Routing: 修复数据库中旧版 `model_provider_mapping_v2` 覆盖默认 Seedance 2.0 V2 metadata 时丢失规格字段的问题；现�?`requestProfile` 做默认值合并，旧配置也会自动补�?`duration / video_mode / resolution / generate_audio` 等字段（`backend/src/ai/services/model-routing.service.ts`）�?
- Flow / Seedance 视频节点：新增节点级时长校准。画布内视频节点现在会为 Seedance 写入默认有效时长，并在模型切换或历史节点载入时将非法 `clipDuration` 自动修正到最近可用规格，避免时长面板已选择但运行请求未携带有效 `duration`（`frontend/src/components/flow/nodes/GenericVideoNode.tsx`, `frontend/src/components/flow/FlowOverlay.tsx`）�?
- AI Chat / Seedance 2.0: 修复聊天视频生成链路未显式透传 `seedanceModel` �?`video_mode` 的问题；聊天面板视频时长选项同步校正�?`4/5/6/8/10/12/15s`，确保长宽比/时长等规格可以随请求带到上游（`frontend/src/stores/aiChatStore.ts`, `frontend/src/components/chat/AIChatDialog.tsx`）�?
- 公众号扫码登录改用微信推荐的稳定 `stable_token` 接口获取全局 `access_token`，并在生成登录二维码遇到 `access_token is invalid or not latest` 时自动强制刷新后重试一次，降低多实例或第三方系统并发刷�?token 导致的二维码生成失败�?
- 后台权限新增 `normal_admin`（普通管理）角色：后端仅放行 `概览、用户管理、API统计、API记录、公共模板、水印白名单` 对应接口，`admin` 仍保留全量后台权限（`backend/src/admin/admin.controller.ts`, `backend/src/admin/dto/admin.dto.ts`）�?
- 后台页面按角色显�?Tab：`normal_admin` 只显�?`概览 / 用户管理 / API统计 / API记录 / 公共模板 / 水印白名单`；并在“用户管理”中隐藏“角�?状态”列与“详�?删除”按钮（`frontend/src/pages/Admin.tsx`, `frontend/src/components/layout/FloatingHeader.tsx`）�?
- 工作流历史恢复新增来源标记：从历史版本“恢复并保存”后，新写入�?`WorkflowHistory` 会记�?`restoredFromUpdatedAt/restoredFromVersion`，前端历史列表可直接看到“恢复自哪个版本”，避免恢复生成的新记录与普通保存记录难以区分（`backend/src/projects/*`, `frontend/src/components/workflow-history/WorkflowHistoryButton.tsx`, `frontend/src/services/projectApi.ts`）�?
- Backend `WorkflowHistory` 新增 7 天保留策略：项目历史查询仍返回当前项目全部现存记录，但由 `projects` 定时任务每日凌晨物理清理 7 天前数据，并�?`updatedAt` 增加索引以降低批量删除成本（`backend/src/projects/projects.service.ts`, `backend/src/projects/projects-scheduler.service.ts`, `backend/src/projects/projects.module.ts`, `backend/prisma/schema.prisma`）�?
- Workspace 顶部右侧工具区恢复手动保存与工作流历史入口：`ManualSaveButton` �?`WorkflowHistoryButton` 重新挂载�?`FloatingHeader`，用户可再次直接保存并查�?恢复工作流历史（`frontend/src/components/layout/FloatingHeader.tsx`）�?
- Flow/Admin：将 `Vidu` 视频节点收拢为单一 `viduVideo` 入口，当前仅保留 `Q2 / Q3` 两档；移除除 `vidu-q2 / vidu-q3` 外的其余 Vidu 型号配置和暴露入口（`frontend/src/pages/Admin.tsx`, `backend/src/admin/services/node-config.service.ts`, `backend/src/ai/services/model-routing.service.ts`, `backend/src/ai/services/video-provider.service.ts`）�?
- Flow：修正节点添加面板分组逻辑，不再把所�?`category: "input"` 节点提前归入“文字类节点”；`video` 输入节点现在会按真实节点类型显示在“视频类节点”（`frontend/src/components/flow/FlowOverlay.tsx`）�?
- Workspace 顶部项目名区域新增快�?`+` 新建入口：在当前项目名称右侧可一键新建项目；项目下拉中的“新建项目”同步复用同一创建逻辑并增加防连点状态（`frontend/src/components/layout/FloatingHeader.tsx`）�?
- Flow: tightened connection validation in FlowOverlay so text handles (text/prompt/response-text) and image handles (img/image/image*) are no longer cross-connectable by source node type alone.
- Flow: fixed Kling video run-path image collection to include `image-2` (end frame) and enforce handle order (`image` -> `image-2`), so Kling 3.0 Pro start/end frame mode can take effect.
- AI `generate-image`：当上游仅返回外�?`imageUrl` 时，统一改为后端拉取并转�?OSS 后再返回；管理员/白名单仍可跳过水印，但不再直返第三方临时链接，减少云端历史过期裂图（`backend/src/ai/ai.controller.ts`）�?
- Credits Backend: `updateApiUsageStatus` 增加状态机保护，禁�?`failed -> success` �?`success -> failed` 反向回写，减少超时自动退款与晚到成功回写造成的状�?账务不一致（`backend/src/credits/credits.service.ts`）�?
- Frontend `/my-credits`: “今日消�?/ 最�?7 天消�?/ 趋势图”改为净消耗口径（`spend - refund`，最�?0），避免失败后已退款流水仍被计入消耗（`frontend/src/pages/MyCredits.tsx`）�?
- Flow：节点添加面板与快捷连接候选统一隐藏 `sora2Video` / `sora2Character` / `nano2`，不再展�?`Sora 2`、`Sora2 Character` �?`Nano2` 入口（`frontend/src/components/flow/FlowOverlay.tsx`）�?
- AI Analyze：`POST /api/ai/analyze-image` 增加 `sourceImages` 多图输入（兼容原 `sourceImage` 单图）；Flow `Analysis` 节点同步支持多图连线分析，`gemini/gemini-pro/banana` 按多文件联合分析，`midjourney describe` 对多图输入返回明确不支持错误�?
- Flow Analysis：`text` 句柄支持多条 Prompt 连线并在运行时串联拼接（不再被新连线覆盖）�?
- AI 图像调用（`generate-image` / `edit-image` / `blend-images`）前端自动重试从 3 次收敛为 1 次，避免网络抖动时同一次用户操作触发多条积分扣�?退款流水；失败重试由后�?provider 内部策略承接（`frontend/src/services/aiBackendAPI.ts`）�?
- Canvas 右键菜单中的 JSON 操作改为直接复用 Flow「我的模板」导�?导出链路：`导出画布 JSON` 触发 `flow:export-template-request`，`导入画布 JSON` 触发 `flow:import-template-request`；同�?`FlowOverlay` 新增 `flow:export-template-request` / `flow:import-template-request` / `flow:import-template-json` 事件监听，统一走同一套导入导出实现（`frontend/src/components/canvas/DrawingController.tsx`, `frontend/src/components/flow/FlowOverlay.tsx`）�?
- Flow `Multi Generate`（`generate4`）节点移�?`Count` 配置，运行轮次固定为 4；新建节点初始化数据不再写入 `count` 字段，避免配置面板与实际行为不一致（`frontend/src/components/flow/nodes/Generate4Node.tsx`, `frontend/src/components/flow/FlowOverlay.tsx`, `frontend/src/components/flow/types.ts`）�?
- Credits 页面（`/my-credits`）概览卡片右上角改为“立即充值”按钮（点击弹出 `PaymentPanel`）；同时顶部“我的积分”入口图标升级为金币高光样式（`frontend/src/pages/MyCredits.tsx`, `frontend/src/components/layout/FloatingHeader.tsx`）�?
- Credits 充值弹窗布局微调：左侧套餐区域补充底部留白，视觉更舒展（`frontend/src/components/payment/PaymentPanel.tsx`）�?
- Workspace 保存状态提示位置调整：不再在画布顶部常驻显示，改为在设置首页（Workspace）用户信息区展示（`frontend/src/components/layout/FloatingHeader.tsx`）�?
- Workspace 顶部右侧工具区新增“积分”入口（图标 + 当前余额），并与设置弹窗“积分详情”复用同一跳转逻辑，统一打开 `/my-credits`（`frontend/src/components/layout/FloatingHeader.tsx`）�?
- Flow：节点拖拽新增自动对齐（边缘/中心吸附）与参考线展示，复用图片自动对齐算�?`detectAlignments/deduplicateAlignments`，并接入全局开�?`snapAlignmentEnabled`（`frontend/src/components/flow/FlowOverlay.tsx`, `frontend/src/components/flow/flow.css`）�?
- Workspace 设置弹窗：切换左侧分组后，右侧内容区滚动位置会重置到顶部，不再记忆上一次分组的滚动位置（`frontend/src/components/layout/FloatingHeader.tsx`）�?
- Canvas：`ImageContainer` 图片操作新增“提取调色板”，点击后按当前图片提取 6 个主色，并在原图右侧生成独立调色板图片（走快速上传链路，最终持久化为远程引用）�?
- Canvas 绘制新增 `Shift` 融图交互：在仅选中 1 张图片且使用 `free/line/rect/circle` 绘制时，按住 `Shift` 完成绘制会将图形直接烘焙进该图片（含填充）；本地即时替换后后台上传并自动升级为远程引用，失败时回退保留原始图形（`frontend/src/components/canvas/DrawingController.tsx`）�?
- Canvas 绘图面板新增线条样式选项：`实线 / 虚线 / 点画�?/ 手绘风（两头粗中间细�? 手绘风（中间粗两头细）`；手绘风�?`free/line` 下会把中心线转换为闭合轮廓路径，并在 SVG 导出时保�?`stroke-dasharray` / `stroke-dashoffset`（`frontend/src/components/toolbar/ToolBar.tsx`, `frontend/src/stores/toolStore.ts`, `frontend/src/components/canvas/hooks/useDrawingTools.ts`, `frontend/src/components/canvas/DrawingController.tsx`）�?
- 管理后台「付费用户」列表新增白名单状态透出：后�?`GET /api/admin/paid-users` 返回 `noWatermark`，前端状态列对白名单用户显示 `VIP`（`backend/src/admin/admin.service.ts`, `frontend/src/services/adminApi.ts`, `frontend/src/pages/Admin.tsx`）�?
- Workspace 顶部帮助入口改为悬停下拉：问号按钮不再直接跳转，改为 hover 后显�?`用户手册` �?`更新日志` 两个链接项（`frontend/src/components/layout/FloatingHeader.tsx`）�?
- Workspace 外观设置：新用户默认 `风格样式` 改为 `网格`（`GridStyle.LINES`），用户手动切换后的样式继续按现有本地偏好持久化（`canvas-settings` / `tanva-view-settings`）保留�?
- Flow `ImageSplit` 新增“分割模式”配置：支持 `智能分割` �?`自定义网格`；`自定义网格` 可按 `列×行`（如 `4×2`）固定切分，并自动同步输出端口数量（总数限制 `<=50`）�?
- AI 生成分辨率选项调整：Pro（`banana` / `gemini-pro`）重新开�?`1K / 2K` 选择，不再固�?`4K`；聊天面板与 Flow 生成节点（`GenerateNode` / `GenerateProNode` / `GeneratePro4Node`）保持一致�?
- Credits: 调整图像编辑/融合计费与名称展示。Ultra（`gemini-3.1-image-edit`/`gemini-3.1-image-blend`�?.5K=20�?K=45；Pro（`gemini-image-edit`/`gemini-image-blend`�?K=40�?K=60；对应服务名更新�?`（Ultra）` / `（Pro）`，以便前端积分流水直接区分模式�?
- Credits/API: `GET /api/credits/transactions`（含管理员对应接口）新增返回 `provider` �?`model`，并继续返回 `channel`，用于前端直接展示“渠�?+ 模型”�?
- AI Analyze: `POST /api/ai/analyze-image` 计费链路补充 `aiProvider/channelHint` 入库，避免部分图像分析流水缺失渠道信息�?
- Frontend `/my-credits`: 交易列表“项目”行新增模型展示，与渠道并列显示（`渠道：X · 模型：Y`）�?
- Credits/Video Async：补齐异步视频积分状态收敛链路（新增 `POST /api/ai/video-task-success` 成功回写；`generate-video-provider` 创建失败退款兜底；pending 超时自动退款覆盖视频服务，默认 30 分钟）；`/my-credits` 交易列表新增状态列，`pending` 显示黄色“处理中”�?
- Credits/Video Async：新增视频自动退款分界线，默认仅处理 `2026-03-28T00:00:00.000Z` 之后创建�?`pending` 记录（可通过 `CREDITS_PENDING_VIDEO_REFUND_CUTOVER_AT` 覆盖，`off/none/0` 关闭），避免上线时历史记录批量退款�?
- Flow�?�??�?�??�?��?��?�??�??�?�?�?�?��?��??�?�??叠�?�?保�??�??�?卡�??�?�?�??子�??�?��?��?��?并保�??�?�?�?�??�?��??�?线�?端�?��?��?�?��??�?�??�?��?�?�??叠卡�??�?��?��?示�?�??�?��??缩�?��?��?�?�?`frontend/src/components/flow/FlowOverlay.tsx`�?�`frontend/src/components/flow/nodes/NodeGroupNode.tsx`�?�??
- Flow�?修复�??�?�?��??�?�?�?�??换�?�?线�?常�?失�??�?��?�?�??叠�?��?�??�?线�?�为 `hidden`�?保�??�??�?edge id�?�?�?�?�?可稳�?恢复�?`frontend/src/components/flow/FlowOverlay.tsx`�?�??
- �?��?�积�??页�??积�??记�?�?�表格�?��?�??�?��?积�??�?��??�?使�?�每条交�??�?? `balanceAfter`�?�?�?管�?�??�??积�??详�??�?�中�??�?额�?示保�?��?�?��?`frontend/src/pages/MyCredits.tsx`�?`frontend/src/i18n/locales/zh-CN.ts`�?`frontend/src/i18n/locales/en-US.ts`�?�??
- 管�?�?台�?��?��??表�??�??积�??详�??�?�弹�?�?��?�??�?�??积�??�??�?�?�模�?�?对齐�?��?�端积�??�??�?�?示�?项�?�?积�??/�??�?��?��?�?�?�费�?��?��?�?并�?��?�??�?��?积�??�?�?�?��?�?额�?�?��?示�?�?端�?��?管�?�??�??�?��?��?�询积�??流水�?�口�?`GET /api/admin/users/:userId/credits/transactions`�?�??
- Canvas�?�?��??�?�?右侧缩�?��?��?�为项�?�级�??页�??�?�载�?不�?��?��?��??�?�?��?�??史�?`frontend/src/components/canvas/ImageContainer.tsx`�?�??
- Canvas�?�??中�?��??�?步�??AI 对话�?�?��?�?�??使�??`remoteUrl`�?缺失�?��?OSS key 转为可访�??URL�?`frontend/src/components/canvas/DrawingController.tsx`�?�??
- AI 对话�?�?�?�?�?�渲�??�?��?�?��??key 转为可访�??URL�?避�?��?��?`/projects/...` 导�?��?��??空�?��?`frontend/src/components/chat/AIChatDialog.tsx`�?�??
- Canvas�?�?传�??�??�?�确�?`remoteUrl` 为�?�??OSS URL�?�?��?`VITE_ASSET_PUBLIC_BASE_URL`�?�?避�?��??中�?��??只�?��?key�?`frontend/src/components/canvas/DrawingController.tsx`�?�??
- Canvas�?�?传�??�??�?�?`imageData.url` �?�??使�?��?�? URL�?避�?��??中�?�仍落�?�?key�?`frontend/src/components/canvas/DrawingController.tsx`�?�??
- Canvas�?�?��??�??�??�?传�?�?��?�?��?�触�?�?次保�?�?`frontend/src/components/canvas/hooks/useQuickImageUpload.ts`�?�`frontend/src/components/canvas/DrawingController.tsx`�?�??
- Canvas�?�?��?��?传�?��??�?�?��?�??�?�项�?��?��?�??史�?确保�?�?�??表可见�?`frontend/src/components/canvas/ImageUploadComponent.tsx`�?�??
- Canvas�?�?�?�??�?��?传�?�?��?补�??项�?��?��?�??史�?`frontend/src/components/canvas/DrawingController.tsx`�?�??
- Canvas�?Paper 反序�??�??�?�强�?�对�?�?�?��??走代�?�?避�?�跨�??空�?��?`frontend/src/services/paperSaveService.ts`�?�??
- Flow�?Image �??�?��?��?�??�?�?��?��?�板�?��??�?��?�?��?��?�?�?��?��??�?源�?�?��?�?��?��?��?�?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- AI 对话�?�?对话�?�??容�?�右�?�恢复为浏�?�?��?认�?�?�?不�?��?示�?��?�?�?�?�?`frontend/src/components/chat/AIChatDialog.tsx`�?�??
- AI 对话�?�?�??�?�模式�??�?��??�?��?�禁�?�不可�?�项�?�?�?��??�?�提示不�?��?��??�?��??�?��?�并�?��?��??�?? Auto�?`frontend/src/components/chat/AIChatDialog.tsx`�?�??
- AI 对话�?�?�?��?/�?�?�?�源�?�为�?�? URL �?��?�??�?�传�?端�?不�?�序�??�??�?base64�?`frontend/src/stores/aiChatStore.ts`�?�??
- Flow�?Image Split �??�?�运�?�?�使�??`canvas/flow-asset`�?Split �?�不�?�强�?��?�?OSS�?�?保�?�?��??�? `frontend/src/services/flowSaveService.ts` �?��?�补传并�? `inputImageUrl` �?�换为�?�?URL/OSS key�?�?��?�??仍为 `inputImageUrl + splitRects`�?Worker 侧计�?�?��?主线�?峰�?��??
- 设计 JSON�?`Project.contentJson` / `PublicTemplate.templateData` 强�?�禁�?`data:`/`blob:`/base64 �?��??�?�?�?DB/OSS�?�?端�?�?+ 提�?�?��?�修复�??�?��?�??
- �?�?AI�?`POST /api/ai/generate-image` 不�?��?�?? base64 `imageData`�?�?�为�?�?OSS 并�?�??`imageUrl`�?�?��?Flow/AI Chat �?�?�已�??�?��?�??
- AI Chat�?并�?�?��??�??�?��?X2/X4/X8�?并�?�?�?�提�?�?�?10�?并�?��?��??�? `VITE_AI_IMAGE_PARALLEL_CONCURRENCY` �?�置�?-10�?�??
- Flow�?�?��??�??�?��?�?�以�?�? URL/OSS key 为主�?Camera/Three/ImageGrid/VideoFrameExtract �?不�?��?��?�?? base64/缩�?��??`flow-asset:`�?�?运�?�?��?�许临�?��?�?��?�?保�?�?��?�?`content.flow` �?�??�?�?��??校�?补传�?�换�?避�?�落�?�??
- 保�?�?�?�?��?��?传�?��??�?�不�?��?��?�?端保�?�?�?�为提示�??�?丢失�?��?并�?�保�? payload 中�?�离�?��?��?��??�?�?��?�?��?面板对�?��?传�?��??�??�?并�?��?��?��?�?传�??
- Canvas�?�?�?�?��??�?�?��??�?��?remote URL / `/api/assets/proxy` / OSS key / �?�对路�?�?�?并�? `<img>`/Paper.js Raster �??�?示源�?�?�?�口�??`frontend/src/utils/imageSource.ts`�?`toRenderableImageSrc`�?�`isPersistableImageRef`�?�`normalizePersistableImageRef`�?�`resolveImageToBlob/DataUrl`�?�??
- Canvas�?�?��?��?传�?��?`blob:` �?�?�?�??�?�??�?��? OSS `key`�?��?台�?传�?�?��??�?�??�? `tanva:upgradeImageSource` �?�??�?�?�?�?�并�??�??`ObjectURL`�?�??
- �?�端 UI�?�?��?�?��?/缩�?��?��?�?示�?�?�?`SmartImage`/`useNonBase64ImageSrc`�?�? `data:image/*`/�?base64 渲�??�?�?转换�?`blob:`�?objectURL�?�??�?`canvas`�?�?��?大�?符串驻�??�?�??�?峰�?��??
- �?�端�?�?认禁�??`/api/assets/proxy` �?�?��?源代�?�?�?�为�?��? OSS/CDN�?`VITE_ASSET_PUBLIC_BASE_URL` �?��?�?`projects/...` �?key�?�??要代�?�?��?�式设置 `VITE_PROXY_ASSETS=true`�?�??
- �?�端�?�?�?�?��??�?��?�?��?传�?�?�?传�?��??�?离�?页面/�??换项�?�?�??�?��?��?�?�弹�?�确认提示�?�?�??`beforeunload` �?浏�?�?��?��?�?�??�?�??
- �?空�?��?�?�?��?undo/redo �??史并�?�?�?�贴�?�?��?��?�?�?避�?��?空�?仍被�?�快�?��?�?�导�?��??�?不�?��??
- �?端�?�?�?�?��?可�??�? `CORS_DEV_ALLOW_ALL` �?��?跨�??并忽�??`CORS_ORIGIN`�??
- �?端�?�?��??`CORS_ORIGIN=*` �?��?�??�??来源�?�?建议�?��??�?�?�?�??
- �?�端 AI�?`aiImageService` �?�?使�?�?`fetchWithAuth` 请�?�?确保工�?��??�?��?�??�??API 注�?��?��?头并复�?��?��?��?��?�?`frontend/src/services/aiImageService.ts`�?�??
- �?�端�?�?请�?�?�?��?��?�口�?�?`fetchWithAuth`�?�?�?�?��?�?401/403 �??�?��?��?�?并为�?��?/第�?�?�请�?提�?`auth: "omit"` �?`credentials` �?��?��?`frontend/src/services/authFetch.ts` �?�?�??
- �?�?AI�?Seedance�?doubao�?�?�?任�?��?��??�?�?��?��?传�??OSS�?�?�?�??�?��?? OSS �?��?�?��?��?避�?��?�?TOS �?��?��??CORS/�?�??�?��?�??

### Fixed
- Flow Image 节点：修复“上传失败后刷新出现幽灵图”。上传失败时会回滚预分配但未落地�?`imageUrl(key)`，避免把不存在的 OSS key 持久化；同时�?`uploading=true` 且携带图片数据的节点视为不可持久化，阻止自动保存在上传未完成时写入不稳定引用（`frontend/src/components/flow/nodes/ImageNode.tsx`, `frontend/src/utils/projectContentValidation.ts`）�?
- Flow：`Image Split` 读取 `seedream5` 上游时补�?`imageUrls/images` 兜底，并将分割加载源改为“强制代理优先、直连回退”候选策略，修复 Seedream 外链图在分割节点报“图片加载失败”（`frontend/src/components/flow/nodes/ImageSplitNode.tsx`）�?
- Flow：`Analysis` 节点输入解析改为多候选回退（`imageData/imageUrl/outputImage/thumbnail`）并在裁切链路支持多 baseRef 尝试；同�?`resolveImageToDataUrl/resolveImageToBlob` 对白名单远程 URL 增加“强�?`/api/assets/proxy`”候选兜底，修复线上偶发 `图片加载失败/缺少图片输入`（`frontend/src/components/flow/nodes/AnalyzeNode.tsx`, `frontend/src/utils/imageSource.ts`）�?
- Flow：`Image Split` 切片缩略图预览增加“代理优�?+ 原地址回退”加载策略，移除跨域 `anonymous` 的硬依赖，并允许缺失 `sourceWidth/sourceHeight` 时按天然尺寸回退渲染，修复“已分割但缩略图全灰块”（`frontend/src/components/flow/nodes/ImageSplitNode.tsx`）�?
- Canvas：重做图片裁切执行链路并修复偶发“像被压�?低清/裁切不可用”。`ImageContainer` 裁切改为按实时源解析 Blob 后再裁切（不依赖缓存 dataURL 输入），本地预览�?`blob:` + 后台上传回写远程引用；裁切开始即预分配新 OSS key 并清理上传中�?`remoteUrl`，避免回写竞争把图切回旧源；同时回写尺寸改为�?X/Y 独立缩放，`imageUrlCache` 新增图片源指纹命中策略，避免同一 `imageId` 更换源图后误用旧缓存（`frontend/src/components/canvas/ImageContainer.tsx`, `frontend/src/components/canvas/DrawingController.tsx`, `frontend/src/services/imageUrlCache.ts`）�?
- Flow：`Generate` 节点顶部输入缩略图现在会识别 `Image/ImagePro` �?`crop` 以及 `ImageSplit(splitRects)`，按裁切区域预览，避免视觉上误判为“传的是整图”；运行时传参逻辑保持按裁切结果处理（`frontend/src/components/flow/nodes/GenerateNode.tsx`, `frontend/src/components/flow/FlowOverlay.tsx`）�?
- Flow：`Generate` 节点读取连线输入预览时改为优先使�?`imageData/inputImage`（运行时资源）再回退 `imageUrl/inputImageUrl`，修复“已连线时上�?替换图片后缩略图不立即更新”的问题（`frontend/src/components/flow/nodes/GenerateNode.tsx`）�?
- Canvas/LayerPanel: canvas selection now back-syncs to layer panel highlight for image/model/path, with auto-expand/activate of the owning layer (`frontend/src/components/panels/LayerPanel.tsx`, `frontend/src/components/canvas/DrawingController.tsx`).
- Flow/TextNote: 非编辑态下文本便签中心区域恢复可直接拖拽移动（不再仅边缘可拖），仅双击进入编辑态（`frontend/src/components/flow/nodes/TextNoteNode.tsx`）�?
- Flow/TextNote: 文本便签四边连接句柄改为默认隐藏且不可交互（不再自动弹出可连接节点面板），并将便签背景统一为淡土黄色（`frontend/src/components/flow/nodes/TextNoteNode.tsx`）�?
- Payment: 修复支付宝充值回调空实现导致的漏入账；新增回调体解析、主动查询核对、手动确认补单与过期订单清理，降低“第三方已支付但前端/积分未更新”风险�?
- 2D�?D�?修复混�??submit �?�?��?�容�?�?�??使�??`ImageUrl` �?符串并�?�?��?�?payload �??�??�?避�??`Code:1001 Invalid param`�?`backend/src/ai/services/convert-2d-to-3d.service.ts`�?�??
- 2D�?D�?�?�?��??工�?�栏�??�??D�?D�?��?端�?�?��??换为混�??�??D�?submit/query 轮询�?�?保�?��??�??�?�端交�?�?�?��?D�?�?�?�流�?不�?�?�?�?模�??�??�?�来源�?�换为混�??�?�口�?`backend/src/ai/services/convert-2d-to-3d.service.ts`�?�??
- 2D�?D�?修复混�??�?�??模�??�?��?�板 3D 容�?�中�?�载失败�?CORS�?�?��?�?`Model3DViewer` 对�?�?模�??URL 强�?��?`/api/assets/proxy`�?�?��?端代�?�?�名�?�?��?�?��?COS �??名�?`q-sign-*` �?签名�?�?��?�?��?`frontend/src/components/canvas/Model3DViewer.tsx`�?�`frontend/src/utils/assetProxy.ts`�?�`backend/src/oss/oss.service.ts`�?�??
- 2D�?D�?�?端模�??URL 提�?�?�为�??�??格式�?�??级�??�?��?��?�?�?? `glb/gltf`�?`zip` �??�?�?�?�?��?�?�??�??缩�??�?��?导�?��??�?�端模�??�?�载�?常�?`backend/src/ai/services/convert-2d-to-3d.service.ts`�?�??
- Flow�?恢�?`klingVideo` �??史�?线�??`targetHandle=audio` �?�容句�??�?修复�?�项�?��?�载�?��?�?React Flow `error#008`�?`frontend/src/components/flow/nodes/GenericVideoNode.tsx`�?�??
- Canvas 保�?�?`paperSaveService` �??Paper �?�就绪�?�不�?��?�?? `paperJson`�?避�?��?常�?��?�?�板�??容�??空快�?��?��??�??并�?��?��?��??丢失�?`frontend/src/services/paperSaveService.ts`�?�??
- 3D 模�??�?载�?�?�?模�??�?��?��?载�?��?�?强�?��?`/api/assets/proxy`�?修复混�??�?��?COS `q-sign-*` �?��?��?载�??CORS 失败�?`frontend/src/utils/downloadHelper.ts`�?�??
- AI 对话�?�?修复 AUTO 模式工�?��??�?��?��?��?�卡�?��??�?��??中�?��?��?�?Banana 工�?��??�?��?�?�?20s �?�?��?快�??�??�?�?�?�?�?`tool-selection` �?�?走�??�?�模�??解�?��?�路�?`backend/src/ai/providers/banana.provider.ts`�?�`backend/src/ai/ai.controller.ts`�?�??
- AI edit-image: stop auto-retrying on `NETWORK_ERROR` for long-running edit requests, preventing repeated long waits and duplicate retry calls after downstream/proxy connection close; also accept `imageUrl` as a valid success result in edit API mapping (`frontend/src/services/aiBackendAPI.ts`, `frontend/src/services/aiImageService.ts`).
- Canvas: fix refresh-time false image lock that made some images non-draggable/non-deletable; recovery now trusts explicit imageLocked/snapshot.locked only, and Delete gets an imageId-based fallback path (frontend/src/components/canvas/DrawingController.tsx, frontend/src/components/canvas/hooks/useImageTool.ts, frontend/src/components/canvas/hooks/useInteractionController.ts).
- Flow�?恢复�?线�??�?��?��??�?+ Delete �?��?��?��?为�?修复 `pointer/marquee/select` �?�?线�?��?�被误�?�为空�?��?�??起�?��?并�?��?�?线�?��?��?�式�??中�?Delete/Backspace �?��?�已�??�?线�??�??�?�?��?�?`frontend/src/components/flow/FlowOverlay.tsx`�?�??
- Referral�?�??请码�?��??请�?�?�达�??10 人�?继续可�?�并继续记�?�??请�?�系�?�?�?止�?��?�??请积�??�?�?��?�?不�?��?�??�??已达�?�??�?��??�?�类�?�?�提示�?`backend/src/referral/referral.service.ts`�?�??
- Backend�?�?��??Kling �?�?�??�?�对�?�??�?�?�??模�??�??换�?kling-v2-1�?�?��?Kling 2.6 / Kling O3 �?��?保�?�不�?�?backend/src/ai/services/video-provider.service.ts�?�??
- Flow�?�??�?�弹�?�?��?�?��?端�??�?��?�置�?��?�?�为�??�?�?�??�?�??Flow �??�?�类�??�?��?�并�?�??使�?��?端�?�据�?避�?��?�端 fallback �?�?端�?�置叠�?��?�?��?��?�复�??Kling �??�?��?frontend/src/components/flow/FlowOverlay.tsx�?�??
- Flow�?�?��??Kling 2.6 �??�?��?�口�?不�?��?��??�?�弹�?�?快�??�?�?��?�?中�?�示�?�?�端�?认�??�?��?�置�?�?步移�?�该项�?frontend/src/components/flow/FlowOverlay.tsx�?�frontend/src/services/nodeConfigService.ts�?�??
- Flow�?修复�??�?�弹�?�?Kling 系�??�?�置名�?�正确�?��?�??Flow �??�?�类�??�?��?�?��?��?�?��??�?��??建�??�?��?�?�?��? Kling / Kling 2.6 / Kling O1 / Kling O3 �?�名�?�容�?frontend/src/components/flow/FlowOverlay.tsx�?�??
- Flow�?修�?`Seedream` �??�?�左�?`image` �?�?�句�??被容�?�校�?�??误�?��?��?�?�可正常�?�?��?��??�?�?�句�??�?`frontend/src/components/flow/FlowOverlay.tsx`�?�??
- Flow�?修�?`Seedream` �??�?�中�??�??�?乱码�?帮�?�说�??�?��??�?�提示�?��?�?�?��?尺寸�?�??�?签�?�?并�?尺寸�?签�??�??�?�?�?ASCII �??�?��?避�?��?常�?符�?�示�?`frontend/src/components/flow/nodes/Seedream5Node.tsx`�?�??
- Flow�?�?�??�?页�?��?�?�项�?��?��?�??�?��?屏缩�?��?��?��??viewport �?步修正�?`frontend/src/components/flow/FlowOverlay.tsx`�?�??
- Canvas�?�?�??�?页�?��?�?�项�?��?�?Paper �?��??�?�中/�??�?�偶�?失�??�??恢复�?��?�?`frontend/src/components/canvas/DrawingController.tsx`�?�`frontend/src/utils/paperCoords.ts`�?�??
- Flow�?�??�?��?�路�?�许传�??�?�?URL�?�?��?端�?载�?�?�?�?避�?�端跨�??读�?失败�?`frontend/src/components/flow/FlowOverlay.tsx`�?�`backend/src/ai/ai.controller.ts`�?�`backend/src/ai/dto/image-generation.dto.ts`�?�??
- AI 对话�?�?�?��?�?�混�?来源�?��??�??�?传�?��?��?源�?��?�?�?URL�?避�??CORS �?base64 序�??�??失败�?`frontend/src/stores/aiChatStore.ts`�?�??
- Flow�?Generate �?�?�解�?��?�??使�?�?Image �??�?��?�?�渲�??�?�据�?并�??proxy �??�?失败�?�使�?�带�?��?�??�?�?`frontend/src/components/flow/FlowOverlay.tsx`�?�??
- Flow�?MiniMap 即�?��?�示�?��??占位�?导�?��?�?�即触�?�?�建并�?�导�?��?��?��?��??�?触�?�?`frontend/src/services/paperSaveService.ts`�?�`frontend/src/components/canvas/DrawingController.tsx`�?�??
- Flow�?�?��?��? MiniMap �?��??占位不�?�示�??�?��?�?反序�??�??�?�?�即触�?�?�建�?件�?并�?��?�建失败�?��??�??�?�快�?�种子�??�?`frontend/src/services/paperSaveService.ts`�?�`frontend/src/components/canvas/DrawingController.tsx`�?�`frontend/src/components/canvas/hooks/useImageTool.ts`�?�??
- Flow�?MiniMap �?��??/�??�?��?�?�?��?��?��?可即�?��?��?��?�?�为�?件驱�?�并保�??1s �??�?轮询�?`frontend/src/components/flow/MiniMapImageOverlay.tsx`�?�`frontend/src/components/canvas/DrawingController.tsx`�?�??
- Flow�?MiniMap 不�?��?��??�?��?��?�??�?��?��?��?��?保�?��?�续可见�?`frontend/src/components/flow/FlowOverlay.tsx`�?�??
- Flow�?修复�?��??�??�?�裁�?��?�?尺寸读�?�?�?��?缩�?�影�?��?导�?��?��?��?�?�?被�?�大�?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- Worker �?��??�?传�?主线�?�?�传 access token�?OSS presign 请�?携带 Authorization�?避�?�跨�?401�?`frontend/src/services/imageUploadWorkerClient.ts`�?�`frontend/src/workers/imageUploadWorker.ts`�?�`frontend/src/services/ossUploadService.ts`�?�??
- �?�端�?��?�?`fetchWithAuth` �?�?�?Authorization 为空�?�注�??access token�?避�?�空�?��?��?�注�?��?`frontend/src/services/authFetch.ts`�?�??
- Worker �?��??�??�?��?�??�?主线�?�?�传 access token 并�?�?Worker 请�?中补�?Authorization�?避�?�跨�?�?源�??�?401�?`frontend/src/services/imageSplitWorkerClient.ts`�?�`frontend/src/workers/imageSplitWorker.ts`�?�??
- �?�端 AI�?`aiImageService` �?��?��?话�?�补�??`refresh_token` Authorization 头�?避�?�跨�?�?依�?cookie 导�?�?401�?`frontend/src/services/aiImageService.ts`�?�??
- AI 对话�?�?�??中�??�?��?�右�?��?�许浏�?�?��?认�?�?�?确保可复�?��??中�??�?��?`frontend/src/components/chat/AIChatDialog.tsx`�?�??
- Flow�?Image �??�?��?�?��?��?�板�?�以�?�?�渲�??�?源为�??�?�?`crop`/ImageSplit �?�?裁�?��?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- Flow�?Image �??�?��?��?�?游�?�?��?��?保�??�?�?�裁�?�渲�??�?��?��?避�?��??�??�?��?��?��?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- Flow�?Image �??�?�裁�?��?�?�?�为�?�??�?�容�?��?�?�?中�?�示�?避�?��??�?��??�??�??�?�?尺寸�?常�?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- Flow�?Image �??�?�裁�?��?�?使�?��??�?裁�?��??辨�??�?�?�并缩�?��?示�?避�?��?�?保�?�?��??辨�??�?小�?模�?�?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- Flow�?Image �??�?�可�??�?解�?��?�?Image �?�路中�??裁�?�信息�?避�?��?��?�路�??�??�?��??�?�?��?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- Flow�?ImageSplit �??�? Image �?�路�?�?��?��??�?解�?��?游裁�?�信息�?避�?��??�??�?��??�?��?`frontend/src/components/flow/nodes/ImageSplitNode.tsx`�?�??
- Flow�?ImageSplit �?��?�裁�?��?�?? Image �??�?��?�?��?�可�??溯�?游解�?�?baseRef�?确保�??裁�?��?�??�??�?��??�?�??�?��?`frontend/src/components/flow/nodes/ImageSplitNode.tsx`�?�??
- Flow�?ImageSplit �?�?��?�?�?��?游为裁�?��?�路�?��?�??�?�示裁�?��?�?并�?�?临�?��?�?��??�?好�?避�?��??�?�示�?��?��?跳�?�?`frontend/src/components/flow/nodes/ImageSplitNode.tsx`�?�??
- Flow�?Image �??�?��??换�?�?��?线�?��?�?�?�?crop�?避�?�复�?��?�裁�?��?�??�?`frontend/src/components/flow/FlowOverlay.tsx`�?�??
- Flow�?Image �??�?��?�?游读�?�?��??�?��?�??�?�?��?线�?避�?��?游�?��?��?�?游不�?��?��?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- Flow�?Image �??�?��?�?��?��?�板�?��?�??`crop`�?�?�?�裁�?��?�??�??�?�??�?��?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- Flow�?Analysis �??�?��?��?�?�?��?线�?��?�?�?�??�?��??�?�据�?避�?��?�?仍�?�示�?��?��?`frontend/src/components/flow/nodes/AnalyzeNode.tsx`�?�??
- Flow�?Analysis �??�?��??Image�??Image�??Analysis �?�路中可�??�?�?�?��?�?`crop`/`ImageSplit`�?避�?��??�??�?��?��?��?`frontend/src/components/flow/nodes/AnalyzeNode.tsx`�?�??
- Flow�?Analysis �??�?��?��?�?Image �?�?�?示�?��?继续�??溯�?��?�?�来渲�??�?�?�?避�?��?��?空�?��?`frontend/src/components/flow/nodes/AnalyzeNode.tsx`�?�??
- Flow�?Image �??�?��?��?�?��?��?�?Image/ImagePro �?��?�?�??使�?�源�??�?��?�身�?��??并�?��?�读�?�??`crop` �?裁�?��?�?�?避�?��?�路传�??�?�?��??空�?��??�??�??�?��?��?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- Flow�?ImageSplit �??�?�?Image �??�?��?��?�??使�??`inputImageUrl/inputImage` �?为�?��?�?�?��?误�?��?游缩�?��?�导�?��??�?�?�度�?�?��?`frontend/src/components/flow/nodes/ImageSplitNode.tsx`�?�??
- Flow�?ImageGrid 读�? Image/ImagePro �??�?��?��?�??�?�??`crop`�?避�?��?游仍使�?��?��?��?`frontend/src/components/flow/nodes/ImageGridNode.tsx`�?�??
- 项�?��??容�?�载�?�?�端对�?项�??`GET /api/projects/:id/content` �?并�?�?��?��?�?�?OSS �?��?��?禁�?��?�跳�?读�??并设置�?�?��?�?��?�?�复�?载�?�?��?��?�卡顿�??
- �?�?AI�?工�?��??�?��?��?解�?��?�稳健�?�?��?��?��?�?�??�?�?markdown code fence/尾�?��??�?松�?�?key:value/�?�??�?�提�?工�?�名�?�?避�?�误�?�级�?�?chatResponse�?`backend/src/ai/tool-selection-json.util.ts`�?�??
- AI 对话�?�?工�?��??�?��?�段�??�?示�??正�?��?��??�?..�?�占位提示�?并复�?��?次工�?��??�?��?�??避�?��?�复请�?�?`frontend/src/stores/aiChatStore.ts`�?�??
- AI �?��??�?�?�?`generate-image` 对�??空�??�?�?格式�?��?��?��?�?次请�?�??�?��?��?��?�?�??�?3 次�?�?并�?空�??�?�?格式�?�?�?�?502�?BadGateway�?�?�?�端保�??�??�?�?��?�?�?��?对话�? X4 模式偶�?只�??�??3 张�??�?��?�?`backend/src/ai/ai.controller.ts`�?�`frontend/src/services/aiBackendAPI.ts`�?�??
- Assets Proxy�?`GET /api/assets/proxy` �?�?��?��?�?�?�主�?�?cancel �?�?个�?��?�?�?客�?�端中�?��??abort �?�?fetch 并�?�?��?�?流�?避�??`ReadableStream is locked` �?��??�?�?��?�?�?�?��??代�?�?�??�??�?�?�?�占�?��??
- Flow�?Analyze/�?�??�?��??�?�?�?�?��??�?�使�??`credentials: omit`�?避�?�跨�??�?�署�? `/api/assets/proxy` �??`Access-Control-Allow-Origin=*` �?`credentials: include` �?�突导�?�浏�?�?��?��?��?`frontend/src/components/flow/nodes/AnalyzeNode.tsx`�?�`frontend/src/components/flow/FlowOverlay.tsx`�?�??
- �?�端�?��??转码�?�?��?�?��?并�?�?�流�?�??�?10�?�?�?�口�?��??�??�?�?转�??�?`canvas.toDataURL/toBlob`�?�`FileReader.readAsDataURL`�?�`Response.blob`�?�`createImageBitmap/WebCodecs` �?�?并�?�?AI Chat/Flow/�?��?�?�?�路复�?��?�?��?�?�?��?��?��?��?��??�?峰�?��?卡顿�??
- �?��?��?`AutoScreenshotService` �?�?�?Raster �?��?�?��??确�?跨�??�?�?�设�?crossOrigin�?��?��?��?��?�载�?��??�?避�?��?�?`/api/assets/proxy` �?源被�?�复请�?导�?��??�?�口�?�屏�?�??�?�??�?��??
- Canvas�?保�?`paperJson` �?��? `*/api/assets/proxy?...` 反解�?remote URL/OSS key�?避�?��?? `http://localhost:5173/...` �?运�?�?�代�?�?��?落�?�??
- Canvas�?修复反序�??�??�? `Raster.source` �?�?`<img>.src` 导�?�?OSS key/�?�?�?�?��?�被正确�?�?��?代�?�?�?��?��?��??空�?��?`frontend/src/services/paperSaveService.ts`�?�??
- 保�?�?�?端保�?�?��?额�?�?�?`aiChatSessions`/`assets.images` 中�?�??�?? `data:`/`blob:`/�?base64�?�?`localDataUrl/dataUrl/previewDataUrl`�?�`imageData/thumbnail` �?�?�?避�?��??�?��??�?空�?仍携�?dataURL�?�导�??payload �?大�??落�?污�??�??
- Flow�?Image Split �??�?��?�?��?�??�??�?��??�?��?�不�?�置灰�?�?��?��?��? `splitRects` �??�?�?Image �??�?�并�?�?Image �??�?�运�?�?�裁�?��?�?�?不落�?�?�??
- Flow�?Image Split �??�?��??Image �??�?�裁�?��?�?�?�右�?�保�?导�?��?�不�?��??�?contain �??�?��?�边�?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- Flow�?Image Split �?�置恢复为�??�?�?�端口�?��??1-50)�?�语�?�?�?格�??�??�??端口�?��?��?��?�导�?�?�?2048x2048 �?512x512 �??�??可设 `16`�?�?`frontend/src/components/flow/nodes/ImageSplitNode.tsx`�?�??
- Flow�?Image Split�?Worker �?格�??�??�?不�?�对�??�??�?�??�?��?�边裁�??�?��?并保证�?�?��?��?�严格�?�?端口�?��?避�?��??�??尺寸被裁�?�?��?��?移�?`frontend/src/workers/imageSplitWorker.ts`�?�`frontend/src/components/flow/nodes/ImageSplitNode.tsx`�?�??
- Flow�?Analysis �??�?��?��?�解�?�?Image Split / Image(crop) �??裁�??�?�?��?�?�?��??�?��?�口�?��?�?�?��??�??�?��?�??�?�?��?��?�?并保�?��??�??�??辨�??�?尺寸正确�?`frontend/src/components/flow/nodes/AnalyzeNode.tsx`�?�`frontend/src/components/flow/nodes/ImageSplitNode.tsx`�?�??
- Flow�?修�?Image Split �??�??�?��?游裁�??�?��?�?�误�??解码�?�?�素尺寸导�?��?导�?�只�?�载�?�缩�?��?��?��??辨�??被�??缩�?�?�? 2048->400 �?1024 �??�??�?200�?�?并�?��?边�?�?�边�?�??�?`frontend/src/components/flow/FlowOverlay.tsx`�?�`frontend/src/components/flow/nodes/ImageGridNode.tsx`�?�??
- Flow�?�?�?�??�?��?�??�?��??�?线解�?��?�?��?�?Image Split �??�??�?为�?�?��??
- Flow�?Image Split �??�?��??Image �??�?��?`crop`�?�?��?游运�?�?��??裁�??�?�??传�?�?避�?�仍使�?��?�?��??�?��??
- Canvas�?修复�? OSS key/proxy/path 误�?��?base64/�?�?传导�?��?��??置灰�??�?��?�?含快�??�?传�?�导�?��?�建�?�?�?��?�?缩�?��?��?�?载�?�路�?�??
- Canvas�?AI �?��??占位符�?级为�?�? URL �?��??�?�?�载�?��??换�?避�?��?��?�?��??�??�?��?��??�?��??
- Canvas�?�?��??�?级�??�?`Raster.source` �?�?即恢�?`bounds`/�??�?��??素�?避�??Paper.js �?��??�?�置尺寸导�?��??�?��?��??
- Canvas�?�?传中�?��??�?�许�??�?�移�?��?�?禁�?��?�?/�?�?�?�?��?�?避�?�误触�?�??
- Canvas�?修复误�?`HTMLImageElement` 传�? `Raster.source` 导�?��?�?�?`[object HTMLImageElement]`�?�?传�?�?��?�?��??�?�载失败/�?失�?`frontend/src/components/canvas/PaperCanvasManager.tsx`�?�`frontend/src/components/canvas/hooks/useQuickImageUpload.ts`�?�`frontend/src/components/canvas/DrawingController.tsx`�?�??
- Canvas�?修复�?传�?��??�?�?��?�??`ObjectURL` 误�?��?�使�?�被提�?��??�?��?导�?��?��??�?失�?��?��?��?�?�恢复�?�示�??�?��?�?`frontend/src/services/paperSaveService.ts`�?�`frontend/src/components/canvas/DrawingController.tsx`�?�??
- �?�端�?��?�?补齐�?��??�?��?请�?�?�触�?�?��?��??�?��??�?��?�?�?�?�??`fetchWithAuth`/`triggerAuthExpired` �?�? 401/403�?并�?��?��?失�??�?��?�?�?��?��?话�?�?�?`frontend/src/services/authEvents.ts`�?�`frontend/src/services/authFetch.ts`�?�??
- �?�端�?��?�?`fetchWithAuth` �??refresh �?�??�?��??�?�?��?�?401/403 �?��?�?触�?`triggerAuthExpired`�?避�?��?��?��?��?401 �?�?�跳转�?��?�??�?��?�?`frontend/src/services/authFetch.ts`�?�??
- Flow�?禁�?��??�?��??�?��?��??�?��?�平移�?`autoPanOnNodeDrag`�?�?并�?�?`dragStop` 强�?��??�?步�?口�?避�?�快�??�??�?��??�?��?��?口�?移导�?��?��?�??�?��?��?偏移�??
- Flow�?�?维�??�?��?`ThreeNode`�?�?传模�??�?�?��?��?中�?��?��?并�?模�??URL �?��?�??为�?�?�?�?��?避�?��??�?resize �?模�??丢失�??
- Flow�?�?维�??�?��?`ThreeNode`�?�?��??�?�?resize �??canvas 保�?��?�满�?�??�?��?�?中不�?�?`setSize` 避�?��?��?��?�??�?��?�?�?�?次�?��?�?renderer 并即�?�渲�??�??
- Flow�?修复�?��??�??�?�渲�??�?�?`uploading/uploadError` �?��?�?导�?��??�?�屏崩�?�?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- 项�?��?�?��?�?�??�??�??访�?�项�?��?��?�??�??项�?�不�?�?��?��?404�?�?触�?�?�端�?�?�?��?? `projectId` �??容�??�?��?�?避�?�误�?��?��?失�??�?`backend/src/projects/projects.service.ts`�?�??
- Flow�?模板导�??保�?�?��?��?`flow-asset:`/`blob:`/OSS key/`/api/assets/proxy?...` �?�?��??�?�?��?�?�??为可�?��?�??�?�?��?并�??Image Split 模板中迁�?`splitImages` -> `splitRects`�?避�?��?��?�模板�?��??缺失�?`frontend/src/components/flow/FlowOverlay.tsx`�?�??

## [0.1.0] - 2026-01-14
### Added
- Initial knowledge base scaffold: `project.md`, `wiki/*`, `history/index.md`, `plan/`.

## [Stability Note - 2026-03-20]
- Added frontend runtime stability bootstrap with storage schema guard, build version polling, and global runtime error capture/reporting.
- Added backend telemetry endpoint POST /api/telemetry/frontend-error for collecting frontend runtime failures.
- Hardened deployment cache behavior for index.html and version.json, and aligned frontend builder dependency installation.
- Kept autosave debounce at 5 seconds and added a minimum persisted save interval (15s) to reduce high-frequency write pressure.
- Added backend per-project serialized save execution and duplicate-content hash short-circuit to reduce save write amplification under concurrency.



- Added Object.hasOwn polyfill during frontend bootstrap to avoid white-screen crashes on legacy Edge builds.


- Flow: added `threePathTracer` node entry (3D PathTracer) and integrated optional `three-gpu-pathtracer` mode in `ThreeNode` with raster fallback on init/render errors.
- Flow: `ThreeNode` ? changing BG / light sliders no longer disposes the whole WebGL context; PathTracer load gap falls back to a raster frame (`requestRender`).
- Flow: quick-connect pins base targets first (`textPrompt` for text, `image` for image) while keeping usage-based ranking for the rest (`FlowOverlay.tsx`).


- 3D canvas interaction tuning for Mac trackpads: reduced OrbitControls rotate/zoom/pan sensitivity, lowered Model3DViewer max DPR to 1.25, and slowed camera-state sync frequency to reduce zoom overshoot and interaction stutter (frontend/src/components/canvas/Model3DViewer.tsx).

- Model3D canvas performance alignment with ThreeNode: switched Model3DViewer to demand-driven rendering (`frameloop="demand"`), removed always-on preserveDrawingBuffer, capped DPR at 1, and changed model move/resize persistence to commit only once at transform end to avoid per-frame history/autosave stalls (`frontend/src/components/canvas/Model3DViewer.tsx`, `frontend/src/components/canvas/Model3DContainer.tsx`, `frontend/src/components/canvas/hooks/useModel3DTool.ts`, `frontend/src/components/canvas/DrawingController.tsx`).

- Model3D drag/resize now uses local preview updates during pointer move and commits to Paper/state/history only on pointer-up, reducing whole-canvas jank during transform (`frontend/src/components/canvas/Model3DContainer.tsx`, `frontend/src/components/canvas/hooks/useModel3DTool.ts`, `frontend/src/components/canvas/DrawingController.tsx`).

## [Stability Note - 2026-03-21]
- Backend: reduced `/api/ai/text-chat` 500s under DB pressure by hardening credits scheduler and Prisma pool handling.
- Added non-overlap locks for credits cron jobs to avoid concurrent job pile-ups.
- Moved credit anomaly detection from every 5 minutes to hourly.
- Mapped Prisma connection-pool timeout (`P2024`) to `503 ServiceUnavailable` with retryable message.
- Reduced stale pending auto-refund default batch size from 200 to 100.
- Added Prisma index `ApiUsageRecord(responseStatus, serviceType, createdAt)` for stale pending scans.

- Model3D interaction smoothing follow-up: camera persistence now commits only at OrbitControls end (not during onChange), and Model3DViewer uses a lighter light rig to reduce shader cost on dense 2D->3D assets (`frontend/src/components/canvas/Model3DViewer.tsx`).

- Canvas 3D container now supports one-click conversion to Flow `three` node, auto-placing the node near the model and patching `modelUrl/modelName` for immediate loading (`frontend/src/components/canvas/Model3DContainer.tsx`, `frontend/src/components/flow/FlowOverlay.tsx`).

- ThreeNode performance guard during canvas image drag: skip non-essential Three.js renders while `tanva-canvas-dragging` is active, avoid redundant OrbitControls update loop on `change`, and trigger a single redraw on global mouseup to reduce drag-frame drops when 3D nodes are present (`frontend/src/components/flow/nodes/ThreeNode.tsx`).

- Gesture routing fix for 3D areas: global/Flow wheel-zoom capture now bypasses Flow `three` viewport and canvas `Model3DContainer`, so two-finger zoom inside 3D focuses on model controls instead of canvas zoom; plus freeze Flow 3D WebGL viewport visuals during canvas image dragging to reduce compositing overhead (`frontend/src/components/canvas/GlobalZoomCapture.tsx`, `frontend/src/components/flow/FlowOverlay.tsx`, `frontend/src/components/flow/nodes/ThreeNode.tsx`, `frontend/src/components/flow/flow.css`).

- Refined 3D zoom gesture routing with robust hit detection (`target` + `composedPath` + `elementFromPoint`) so Flow `three` node pinch/ctrl-wheel no longer falls through to canvas zoom when event targets are retargeted by browser/input drivers (`frontend/src/components/canvas/GlobalZoomCapture.tsx`, `frontend/src/components/flow/FlowOverlay.tsx`).

- Canvas image-drag optimization for in-canvas 3D containers: add dedicated `tanva-image-dragging` state, suspend `Model3DViewer` rendering while image drag is active, and temporarily disable pointer events/visual updates for canvas 3D overlays to reduce drag jank (aligned with Flow ThreeNode freeze strategy) (`frontend/src/components/canvas/DrawingController.tsx`, `frontend/src/components/canvas/Model3DContainer.tsx`, `frontend/src/components/canvas/Model3DViewer.tsx`, `frontend/src/index.css`).

- Reduced canvas drag rerenders around in-canvas 3D: memoized `Model3DContainer` and `Model3DViewer` with structural prop comparators (ignoring callback identity churn), plus `contain: layout paint` on container root so image/model drags do not repeatedly re-render 3D viewers when bounds/model data are unchanged (`frontend/src/components/canvas/Model3DContainer.tsx`, `frontend/src/components/canvas/Model3DViewer.tsx`).

- Restored previous in-canvas 3D interaction chrome visibility (corner handles/border no longer clipped) by removing container paint containment, while keeping 3D content render suspended during model move/resize (`frontend/src/components/canvas/Model3DContainer.tsx`, `frontend/src/components/canvas/Model3DViewer.tsx`).

- Drag UX/perf refinement for canvas 3D containers: when render is suspended (image drag or model move/resize), keep a visible static frame snapshot instead of blank viewport, and reduce per-move state churn by avoiding `realTimeBounds` state writes on every move tick (final bounds still committed on mouseup) (`frontend/src/components/canvas/Model3DViewer.tsx`, `frontend/src/components/canvas/Model3DContainer.tsx`, `frontend/src/index.css`).
- Canvas 3D container resize/drag performance follow-up: `Model3DContainer` now subscribes only to `zoom/panX/panY` (instead of the full canvas store) to avoid unrelated high-frequency rerenders during image drag; `Model3DViewer` drops unused `width/height` props from memo comparison so resizing the 3D container no longer forces per-tick viewer rerenders, and suspended-frame snapshots are now reusable across drag/resize cycles (with tainted-canvas capture guarded) to reduce start-of-drag stutter (`frontend/src/components/canvas/Model3DContainer.tsx`, `frontend/src/components/canvas/Model3DViewer.tsx`).
- Canvas 3D drag/resize visual fallback: `Model3DViewer` now pre-warms a reusable suspended frame after model load, and when frame capture is unavailable it falls back to an inline SVG thumbnail card (model name + 3D marker), so moving/resizing 3D containers no longer appears as blank while rendering is suspended for performance (`frontend/src/components/canvas/Model3DViewer.tsx`).
- Canvas 3D suspended-preview reliability fix: replaced `data:image/svg+xml` fallback with a pure DOM/CSS placeholder card (still prefers captured frame when available) to avoid blank states in environments where `data:` image sources are blocked or sanitized during drag/resize suspension (`frontend/src/components/canvas/Model3DViewer.tsx`).
- Canvas 3D camera-save and WebGL lifecycle fix: `model3d-camera` autosave/history now only schedules when camera state actually changes (deduped via current instance ref), and camera sync callbacks are muted during container move/resize/image-drag to avoid transform-induced camera saves; `Model3DViewer` now skips initial camera persistence emit and force-releases WebGL renderer/context on unmount (`forceContextLoss`) to mitigate accumulated active-context warnings (`frontend/src/components/canvas/hooks/useModel3DTool.ts`, `frontend/src/components/canvas/Model3DContainer.tsx`, `frontend/src/components/canvas/Model3DViewer.tsx`).
- Canvas 3D capture white-image fix: before camera capture, request target `Model3DViewer` to refresh and publish a cached frame; screenshot pipeline now prioritizes this cached frame (`img[data-model3d-snapshot-cache="true"]`) and only falls back to raw WebGL canvas, avoiding blank captures under `frameloop="demand"` + non-preserved drawing buffers (`frontend/src/components/canvas/Model3DViewer.tsx`, `frontend/src/components/canvas/Model3DContainer.tsx`, `frontend/src/components/canvas/DrawingController.tsx`, `frontend/src/services/AutoScreenshotService.ts`).
- Dev-console cleanup for 3D viewer teardown: avoid calling `forceContextLoss` during DEV/HMR unmount cycles, and in PROD only call it when WebGL context is not already lost (`isContextLost` guard), eliminating noisy `WebGL: INVALID_OPERATION: loseContext: context already lost` logs while retaining production context-leak protection (`frontend/src/components/canvas/Model3DViewer.tsx`).
- Canvas refresh persistence hardening for 3D containers: in `tanvaPaperRestored` flow, added explicit 3D runtime rehydrate fallback from `assets.models` when Paper project has no usable 3D groups; `rebuildFromPaper` now restores 3D bounds from placeholder path, group bounds, or `data.bounds` fallback (instead of requiring a specific child path), and `setModel3DInstances` gained structural no-op guard/clear logic to avoid unnecessary repeated updates that could contribute to React update-depth loops (`frontend/src/components/canvas/DrawingController.tsx`).
- Canvas 3D moving/resizing visual stability upgrade: `Model3DViewer` now rejects likely-blank WebGL frame captures, asynchronously pre-generates a real model preview via `model3DPreviewService`, and uses `suspendedFrame || modelPreviewFrame` as the suspended visual/cache source; this ensures drag/resize displays a model thumbnail instead of blank even when demand-render WebGL buffer capture is empty (`frontend/src/components/canvas/Model3DViewer.tsx`).
- Canvas 3D interaction policy alignment with Flow ThreeNode: moving/resizing in-canvas 3D containers no longer enters suspended-thumbnail mode; model viewport stays visible during transform while OrbitControls remains disabled during drag/resize. Suspended preview is now reserved for explicit external suspension (e.g., image-drag performance guard) (`frontend/src/components/canvas/Model3DViewer.tsx`).
- Canvas 3D/Flow ThreeNode external-drag policy update: while dragging other 2D images (`tanva-image-dragging`), both canvas 3D containers and Flow ThreeNode viewports now stay blank (no visible thumbnail fallback), while keeping hidden frame cache only for screenshot capture reliability (`frontend/src/components/canvas/Model3DViewer.tsx`, `frontend/src/components/flow/flow.css`).
- Canvas image-drag visual policy refinement: 3D containers and Flow ThreeNode now keep the current frame visible (instead of forcing blank) while other 2D images are dragged; render loops are still gated under `tanva-canvas-dragging`/`tanva-image-dragging` (including PathTracer sample loop), preserving drag FPS while avoiding abrupt blanking (`frontend/src/components/canvas/Model3DViewer.tsx`, `frontend/src/components/flow/nodes/ThreeNode.tsx`, `frontend/src/components/flow/flow.css`, `frontend/src/index.css`).
- Flow ThreeNode interaction polish: increased `NodeResizer` invisible hit area (22px) to make resize/scale handles easier to grab, removed paint containment clipping on ThreeNode root, and lifted the image output handle to a dedicated high z-layer so it stays visible above node content/resizer overlays (`frontend/src/components/flow/nodes/ThreeNode.tsx`, `frontend/src/components/flow/flow.css`).
- Canvas 3D white-capture fix: `Model3DViewer` now forces a same-camera render before capture and can fall back to an offscreen renderer for explicit camera captures; runtime snapshot payload now carries `frameDataUrl` and source tag, while `AutoScreenshotService` only consumes runtime snapshots and skips near-blank WebGL fallback frames to avoid inserting white rectangles.

## [Credits Patch - 2026-03-21]
### Changed
- Backend credits now apply `resolutionPricing` to any service that defines this pricing block (not only `*-image` service types).
- Seedream 5.0 (`doubao-seedream-5-0-260128`) now correctly deducts 60 credits when `imageSize=4K`.
- Added 4K pricing for Pro and Nano banana 2 edit/blend services:
  - `gemini-image-edit`: 4K -> 60 credits
  - `gemini-image-blend`: 4K -> 60 credits
  - `gemini-3.1-image-edit`: 4K -> 60 credits
  - `gemini-3.1-image-blend`: 4K -> 60 credits
- Non-4K edit/blend pricing remains unchanged at 30 credits.
- Correction: Pro mode 4K edit/blend pricing is 120 (not 60): `gemini-image-edit` 4K -> 120, `gemini-image-blend` 4K -> 120.

## [Flow Patch - 2026-03-21]
### Fixed
- Flow `runNode` image input resolution now falls back across multiple image candidates (instead of stopping at the first failed value), reducing intermittent `viewAngle` failures with error `缺少图片输入` when a stale temporary image ref exists but a valid `imageUrl` is also present (`frontend/src/components/flow/FlowOverlay.tsx`).

## [Language Provider Patch - 2026-03-21]
### Added
- Admin 设置页新�?`banana_text_provider`（Banana 语言链路供应商切换），支�?`auto`、`legacy_auto`、`apimart`、`legacy`�?

### Changed
- Backend `BananaProvider` 文本链路（`/api/ai/text-chat`、`/api/ai/tool-selection`）接�?Apimart `POST /v1/chat/completions`，并复用 `NANO2_API_KEY`�?
- Banana 文本默认模型切换�?`gemini-3-flash-preview-apimart`；若切回 147 链路会自动归一化为兼容模型�?
- Follow-up: Banana Apimart 文本默认模型调整�?`gemini-2.5-flash`，并对文本链路启用快速失�?快速切换（减少 503/429 场景下的无效重试等待）�?

## [Apimart Text Model Patch - 2026-03-22]
### Changed
- Switched Banana Apimart text default model from `gemini-2.5-flash` to `gemini-3-flash-preview`.
- Updated backend text default model mapping for `banana` / `banana-2.5` / `banana-3.1` to `gemini-3-flash-preview`.
- Updated frontend `aiChatStore` Banana text defaults to `gemini-3-flash-preview` to keep client/server defaults aligned.

## [Canvas Batch Download Patch - 2026-03-22]
### Added
- Canvas 组合选择工具栏新增“批量下载”按钮，支持一次性下载当前选中集合（含组块内图片）中的全部图片（`frontend/src/components/canvas/SelectionGroupToolbar.tsx`, `frontend/src/components/canvas/DrawingController.tsx`）�?

### Changed
- `DrawingController` 的单图下载逻辑新增静默模式和布尔返回值，供批量下载复用并在批量完成后统一提示结果（`frontend/src/components/canvas/DrawingController.tsx`）�?

## [Flow Patch - 2026-03-24]
### Added
- Flow: added `videoToGif` node and backend `POST /api/video-gif/convert` pipeline (ffprobe + ffmpeg palettegen/paletteuse + OSS upload) to convert connected videos into GIF output URLs.

## [Flow Patch - 2026-03-24]
### Changed
- Flow `Image` node title now supports inline rename on double-click (`Enter`/blur to save, `Escape` to cancel), persisting to `data.label` (`frontend/src/components/flow/nodes/ImageNode.tsx`).

## [Flow Patch - 2026-03-24-2]
### Changed
- Flow `videoToGif` node UI: moved GIF download action to top-right button and removed bottom "open original" link row.

## [Flow Patch - 2026-03-24-3]
### Changed
- Flow `videoToGif` node removed loop toggle and fixed default GIF playback loop to non-infinite.
- Flow `videoToGif` node removed right-side output handle; node now acts as a conversion/download terminal.
- Flow `videoToGif` node credits updated to 30 in frontend fallback config and backend default node config.

## [Flow Patch - 2026-03-24-4]
### Changed
- Flow `videoToGif` backend now converts by input video duration by default (no hard `120s` cap in default path), and forces GIF output loop to non-infinite (`-loop 1`) even if loop param is provided by legacy callers (`backend/src/oss/video-gif.controller.ts`).
- Flow `videoToGif` node helper text updated to reflect duration behavior (`frontend/src/components/flow/nodes/VideoToGifNode.tsx`).

## [Flow Patch - 2026-03-24-5]
### Changed
- `videoToGif` conversion endpoint now integrates credits billing: pre-deduct 30 credits on start, mark success/failed status in `ApiUsageRecord`, and auto-refund on conversion failure (`backend/src/oss/video-gif.controller.ts`, `backend/src/credits/credits.config.ts`, `backend/src/oss/oss.module.ts`).
- Backend/frontend default node config for `videoToGif` now align with `serviceType=video-to-gif` and `priceYuan=0.3` for pricing/config consistency (`backend/src/admin/services/node-config.service.ts`, `frontend/src/services/nodeConfigService.ts`).
- Tencent Speech no-audio resilience: backend now probes input video audio stream before `ProcessMedia`; if no audio stream is detected, it auto-injects a silent AAC track via ffmpeg, uploads the patched video to OSS, and submits Tencent task with the patched URL. Added env toggles `TENCENT_MPS_AUTO_INJECT_SILENT_AUDIO` (default `true`), `TENCENT_MPS_FFPROBE_TIMEOUT_MS` (default `20000`), and `TENCENT_MPS_FFMPEG_TIMEOUT_MS` (default `180000`).

## [Bilingual Patch - 2026-03-29]
### Changed
- Frontend payment panel now uses locale-aware copy (`useLocaleText`) for order status, filter tabs, QR/payment prompts, and manual verification CTA (`frontend/src/components/payment/PaymentPanel.tsx`).
- Frontend library panel now uses locale-aware copy for upload/delete/send-to-canvas flows, detail panel labels, history filter/pagination, and 3D preview status text (`frontend/src/components/panels/LibraryPanel.tsx`).
- Frontend layer panel now uses locale-aware copy for panel header/actions, item/layer context menu labels, pending-upload badge/tooltip, default auto-generated item names, and bottom stats summary (`frontend/src/components/panels/LayerPanel.tsx`).
- Frontend toolbar now uses locale-aware copy for line-style picker labels, major tooltips/titles, and clear-canvas confirmation text (`frontend/src/components/toolbar/ToolBar.tsx`).
- Frontend AI chat dialog now uses locale-aware copy in key interaction controls: bottom parameter/tool buttons, upload/send helper prompts, history toolbar labels, and image/video preview action tooltips (`frontend/src/components/chat/AIChatDialog.tsx`).
- Frontend prompt optimization panel now uses locale-aware copy for labels/placeholders/errors/CTA buttons in the long-press expansion settings panel (`frontend/src/components/chat/PromptOptimizationPanel.tsx`).
- Frontend global keyboard shortcut handler now uses locale-aware copy for clipboard JSON toasts and cloud-save warning/error messages (`frontend/src/components/KeyboardShortcuts.tsx`).
- Frontend project manager modal now uses locale-aware copy for header, create/select/delete actions, leave-guard prompts, rename/delete confirms, empty state, and pagination text (`frontend/src/components/projects/ProjectManagerModal.tsx`).
- Frontend account badge now uses locale-aware copy for greeting, auth status labels/source tooltip, and logout button text (`frontend/src/components/AccountBadge.tsx`).
- Frontend app loader/overlay loading indicator now use locale-aware default loading messages (`frontend/src/components/AppLoader.tsx`, `frontend/src/components/AppLoadingIndicator.tsx`).
- Frontend auth wrapper now uses locale-aware copy for session-expired toast, auth-check loading message, and reload CTA (`frontend/src/components/AuthWrapper.tsx`).
- Frontend forgot-password modal now uses locale-aware copy for step labels, input placeholders, validation errors, and success/failure toasts across phone/verify/reset steps (`frontend/src/components/auth/ForgotPasswordModal.tsx`).
- Frontend autosave status/manual-save button now use locale-aware copy for saving/error/warning labels and blocked-cloud-save messaging (`frontend/src/components/autosave/AutosaveStatus.tsx`, `frontend/src/components/autosave/ManualSaveButton.tsx`).
- Frontend pending-upload leave guards now use locale-aware copy for navigation interception prompt title/message, detail lines, and action buttons (`frontend/src/components/guards/PendingUploadLeavePrompt.tsx`, `frontend/src/components/guards/PendingUploadNavigationGuard.tsx`).
- Frontend canvas zoom/focus/image-size indicators now use locale-aware copy for zoom menu entries/tooltips, focus-mode toggle tooltip, and original-size mode badge text (`frontend/src/components/canvas/ZoomIndicator.tsx`, `frontend/src/components/canvas/FocusModeButton.tsx`, `frontend/src/components/canvas/ImageSizeIndicator.tsx`).
- Frontend workflow history panel now uses locale-aware copy for empty/loading states, restore flow prompts, action labels, and panel header controls (`frontend/src/components/workflow-history/WorkflowHistoryButton.tsx`).
- Frontend layer-tool toggle and shared-template card now use locale-aware copy for toolbar/template action labels (`frontend/src/components/toolbar/LayerTool.tsx`, `frontend/src/components/template/SharedTemplateCard.tsx`).
- Cleaned residual Chinese inline comments in protected-route/template-overlay/smart-image utility components to keep bilingual scan baseline accurate (`frontend/src/routes/ProtectedRoute.tsx`, `frontend/src/components/template/TemplateLibraryOverlay.tsx`, `frontend/src/components/ui/SmartImage.tsx`).
- Frontend image/3D upload triggers now use locale-aware error copy for upload failure and picker readiness/opening errors (`frontend/src/components/canvas/ImageUploadComponent.tsx`, `frontend/src/components/canvas/Model3DUploadComponent.tsx`).
- Cleaned residual Chinese inline comments in canvas helper/renderer and shared UI primitive files to keep bilingual scan baseline accurate (`frontend/src/components/canvas/SelectionBoxOverlay.tsx`, `frontend/src/components/canvas/SnapGuideRenderer.tsx`, `frontend/src/components/canvas/ScaleBarRenderer.tsx`, `frontend/src/components/flow/nodes/GenerationProgressBar.tsx`, `frontend/src/components/ui/context-menu.tsx`, `frontend/src/components/ui/dropdown-menu.tsx`).
- Frontend OSS demo and prompt-optimizer demo pages now use locale-aware copy for user-facing actions, field labels, helper texts, and error messages (`frontend/src/pages/OSSDemo.tsx`, `frontend/src/pages/PromptOptimizerDemo.tsx`).
- Cleaned residual Chinese inline comment in app entry route bootstrap to keep bilingual scan baseline accurate (`frontend/src/main.tsx`).
- Frontend selection-group toolbar now uses locale-aware copy for capture/group/ungroup/batch-download/send-to-dialog action labels and tooltips (`frontend/src/components/canvas/SelectionGroupToolbar.tsx`).
- Cleaned residual Chinese inline comments/log labels in canvas container/interaction helpers to keep bilingual scan baseline accurate (`frontend/src/pages/Canvas.tsx`, `frontend/src/components/canvas/GlobalZoomCapture.tsx`, `frontend/src/components/canvas/InteractionController.tsx`).

## [Bilingual Patch - 2026-03-30]
### Changed
- Frontend background-removal tool + removed-image export panel now use locale-aware copy for upload prompts, success/failure messages, action buttons, and empty states (`frontend/src/components/canvas/BackgroundRemovalTool.tsx`, `frontend/src/components/canvas/BackgroundRemovedImageExport.tsx`).
- Frontend image preview modal now uses locale-aware copy for default title/history title, close/loading labels, generated-time tooltip, and fallback image alt text (`frontend/src/components/ui/ImagePreviewModal.tsx`).
- Frontend template modal now uses locale-aware copy for public/my tabs, loading states, user-template cards, add-template card, delete confirmations, and empty placeholders (`frontend/src/components/template/TemplateModal.tsx`).
- Frontend toolbar color/text controls now use locale-aware copy for eyedropper hints, transparent/fill labels, text style titles, color/alignment labels, and Chinese font display names (`frontend/src/components/toolbar/ColorPicker.tsx`, `frontend/src/components/toolbar/TextStylePanel.tsx`).
- Frontend expand-image selector and Sora2 test page now use locale-aware copy for operation hints/tooltips and Chinese prompt helper text (`frontend/src/components/canvas/ExpandImageSelector.tsx`, `frontend/src/pages/Sora2Test.tsx`).
- Frontend debug panels now use locale-aware copy for memory/history/cache labels, retry/API status text, and action buttons (`frontend/src/components/debug/MemoryDebugPanel.tsx`, `frontend/src/components/debug/HistoryDebugPanel.tsx`, `frontend/src/components/debug/CachedImageDebug.tsx`).
- Cleaned residual Chinese-only comments in MiniMap/text-selection overlay components to keep bilingual scan baseline accurate (`frontend/src/components/flow/MiniMapImageOverlay.tsx`, `frontend/src/components/canvas/TextSelectionOverlay.tsx`).
- Bilingual scanner baseline for unadapted TSX files reduced from `30` to `17` in this round.
- Removed deprecated RunningHub test page and public route (`/runninghub-test`) from frontend entry routing (`frontend/src/main.tsx`, `frontend/src/pages/RunningHubTest.tsx`, `helloagents/wiki/modules/frontend-app.md`).
- Frontend global-history list/detail views now use locale-aware copy for headers, filters, search placeholders, empty states, delete/undo prompts, and detail metadata labels (`frontend/src/components/global-history/GlobalImageHistoryPage.tsx`, `frontend/src/components/global-history/GlobalImageDetailModal.tsx`).
- Bilingual scanner baseline further reduced from `17` to `14` after removing `RunningHubTest` and adapting global-history pages.
- Flow add-panel template/custom empty states and category chips now use locale-aware labels (including `全部/All`, `其他/Other`, and placeholder subtitle copy) to avoid mixed-language UI in English mode (`frontend/src/components/flow/FlowOverlay.tsx`).
- Layer default naming now follows current locale for newly created layers (`图层 N`/`Layer N`), and layer panel display maps legacy `图层 N`/`Layer N` aliases to current language without mutating stored names (`frontend/src/stores/layerStore.ts`, `frontend/src/components/panels/LayerPanel.tsx`).
- Project default naming now follows current locale (`workspacePage.prompt.defaultName`) for auto-created/fallback projects, and header quick-switch display maps legacy `未命�?`/`Untitled*` aliases to current language (`frontend/src/stores/projectStore.ts`, `frontend/src/components/layout/FloatingHeader.tsx`).
- Payment package badges now localize backend-provided `tag/bonus` labels such as `首充翻倍` and `送X%`/`+X%` to prevent Chinese-only badge text in English mode (`frontend/src/components/payment/PaymentPanel.tsx`).


## [Seedream5 Provider Switch - 2026-04-05]
### Added
- Admin settings add `seedream5_provider` (`doubao` / `watcha`) to switch Seedream 5.0 provider channel.
- Backend Seedream5 service reads `seedream5_provider` and routes to Doubao or Watcha at runtime.

### Changed
- Watcha Seedream channel now supports dedicated env vars: `WATCHA_SEEDREAM_API_KEY`, `WATCHA_SEEDREAM_ENDPOINT`, `WATCHA_SEEDREAM_MODEL`.

## [Library Interaction Patch - 2026-04-05]
### Changed
- `�?-> 全局历史` 卡片单击行为从“直接发送到画板”改为“先打开左侧详情浮层”，详情浮层布局�?`个人素材` 保持一致，并提供发�?下载/删除操作（`frontend/src/components/panels/LibraryPanel.tsx`）�?
- `库` 面板内的 `个人素材` �?`全局历史` 卡片统一支持双击打开全屏预览（复�?`ImagePreviewModal`），单击仍用于选中并展示详情（`frontend/src/components/panels/LibraryPanel.tsx`）�?

## [Project Library Patch - 2026-04-05]
### Changed
- `库` 面板新增独立 `项目库` 标签（与 `全局历史`、`个人素材` 并列），按当前项�?ID 过滤展示项目内历史记录，并维护独立搜�?筛�?分页状态（`frontend/src/components/panels/LibraryPanel.tsx`）�?
- `项目库` 复用历史卡片交互：单击打开详情浮层（发送到画板/下载/删除），双击打开全屏预览；删除后会按项目过滤条件刷新当前列表（`frontend/src/components/panels/LibraryPanel.tsx`）�?

## [Membership Credit Policy Patch - 2026-04-08]
### Changed
- 后端新增独立业务策略模块 `backend/src/business-policy/*`，把会员积分策略统一收口�?`SystemSetting[membership_credit_policy]`�?
- 新增管理后台接口 `GET/POST /api/admin/membership-credit-policy`，支持配置赠送衰减值、固定积分有效期、签到奖励、签到有效期�? 日连签奖励、会员刷新周期�?
- 新增管理后台接口 `GET/POST/PATCH /api/admin/membership-plans*`，支持会员套餐列表管理、创建与编辑�?
- `PaymentService.processPaymentSuccess` �?`CreditsService.adminAddCredits` 现在�?`fixedCreditExpireDays` 创建充�?手工补发积分 lot，可�?`fixed_window` �?`permanent` 之间切换�?
- `CreditsService.claimDailyReward` 改为读取后台配置的签到积分、签到有效期�?7 日连签奖励�?
- `MembershipService.decayDailyGiftCredits` �?`MembershipService.refreshYearlySubscriptionQuotaLots` 改为读取后台配置，不再写�?`50/30`�?
- 任务接口文档补充�?`task/2026-04-08-tanva-membership-api.md`，覆盖后台策略接口与配置生效点�?
- 前端管理后台 `系统设置` 下新�?`VIP管理` 子页，集成会员套餐列表管理与会员积分策略配置�?
- 后台管理员正向加积分改为进入 `gift` 池，不再按固定积分处理；这部分积分会参与赠送积分衰减，并在 VIP 状态下�?`pauseGiftDecay` 保护�?
- 新增会员每日赠送积分发放任务：活跃会员按套�?`dailyGiftCredits` 每日自动发放一笔赠送积分，幂等键按“订�?+ 自然日”控制�?
- `/my-credits` 页面挂载时新增一次静默签到兜底，再刷新余额与交易流水，避免全局自动签到与页面首屏请求存在时序竞争时，看不到当日签到记录�?
- `CreditsService.claimDailyReward` 改为在事务内锁定 `CreditAccount` 行并再次校验业务日，修复多入口同时触发签到时可重复发放的问题�?
- `grantFreeUserMonthlyQuotaIfNeeded` 改为在事务内锁定 `CreditAccount` 行后再检查本周期发放记录，修复多个并发请求同时命中账户初始化/余额查询路径时，免费月额度可能重复记交易的问题�?
- `/my-credits` 页面移除额外的静默自动签到，自动签到重新收口为应用入口单点触发，减少无意义并发请求�?
- Admin/Credits: 统一模型管理开始升级为正式定价结构，vendor 支持 `pricing.defaults + pricing.rules`，管理台可维护默认积�?默认价格与规格规则价格；后端预扣费兼容解析新旧结构，并把命中�?`pricingSnapshot` 写入 API 使用记录审计字段�?
- upstream request telemetry 新增 `type` 字段，按请求/响应�?MIME、URL �?body 特征推断�?`text` / `video` / `picture`，便于在 `upstream_requests` 里区分不同媒介请求（`backend/src/telemetry/upstream-fetch-logger.ts`, `backend/src/telemetry/openobserve-telemetry.service.ts`）�?
- upstream request telemetry 扩展 `type` 枚举�?`text` / `video` / `picture` / `audio` / `file` / `binary` / `other`，并新增 `origin` / `origin_host` 记录发起请求时的来源域名，优先继承当前入站请求头，缺失时回退上游请求头中�?`Origin/Referer`（`backend/src/telemetry/request-context.ts`, `backend/src/telemetry/openobserve-request.interceptor.ts`, `backend/src/telemetry/upstream-fetch-logger.ts`, `backend/src/telemetry/openobserve-telemetry.service.ts`）�?

## [Chat Video Managed Pricing Defaults - 2026-04-29]
### Fixed
- Backend video-provider billing now applies managed route `pricing.displayConfig.defaultSelections` to missing billing specs before pre-deduct. Chat-created Seedance tasks now use the same default spec context as canvas nodes, so managed route pricing can match instead of falling back to static `doubao-video` pricing.

## [Tencent Kling2.6 Param Alignment - 2026-04-12]
### Changed
- Tencent route for `kling-2.6` now maps two-image input to official start-end request shape: first frame in `FileInfos` + `LastFrameUrl`, while non-start-end image inputs are tagged as `Usage=Reference`.
- Tencent `kling-2.6` now normalizes output params to documented capabilities: `Duration` constrained to `5/10`, `Resolution` constrained to `720P/1080P`, and start-end mode enforces `OutputConfig.AudioGeneration=Disabled`.
- Frontend `FlowOverlay` now avoids force-setting `sound=on` for Tencent `kling-2.6`, so user-selected sound intent can be transmitted (Tencent start-end no-audio rule is still enforced by backend).

## [Tencent Kling2.6 Image-2 Handle Fix - 2026-04-13]
### Changed
- Frontend `kling2.6` node now exposes `image-2` input in Tencent route even under `std` mode (not only `pro`), so users can actually configure start-end frames.
- Flow connection validation and edge admission rules now allow `image-2` for Tencent `kling-v2-6` route in both `std/pro`, while non-Tencent routes keep the original `pro`-only behavior.
- Added Tencent-route fallback detection for legacy nodes without explicit `vendorKey/platformKey`: when node metadata default vendor is `tencent_vod`, `image-2` is still enabled.

## [Tencent Kling3.0 Route Alignment - 2026-04-13]
### Changed
- Backend `video-provider` routing now prioritizes `klingModel=kling-v3-0` and always dispatches to managed `kling-3.0` flow (even when frontend provider is `kling-o3`), preventing accidental `3.0-Omni` path selection.
- Backend video-task query now resolves managed Tencent tasks by taskId prefix first, so `kling-v3-0` tasks are polled correctly even if frontend provider remains `kling-o3`.
- Frontend Tencent detection for `kling-o3` no longer treats missing `vendorKey/platformKey` as Tencent by default; it now requires explicit Tencent vendor keys or metadata `managedRoutes.defaultVendor=tencent_vod`.
- Frontend Tencent Kling parameter mapping now applies the Tencent sound behavior consistently to both `kling-2.6` and `kling-v3-0` routes (no non-Tencent `pro => sound=on` override on Tencent path).

## [Billing Idempotency Patch - 2026-04-13]
### Changed
- Frontend AI chat send path now has local in-flight guard for `send`, `optimized send`, and `resend`, preventing duplicate trigger bursts from rapid click/Enter.
- Frontend Flow `runNode` now has per-node in-flight guard, preventing concurrent duplicate runs of the same node before status updates settle.
- Frontend request clients now send `Idempotency-Key` for image/video generation and `generate-video-provider` calls; retries reuse the same logical request key.
- Backend `CreditsService.preDeductCredits` now supports idempotent pre-deduct (short-window duplicate detection by `idempotencyKey` and request fingerprint) and reuses existing `apiUsageId` instead of charging again.
- Backend `withCredits`, `generate-video-provider`, and `video-gif/convert` now forward idempotency keys into credits pre-deduct flow.

## [CORS Header Fix For Idempotency - 2026-04-13]
### Changed
- Backend Fastify CORS `allowedHeaders` now explicitly allows `idempotency-key`, `x-idempotency-key`, and `x-request-id`, fixing browser-side `Failed to fetch` on `/api/ai/generate-image` preflight in cross-origin dev.
- Stable(Tencent) Banana Fast pricing remains `30` credits in backend deduction and frontend display matrices.

## [Banana Route Billing Consistency - 2026-04-13]
### Changed
- Backend image credit pre-deduct now writes explicit `channel` from frontend `bananaImageRoute` (`normal -> apimart`, `stable -> tencent`) to avoid route mismatch during charging.
- Channel normalization no longer maps `nano2` to Tencent; `nano2` is normalized to `apimart` for billing channel resolution and usage remark generation.
- Tencent Banana pricing override now treats explicit route as highest priority (`stable` always Tencent matrix, `normal` always non-Tencent matrix).
- Pre-deduct duplicate detection now prioritizes `idempotencyKey`: when key exists it no longer falls back to `requestFingerprint` dedup in the same window, preventing two intentional consecutive runs from being merged into one billing record.
- Frontend image request layer now injects Banana route using runtime store state first (`window.__tanvaBananaImageRoute`), then persisted preferences, and writes route into `providerOptions` for every image request call.
- Frontend image requests now include `X-Banana-Image-Route`; backend CORS allows this header for cross-origin preflight.
- Wan Dynamic Pricing: Prisma migration `202604140002_backfill_wan_dynamic_pricing_from_aliyun` 现将 `wan-2.6` / `wan-2.6-r2v` / `wan-2.7` 升级�?`resolution × durationSec` 线性定价，并在阿里云百炼基线上执行“每�?+20 积分”上浮（720P `0.8 �?秒`�?080P `1.2 �?秒`，按现有 `1 �?= 100 积分` 自动折算�?`80 / 120 积分每秒`）�?
- Wan Credits Runtime: DashScope Wan 直连接口现在会把 `managedModelKey / vendorKey / resolution / durationSec / generationMode` 一并传入积分预扣，避免已有动�?pricing migration 生效后仍因请求上下文缺失而回退到固�?`600` 积分（`backend/src/ai/ai.controller.ts`）�?
- Pricing Catalog Modal: 画布右上角帮助菜单新增“定价一览”，前端支持查看全部模型或单模型定价；后端新�?`GET /api/credits/pricing/models` 只读接口，直接返回默认价、规则条件和 evaluator 公式，线性定价可直接展示计费公式�?

## [GPT-Image-2 Resolution + Fallback Alignment - 2026-04-24]
### Changed
- Frontend `gptImage2` node now shows `Resolution` selector (`1K/2K/4K`) and defaults to `1K`.
- Frontend `gptImage2` enforces APIMart 4K ratio limits in node UI: only `16:9 / 9:16 / 2:1 / 1:2 / 21:9 / 9:21` are selectable at `4K`, with invalid ratio auto-correction.
- Frontend run pipeline now sends `gptImage2` `resolution` and `official_fallback`; `official_fallback` defaults to `true`.
- Backend Nano2 provider/service and DTO now accept/passthrough `official_fallback` to APIMart payload.
- Backend/Frontend default node config metadata for `gptImage2` updated to enable resolution selector and carry default `officialFallback=true`.
- Frontend `gptImage2` now hard-fixes resolution options to `1K/2K/4K` (ignores incomplete metadata subsets such as only `1K`) and uses video-node style dropdown menus for both aspect ratio and resolution.
- Backend `nano2` provider now normalizes GPT-Image-2 `resolution` to APIMart-required lowercase values (`1k/2k/4k`) before upstream submission, preventing silent fallback to default 1k when frontend selects 2K/4K.
- GPT-Image-2 `official_fallback` default changed to `false` across frontend fallback config, flow runtime fallback, backend node defaults, and nano2 provider request fallback.

## [Generate4 Billing Route Consistency - 2026-04-27]
### Changed
- Flow `Generate4` execution now resolves provider from node-level `modelProvider` (same as node UI selection), instead of always using global provider.
- Flow route-aware credits for Banana image nodes now prioritize node-level `modelProvider` for tier resolution in both normal/stable routes, fixing mismatched `Pro/Fast/Ultra` badge costs.
- Credits transaction history enrichment now includes `outputImageCount` from API usage records.
- `/my-credits` transaction rows now show `xN` when `outputImageCount > 1`.

## [Parallel Multi-Image Canvas Visibility - 2026-04-27]
### Changed
- Canvas matrix layout for multi-image generate/edit/blend now uses centered horizontal-first placement (for `X4`, no forced four-grid), preventing “only one visible now” caused by right-only expansion.
- AI chat result remote-url extraction now accepts persistable image refs (OSS key/proxy/path), not just `http(s)` URLs, so multi-result images can be correctly placed on canvas.
- Parallel placeholder creation for chat `X4/X8` is now eager (all placeholders created before task queue starts), so even when runtime concurrency drops to `1`, users can still see all pending slots immediately.
## [Canvas Expand Selector Viewport Lock Fix - 2026-04-28]
### Changed
- Expand image selector now reprojects frame and preview positions on every canvas viewport change (`zoom/pan`), so fixed expansion bounds no longer drift while zooming/panning.
- Expand image selector world/screen coordinate conversion now consistently applies `devicePixelRatio`, fixing high-DPI offset and size mismatch during resize/drag interactions.
- Expand apply flow remains in-place replacement for the current `imageId` (no extra image node creation), matching direct-on-original editing behavior.
## [Expand Image Keep Source + Placeholder Output - 2026-04-29]
### Changed
- Removed legacy `expand-image` in-place replacement branch in `DrawingController` quick-upload event handling.
- Expand results now follow placeholder/new-image insertion path and no longer overwrite the source image node.

## [2D To 3D Format Guard + Refund Fix - 2026-05-22]
### Changed
- Backend `convert-2d-to-3d` now rejects explicit unsupported upstream result formats such as `zip/obj/fbx/stl/usdz/ply`, instead of returning a fake-success `modelUrl` that the frontend cannot render.
- Frontend canvas `2D转3D` flow now validates returned model URLs and only inserts 3D assets when the result is `GLB/GLTF`; unsupported formats surface a clear error instead of a blank 3D container.
- Credits failure policy for `convert-2d-to-3d` remains unchanged: failures still do not refund automatically.

## [Background Removal Pnpm Resolve Fix - 2026-05-22]
### Changed
- Backend background removal service and isolated worker now resolve `@imgly/background-removal-node` via `require.resolve(.../package.json)` first, then derive the real package `dist/resources.json` path.
- This avoids false negatives on deployment targets using `pnpm`/symlinked `node_modules` layouts where hardcoded `node_modules/@imgly/.../dist` checks can fail even though the package is installed.
- Credits/Flow Pricing: aligned text/tool pricing to the current pricing table (`gemini-text=2`, `gemini-prompt-optimize=5`, `gemini-tool-selection=2`), made `storyboardSplit` free in node config output, and corrected Banana stable-route Ultra display/deduction for `1K=50` and `2K=70`; Flow `viewAngle` now participates in the same dynamic Banana image pricing as other edit nodes.

## [Video Analysis Async Polling - 2026-05-27]
### Changed
- Video analysis now has an async `taskId + polling` path to avoid long-request `504`s: backend adds `POST /api/ai/analyze-video-async` and `GET /api/ai/analyze-video-task/:taskId`, both reusing the existing video-analysis pipeline.
- Frontend `VideoAnalyzeNode` now creates an async task and polls for completion instead of waiting on a single long-running `/api/ai/analyze-video` request.
