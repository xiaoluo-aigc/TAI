# 后端模块：积分系统（backend-credits）

## 2026-04-15 Update
- Image analysis deduction mapping is fixed to: Fast (gemini-2.5-image-analyze) = 10, Pro (gemini-image-analyze) = 30, Ultra (gemini-3.1-image-analyze) = 20.
- POST /api/ai/analyze-image serviceType routing now follows provider tier (banana-2.5 / banana / banana-3.1|nano2) for consistent billing.

## 2026-04-19 Recharge policy simplification
- `GET /api/payment/packages` returns fixed recharge tiers for all users (no VIP first-top-up x2 logic).
- Current base tiers: `25=2500`, `50=5000`, `100=10000`, `200=20000`, `500=50000`, `1000=100000`.
- Backend enforcement:
  - Recharge order credits are still recalculated server-side in `PaymentService.createOrder` from amount.
  - Client-provided `credits` does not control final recharge grant.

## 作用
- 维护用户积分余额、交易流水、API 使用记录与服务定价。
- 提供每日奖励领取与管理员加/扣积分接口。

## 关键文件
- `backend/src/credits/credits.controller.ts`：`/credits/*`
- `backend/src/credits/credits.service.ts`：积分/定价/流水/使用记录逻辑（Prisma）
- `backend/src/credits/dto/credits.dto.ts`：DTO

## 图像计费规则（当前）
- 生图：按 `resolutionPricing` 区分（如 Pro 2K=60，Ultra 2K=45）。
- 图像编辑：
  - Pro（`gemini-image-edit`）1K=40，2K=60，4K=120，其余分辨率默认 30。
  - Ultra（`gemini-3.1-image-edit`）0.5K=20，2K=45，4K=60，其余分辨率默认 30。
- 图像融合：
  - Pro（`gemini-image-blend`）1K=40，2K=60，4K=120，其余分辨率默认 30。
  - Ultra（`gemini-3.1-image-blend`）0.5K=20，2K=45，4K=60，其余分辨率默认 30。
- 账单流水中的 `description` 由后端生成，格式为 `使用 {serviceName}（{imageSize}）`，前端直接展示。

## API（前缀 `/api/credits`，节选）
- `GET balance`
- `GET daily-reward/status` / `POST daily-reward/claim`
- `GET pricing`
- `GET transactions`：返回流水基础字段 + `channel`（渠道）、`provider`、`model`、`apiResponseStatus`、`processingTime`
- `GET usage`
- `POST admin/add` / `POST admin/deduct`（需要管理员角色）

## 免费用户生成配额（按“用户是否已付费/白名单”判定）
- 适用对象：普通免费用户受限。
- 以下用户不走免费生图/生视频配额限制：
  - 任意存在 `paymentOrder.status=paid` 的用户
  - 活跃会员
  - 白名单用户（`user.noWatermark=true`）
  - `admin/normal_admin`
- 生图上限：
  - 每天最多 `20` 张（UTC 日）
  - 每月最多 `100` 张（UTC 月）
- 视频上限：
  - 每天最多 `3` 个（UTC 日）
  - 每月最多 `10` 个（UTC 月）
- 计数口径：统计 `ApiUsageRecord` 中 `responseStatus in (pending, success)` 的记录，避免并发重复下单绕过配额。
- 可通过环境变量覆盖默认值：
  - `FREE_USER_DAILY_IMAGE_LIMIT`
  - `FREE_USER_MONTHLY_IMAGE_LIMIT`
  - `FREE_USER_DAILY_VIDEO_LIMIT`
  - `FREE_USER_MONTHLY_VIDEO_LIMIT`

## 渠道与模型追踪（图像分析）
- `POST /api/ai/analyze-image` 的计费请求参数会写入 `aiProvider/channelHint`，用于在积分流水中识别执行渠道。
- 流水列表前端可直接展示“渠道 + 模型”，用于核对“使用了哪个渠道、哪个模型”。
- 视频模型管理线路若在 `model_provider_mapping_v2.models[].vendors[]` 配置了 `creditsPerCall`，后端预扣积分会优先使用该线路价格，而不是节点管理/静态服务价。
- 若 `model_provider_mapping_v2.models[].vendors[].metadata.specPricing` 配置了规格积分规则，后端会按数组顺序匹配第一条命中的 `match/when` 条件，再回退到厂商级 `creditsPerCall`：
  - 规则格式示例：`{ "match": { "resolution": "720P", "duration": 10 }, "creditsPerCall": 900 }`
  - 常用匹配字段可直接复用请求参数，如 `resolution`、`duration`、`aspectRatio`、`mode`、`sound`、`modelVersion`。
