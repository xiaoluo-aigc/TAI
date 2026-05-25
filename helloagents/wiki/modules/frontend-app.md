# 前端模块：应用入口与路由（frontend-app）

## 作用
- 负责应用入口渲染、路由定义与受保护路由的初始化策略。

## 关键文件
- `frontend/src/main.tsx`：路由表（Home/Login/Register/Workspace/App/Admin/MyCredits 等）
- `frontend/src/routes/ProtectedRoute.tsx`：延迟初始化认证状态，避免首页加载即请求 `/api/auth/me`
- `frontend/src/App.tsx`：主应用（工作区/画布等以实现为准）

## AI 对话框右键菜单
- 对话框内容区使用浏览器默认右键菜单。

## AI 对话框图片模式可用性
- 手动模式会根据当前图片数量自动禁用不支持选项，并在不兼容时回退到 Auto。
- 发送按钮在模式不支持当前图片数量时禁用并提示原因。

## 离开保护（上传中/待上传）
- 编辑器（`/app`）内若存在上传中/待上传图片（含 Flow 内联图片引用），在离开页面/切换项目/退出登录/浏览器前进后退时会弹出确认提示，避免误操作导致图片丢失或无法保存到云端。

## 路由约定（节选）
- 公开：`/`、`/auth/login`、`/auth/register`、`/oss`
- 登录页已移除观猹 OAuth 入口按钮（后端授权接口仍保留），当前登录入口仅保留手机号密码与短信验证码方式。
- 登录页与登录过期弹窗已移除「观猹登录按钮」与「微信扫码登录」入口，当前仅保留手机号密码登录与短信验证码登录（`frontend/src/pages/auth/Login.tsx`, `frontend/src/components/auth/LoginModal.tsx`）。
- 受保护：`/workspace`、`/app`、`/admin`、`/my-credits`
- 登录页与注册页已补充移动端适配：小屏下认证卡片改为顶部对齐并允许纵向滚动，标签切换改为三列紧凑布局，验证码输入区改为纵向堆叠，协议文案允许多行左对齐，避免窄屏遮挡与横向溢出（`frontend/src/pages/auth/Login.tsx`, `frontend/src/pages/auth/Register.tsx`）。
- 首页（`/`）与登录页（`/auth/login`）欢迎背景已统一切换为 Three.js Shader 动画，复用组件 `frontend/src/components/background/WelcomeShaderBackground.tsx` + `ShaderPlaneBackground.tsx`，替代原 `OpenVideo.mp4` 视频背景。

## 我的积分（`/my-credits`）
- 页面与应用入口都不再静默触发 `claimDailyReward()`；签到积分必须由用户手动触发领取，不再自动签到。
- 积分流水在“项目”列支持显示 AI 渠道与模型（如 `渠道：A · 模型：gemini-2.5-flash-image-preview`），用于定位实际执行链路。
- 概览卡片右上角提供“立即充值”文字按钮；点击后在当前页弹出 `PaymentPanel` 充值面板。
- `MembershipPanel` 中“积分充值”区域对所有用户开放，且在会员页顶部优先展示（打开即见），无需先选择或购买 VIP。
- `PaymentPanel`（`frontend/src/components/payment/PaymentPanel.tsx`）核心交互文案已接入 `useLocaleText`（订单状态、筛选、支付提示、二维码状态、手动核对按钮）。
- 概览与趋势的“消耗”口径为净消耗：按 `spend - refund` 计算（最小值为 0），避免失败后退款仍被算入“今日/近 7 天消耗”。

## 管理后台 OpenObserve 跳转（`/admin`）
- `frontend/src/utils/openobserve.ts` 提供统一环境判断与 logs URL 构造：优先读取 `VITE_APP_ENV`，其次按 `location.hostname` 推断 `local/test/prod`，并统一输出 `/web/logs?...`。
- 生产环境 OpenObserve 地址只保留 `VITE_OPENOBSERVE_LOGS_URL_PROD`；`www.tgtai.com` 已依赖站点重定向回主域名 `tgtai.com`，不再维护单独 fallback 变量。
- `frontend/src/components/admin/OpenObserveLogButton.tsx` 封装了“查看 OpenObserve 日志”按钮；当前已接入管理后台 API 记录失败行，后续其他记录列表可直接复用同一组件。
- 日志流默认支持 `upstream_requests`、`generation_tasks`、`backend_requests`、`backend_errors`、`backend_events`、`frontend_errors`；失败记录会优先按 `apiUsageId / requestId / traceId / taskId` 组合精确过滤。