- 新定价结构优先：
  - `model_provider_mapping_v2.models[].vendors[].pricing.defaults`：厂商默认价
  - `model_provider_mapping_v2.models[].vendors[].pricing.rules[]`：规格组合价
  - 命中模型管理价格时，后端会把 `pricingSnapshot` 写入 `ApiUsageRecord.requestParams`，用于审计规则来源、命中 ruleKey 和最终价格快照。
- `POST /api/ai/generate-video-provider` 现在会在解析出模型管理线路后，将该线路 `pricing.displayConfig.defaultSelections` 用作缺失规格的计费默认值；例如对话框 Seedance 2.0 未显式选择分辨率/时长时，按模型管理默认 `720P / 5s` 参与规格定价，避免回退到静态 `doubao-video` 价格。
- 新增只读接口 `GET /api/credits/pricing/models`：
  - 面向画布右上角“定价一览”弹层。
  - 支持通过 `modelKey` 查询单模型，未传时返回全部模型。
  - 返回模型 / 厂商默认价 / 规格规则 / 计费维度；线性与矩阵等 evaluator 会带公式描述，便于直接展示。
- Wan 系列（2026-04-14）：
  - `wan-2.6`、`wan-2.6-r2v`、`wan-2.7` 已升级为按 `resolution × durationSec` 线性计费。
  - 当前系统定价在阿里云百炼基线之上做了“每秒 +20 积分”上浮，对应 `720P = 0.8 元/秒`、`1080P = 1.2 元/秒`；系统按当前积分汇率自动折算为 `80 / 120 积分每秒`。
  - DashScope 直连接口必须携带 `managedModelKey + vendorKey + generationMode + resolution + durationSec`，否则会回退到静态服务价。

## pending 收敛与自动退款
- 异步视频链路支持前端回写成功：`POST /api/ai/video-task-success` 将 `ApiUsageRecord.responseStatus` 从 `pending` 更新为 `success`。
- 异步任务失败可调用 `POST /api/ai/video-task-refund`：先标记 `failed` 再退款；退款交易按 `apiUsageId` 幂等。
- 状态机保护：`updateApiUsageStatus` 禁止 `failed -> success` 与 `success -> failed` 的反向回写，避免“已退款后又标记成功”或“已成功后又标记失败”的状态/账务不一致。
- 定时任务每 5 分钟扫描超时 `pending` 并自动退款：
  - 图像类：`CREDITS_PENDING_TIMEOUT_MINUTES`（默认 15 分钟）
  - 视频类：`CREDITS_PENDING_VIDEO_TIMEOUT_MINUTES`（默认 30 分钟）
- 视频类自动退款默认带分界线：仅处理 `createdAt >= 2026-03-28T00:00:00.000Z` 的记录，避免历史 `pending` 上线后集中退款。
  - 可通过 `CREDITS_PENDING_VIDEO_REFUND_CUTOVER_AT` 覆盖时间点；
  - 设置为 `off/none/0` 可关闭分界线过滤。

## 数据模型关联
- `CreditAccount`、`CreditTransaction`、`ApiUsageRecord`、`CreditPricing`、`CreditPackage`

## 多形态积分基础层（2026-04-08）
- 新增 `backend/src/credits/credit-lot-policy.ts`：提供积分批次（lot）候选类型、默认扣减策略、lot 可用性过滤、优先级排序和扣减规划函数。
- 新增 `backend/src/credits/credit-lot-grants.ts`：提供充值、管理员补发、新用户注册赠送等“永久 lot”构建函数。
- 新增 Prisma 模型基础设施：
  - `CreditLot`：表示一批具有同一来源/有效期规则的积分，支持 `permanent`、`fixed_window`、`membership_bound` 三类生命周期。
  - `CreditConsumePolicy`：表示扣减优先级策略，支持按生命周期、来源、scope specificity 等规则排序。
- `CreditTransaction` 补充 lot / policy 审计字段：
  - `creditLotId`
  - `consumePolicyCode`
  - `consumePolicyVersion`
- `CreditsService.preDeductCredits` 已切到 hybrid lot 扣减：
  - 先按 `CreditLot` + consume policy 排序扣减
  - 若历史余额尚未 lot 化，则剩余部分走 `legacy_balance` 兜底
  - 交易流水 metadata 记录 `deductions`
- `CreditsService.refundCredits` 已支持按原 `deductions` 恢复 lot 剩余额度，并保留 legacy balance 回补。
- 已接入的发放链路：
  - `PaymentService.processPaymentSuccess`：充值成功后创建 `sourceType=recharge` 的 permanent lot。
  - `CreditsService.adminAddCredits`：管理员补发积分时创建 `sourceType=manual` 的 permanent lot。
  - `CreditsService.getOrCreateAccount`：首次使用时初始化 `CreditAccount`；不再发放“新用户注册赠送积分”，免费用户额度改由月度补发链路提供。
- 已接入的限时链路：
  - `CreditsService.claimDailyReward`：免费用户签到创建 `sourceType=gift` + `validityType=fixed_window` 的 lot；付费用户签到创建 permanent lot。
  - `CreditsService.cleanupExpiredDailyRewards` 现阶段仅用于清理/兼容历史签到过期数据；新签到积分已不再写入固定时效窗口。
  - `CreditsService.getExpiringCredits` 现阶段主要兼容历史签到过期数据展示；新签到积分不再通过固定到期时间失效。
- consume policy：
  - 新增 `CreditConsumePolicy` 表，并在 migration 中初始化 `global_default`
  - 当前 `CreditsService` 先读取 `global_default`，缺失时回退内置默认策略
  - 内置默认优先级已调整为与定价策略一致：`月卡积分(subscription)` -> `赠送积分(gift)` -> `固定积分(recharge/manual)`；同类 lot 内再按过期时间和发放时间排序。
- 会员 P0 最小闭环：
  - 新增 `MembershipPlan`、`UserMembershipSubscription`、`MembershipEntitlementSnapshot` 三张基础表。
  - `PaymentOrder` 扩展支持 `orderType=membership`、`membershipPlanId`、`subscriptionId`、`planSnapshot`。
  - 新增 `MembershipService.activatePaidMembershipOrder`：支付成功后激活/续期订阅、upsert 权益快照，并发放 `sourceType=subscription` + `validityType=membership_bound` 的 lot。
  - 新增 `GET /api/payment/membership-plans`，以及会员订单创建校验：金额必须匹配已启用套餐，会员订单 `credits` 固定为 `0`。
- 会员 P1 到期收口：
  - 新增 `MembershipSchedulerService`，按小时扫描已过期订阅。
  - `MembershipService.expireElapsedMemberships()` 会把到期订阅标记为 `expired`，将关联的 `membership_bound` lot 归零并写入 `membership_expire` 流水，同时把权益快照回落到 `free/inactive`。
- 会员 P1 权益调度：
  - `CreditsService.issueFreeUserMonthlyQuotaCredits()` 会按 `membershipRefreshCycleDays` 为非会员用户发放 `freeUserMonthlyQuotaCredits`，lot 类型为 `sourceType=subscription` + `validityType=fixed_window`，并记录 `free_monthly_quota` 流水；按用户注册时间锚定周期、按周期幂等。
  - 免费用户月度额度过期后会清零剩余额度并同步扣减账户余额，记录 `free_monthly_quota_expire` 流水；发放新周期前会先清理旧周期额度，定时清理任务也会兜底扫描过期额度。
- `MembershipService.issueDailyMembershipGiftCredits()` 保留为历史兼容入口，但当前产品策略已停用自动每日赠送；会员套餐中的 `dailyGiftCredits` 现用于“每日签到基础积分”，而不是定时直接入账。
  - `MembershipService.decayDailyGiftCredits()` 会在 `pauseGiftDecay=false` 时，对 `sourceType=gift` + `validityType=permanent` 的 lot 执行每日衰减，并记录 `gift_decay` 流水；衰减值改为读取 `SystemSetting[membership_credit_policy].dailyGiftDecayCredits`。
  - `MembershipService.refreshYearlySubscriptionQuotaLots()` 会为 `periodType=yearly` 的活跃订阅补发按配置窗口计算的月度额度，并记录 `membership_refresh` 流水；窗口天数来自 `membershipRefreshCycleDays`。
- `MembershipSchedulerService` 新增每日 2 点免费用户月度额度发放任务、每日 2 点赠送衰减任务、每日 4 点年费会员月度额度刷新任务；原每日 5 点会员自动赠送任务已停用。签到业务日切点单独按 `3AM` 计算，形成“先衰减、再开放新一天签到”的顺序。
- 会员读接口：
  - 新增 `GET /api/membership/current`：返回当前活跃订阅、当前套餐摘要和权益快照。
  - 新增 `GET /api/membership/entitlement`：返回当前权益快照；无快照时回退为 `free/inactive`。
- 后台策略配置：
  - 新增 `backend/src/business-policy/business-policy.service.ts`，统一读取/归一化 `membership_credit_policy`。
  - 新增 `GET /api/admin/membership-credit-policy` 与 `POST /api/admin/membership-credit-policy`。
  - 新增 `GET /api/admin/membership-plans`、`POST /api/admin/membership-plans`、`PATCH /api/admin/membership-plans/:id`，用于后台会员套餐管理。
  - `PaymentService.processPaymentSuccess` 和 `CreditsService.adminAddCredits` 现在会读取 `fixedCreditExpireDays`，将充值/手工补发 lot 生成为 `fixed_window` 或 `permanent`。
  - `CreditsService.issueFreeUserMonthlyQuotaCredits` 会读取 `freeUserMonthlyQuotaCredits` 与 `membershipRefreshCycleDays`。