## 双语适配（画布侧）
- `LayerPanel`（`frontend/src/components/panels/LayerPanel.tsx`）已接入 `useLocaleText`：面板标题、操作 tooltip、上下文菜单、待上传标识与底部统计文案均按语言切换。
- `LibraryPanel`（`frontend/src/components/panels/LibraryPanel.tsx`）已接入 `useLocaleText`：上传/删除/发送提示、详情面板字段、全局历史筛选和分页文案按语言切换。
- `LibraryPanel` 新增独立 `项目库` 标签：按当前 `currentProjectId` 过滤展示项目内历史记录（与 `全局历史` 分离），并复用单击详情弹层、发送/下载/删除操作与双击全屏预览交互。
- `ToolBar`（`frontend/src/components/toolbar/ToolBar.tsx`）已接入 `useLocaleText`：主工具 tooltip、线条样式面板、清空画布确认等高频交互文案双语化。
- `AIChatDialog`（`frontend/src/components/chat/AIChatDialog.tsx`）底部参数栏与上传菜单、历史会话工具条、图片/视频预览操作 tooltip 已按中英文切换（组件内通过 `i18n.language` + `lt()` 本地文案映射实现）。
- `PromptOptimizationPanel`（`frontend/src/components/chat/PromptOptimizationPanel.tsx`）已接入双语文案：输出语言/长度倾向/风格/重点字段标签、占位符、错误提示和底部操作按钮按语言切换。
- `KeyboardShortcuts`（`frontend/src/components/KeyboardShortcuts.tsx`）已接入双语文案：快捷键复制/导入 JSON 的 toast 提示，以及云端保存阻断与失败文案按语言切换。
- `ProjectManagerModal`（`frontend/src/components/projects/ProjectManagerModal.tsx`）已接入双语文案：项目管理头部、创建/批量选择/删除、离开保护确认、重命名/删除确认、空态与分页文案按语言切换。
- `AccountBadge`（`frontend/src/components/AccountBadge.tsx`）已接入双语文案：问候语、认证状态标签与来源 tooltip、退出登录按钮按语言切换。
- `AppLoader` / `AppLoadingIndicator`（`frontend/src/components/AppLoader.tsx`, `frontend/src/components/AppLoadingIndicator.tsx`）默认加载提示已按语言切换。
- `AuthWrapper`（`frontend/src/components/AuthWrapper.tsx`）会话过期 toast、登录状态校验加载文案、错误态“重新加载”按钮已按语言切换。
- `ForgotPasswordModal`（`frontend/src/components/auth/ForgotPasswordModal.tsx`）已接入双语文案：手机号/验证码/重置密码三步流程的标题、说明、输入占位、错误提示、操作按钮与 toast 按语言切换。
- `AutosaveStatus` / `ManualSaveButton`（`frontend/src/components/autosave/AutosaveStatus.tsx`, `frontend/src/components/autosave/ManualSaveButton.tsx`）已接入双语文案：保存状态提示、手动保存按钮、保存失败与未上传阻断提示按语言切换。
- `PendingUploadLeavePrompt` / `PendingUploadNavigationGuard`（`frontend/src/components/guards/PendingUploadLeavePrompt.tsx`, `frontend/src/components/guards/PendingUploadNavigationGuard.tsx`）已接入双语文案：离开确认弹窗标题/说明/详情行/按钮与路由拦截提示按语言切换。
- `ZoomIndicator` / `FocusModeButton` / `ImageSizeIndicator`（`frontend/src/components/canvas/ZoomIndicator.tsx`, `frontend/src/components/canvas/FocusModeButton.tsx`, `frontend/src/components/canvas/ImageSizeIndicator.tsx`）已接入双语文案：缩放菜单与按钮 tooltip、专注模式提示、原始尺寸模式标识按语言切换。
- `WorkflowHistoryButton`（`frontend/src/components/workflow-history/WorkflowHistoryButton.tsx`）已接入双语文案：历史面板标题、刷新/关闭/恢复操作、空态与恢复确认提示按语言切换。
- `LayerTool` / `SharedTemplateCard`（`frontend/src/components/toolbar/LayerTool.tsx`, `frontend/src/components/template/SharedTemplateCard.tsx`）已接入双语文案：图层面板按钮标题、模板卡片空态/标签前缀/删除提示按语言切换。
- `ImageUploadComponent` / `Model3DUploadComponent`（`frontend/src/components/canvas/ImageUploadComponent.tsx`, `frontend/src/components/canvas/Model3DUploadComponent.tsx`）已接入双语文案：上传失败、组件未就绪、无法打开文件选择器等错误提示按语言切换。
- `SelectionBoxOverlay` / `SnapGuideRenderer` / `ScaleBarRenderer` / `GenerationProgressBar` / `context-menu` / `dropdown-menu` 已清理残余中文注释，保持扫描基线准确并避免误报未双语化文件。
- `OSSDemo` / `PromptOptimizerDemo`（`frontend/src/pages/OSSDemo.tsx`, `frontend/src/pages/PromptOptimizerDemo.tsx`）已接入双语文案：Demo 页按钮、状态提示、字段标签、辅助说明和错误提示按语言切换。
- `SelectionGroupToolbar`（`frontend/src/components/canvas/SelectionGroupToolbar.tsx`）已接入双语文案：截图、组合/解组、批量下载、发送到对话框等动作的按钮文字和 tooltip 按语言切换。
- `Canvas` / `GlobalZoomCapture` / `InteractionController` 已清理残余中文注释与日志标签，保持扫描基线准确并避免误报未双语化文件。
- `BackgroundRemovalTool` / `BackgroundRemovedImageExport`（`frontend/src/components/canvas/BackgroundRemovalTool.tsx`, `frontend/src/components/canvas/BackgroundRemovedImageExport.tsx`）已接入双语文案：上传提示、处理成功提示、导出按钮、空态说明按语言切换。
- `ImagePreviewModal` / `TemplateModal`（`frontend/src/components/ui/ImagePreviewModal.tsx`, `frontend/src/components/template/TemplateModal.tsx`）已接入双语文案：预览标题与加载文案、模板页签与加载态、模板删除确认和占位文案按语言切换。
- `ColorPicker` / `TextStylePanel`（`frontend/src/components/toolbar/ColorPicker.tsx`, `frontend/src/components/toolbar/TextStylePanel.tsx`）已接入双语文案：吸管取色提示、透明/更多按钮、字体/字重/颜色/对齐标题按语言切换。
- `MemoryDebugPanel` / `HistoryDebugPanel` / `CachedImageDebug`（`frontend/src/components/debug/MemoryDebugPanel.tsx`, `frontend/src/components/debug/HistoryDebugPanel.tsx`, `frontend/src/components/debug/CachedImageDebug.tsx`）已接入双语文案：监控状态、历史栈说明、缓存图调试标签与操作按钮按语言切换。
- `Sora2Test`（`frontend/src/pages/Sora2Test.tsx`）已接入双语文案：视频提示词占位与画幅提示说明按语言切换。
- `MiniMapImageOverlay` / `TextSelectionOverlay` 已清理残余中文注释，保持扫描基线准确并避免误报未双语化文件。
- `GlobalImageHistoryPage` / `GlobalImageDetailModal`（`frontend/src/components/global-history/GlobalImageHistoryPage.tsx`, `frontend/src/components/global-history/GlobalImageDetailModal.tsx`）已接入双语文案：历史页标题、搜索/筛选、加载与空态、删除撤销提示，以及详情弹窗元数据标签按语言切换。
- `FloatingHeader` + `projectStore`（`frontend/src/components/layout/FloatingHeader.tsx`, `frontend/src/stores/projectStore.ts`）已补充双语策略：自动创建/兜底项目名按当前语言生成，且历史 `未命名*`/`Untitled*` 项目名在顶部标题与项目下拉中按当前语言显示。
- 工作区顶部项目名右侧新增快捷 `+` 新建按钮（`FloatingHeader`），点击可直接创建并切换到新项目；项目下拉中的“新建项目”复用同一创建逻辑并带防连点保护。
- `PaymentPanel`（`frontend/src/components/payment/PaymentPanel.tsx`）已下架“双倍/首充翻倍”角标展示；`送X%` 等赠送百分比角标同样保持前端屏蔽。
- `LayerPanel` + `layerStore`（`frontend/src/components/panels/LayerPanel.tsx`, `frontend/src/stores/layerStore.ts`）已补充图层名双语兼容：新建图层默认名按当前语言生成，历史 `图层 N`/`Layer N` 显示按当前语言映射。

## 工作区顶部帮助入口（`/app`）
- 组件：`frontend/src/components/layout/FloatingHeader.tsx`
- 交互：问号按钮改为 hover 展开下拉菜单，不再直接点击跳转。
- 菜单项：`用户手册`（飞书文档）与 `更新日志`（仓库 `frontend/docs/06-变更日志.md`）。

## 工作区顶部积分入口（`/app`）
- 组件：`frontend/src/components/layout/FloatingHeader.tsx`
- 交互：右上角工具区新增“积分”按钮（图标 + 当前余额），点击后新开页进入 `/my-credits`。
- 数据：复用顶部已加载的 `getMyCredits()` 结果（加载中显示 `...`，暂无数据显示 `--`）。

## 工作区设置弹窗（`/app`）
- 组件：`frontend/src/components/layout/FloatingHeader.tsx`
- 交互：切换左侧设置分组时，右侧内容滚动区域会回到顶部（不保留上一次分组的滚动位置）。
- 保存状态提示（如“有未保存更改”）放在设置首页用户信息区显示，不再在画布顶部常驻显示。