- `CreditsService.claimDailyReward` 现在会读取 `dailyRewardCredits`（免费）或当前会员套餐 `dailyGiftCredits`（活跃 VIP，且不叠加免费签到额度，含 `vip_69`），新签到积分统一写入 `sourceType=gift` + `validityType=permanent` 的 lot；普通用户会参与 `gift_decay`，活跃会员期间因 `pauseGiftDecay=true` 不衰减；第 7 天按倍率发放。
- `ReferralService.getCheckInStatus/checkIn` 现仅作为前端推广页签到入口的兼容壳层，底层状态与发奖统一复用 `CreditsService.canClaimDailyReward/claimDailyReward`；自动签到与手动签到不再各自维护独立逻辑，避免同一天重复发放。
- `CreditsService.adminAddCredits` 的正向加积分现已改为进入 `gift` 池，与定价策略“后台管理员操作积分视为赠送积分”一致。
- 尚未接入的链路：
  - 更细粒度 scope 策略（service/provider/model 级命中）
  - 月付会员自动续费
  - 前端会员页 / 支付页 / 弹窗统一接入套餐配置
  - lot 级对账与迁移回填工具

## 2026-04-12 Tencent Banana Pricing Update
- `credits.service.ts` now applies a Tencent-only pricing matrix for Banana image services (`channel/channelHint/executionChannel/providerChannel = tencent`).
- Pricing matrix: Fast `1K=30`; Pro `1K/2K/4K=90/100/170`; Ultra `0.5K/1K/2K/4K=30/50/70/110`.
- This override is limited to Tencent channel requests and does not affect non-Tencent Banana routes.

## 2026-04-15 Membership Check-In Alignment
- Frontend app entry no longer auto-claims daily reward on login/app bootstrap; users must manually check in.
- Membership plan `dailyGiftCredits` is treated as the paid-tier daily check-in base credits, not an automatically issued daily gift quota.
- `vip_69` is aligned with the same rule path as other paid tiers for check-in reward resolution.

## 2026-04-13 Pre-Deduct Idempotency
- `CreditsService.preDeductCredits` now accepts `idempotencyKey` and optional `idempotencyWindowMs`.
- Duplicate requests in a short time window are deduplicated by `idempotencyKey` (primary) and request fingerprint (fallback), and reuse existing `apiUsageId`/spend transaction instead of creating a new charge.
- Dedup metadata (`idempotencyKey`, `requestFingerprint`) is persisted in `ApiUsageRecord.requestParams` for audit and troubleshooting.
- `AiController.withCredits`, `POST /api/ai/generate-video-provider`, and `POST /api/video-gif/convert` now propagate idempotency keys into credits pre-deduct.
- `main.ts` CORS allowlist now includes `idempotency-key`/`x-idempotency-key`/`x-request-id`, so browser preflight for idempotent requests no longer fails with frontend `Failed to fetch`.

## 2026-04-13 Banana Route Billing Consistency
- `AiController.buildCreditRequestParams` now writes explicit billing `channel` from `bananaImageRoute` (`normal => apimart`, `stable => tencent`) before pre-deduct.
- `CreditsService.normalizeChannel` and `AiController.normalizeChannelName` now normalize `nano2` to `apimart` (no longer treated as Tencent).
- Tencent Banana matrix resolution now gives highest priority to explicit route: `stable` always Tencent pricing matrix, `normal` always non-Tencent pricing matrix.
- Current flat text-side pricing follows the latest table: `gemini-text = 2`、`gemini-prompt-optimize = 5`、`gemini-tool-selection = 2`; these no longer vary by Banana route.
- `storyboardSplit` is treated as a local split node and should stay free in public/admin node config output.
- Banana stable-route Ultra pricing is `0.5K=30`、`1K=50`、`2K=70`、`4K=110`.
- Pre-deduct dedup now uses `idempotencyKey` as the sole primary key when present; `requestFingerprint` fallback is only used when idempotency key is absent, avoiding accidental merge of two user-initiated consecutive runs.
- Frontend image request adapter now writes latest Banana route into `providerOptions` per-request (runtime store value first, persisted value fallback), reducing stale-route charging when users switch route and trigger run quickly.
- Backend CORS allowlist now includes `x-banana-image-route` so request-side route header can pass browser preflight in cross-origin dev.
