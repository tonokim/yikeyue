## Why

大量后续 capability 依赖异步任务能力：会员试用到期提醒、预约前提醒、爽约自动检测、微信订阅消息发送、七牛孤儿文件清理。这些都需要一套统一的 BullMQ 地基——队列封装、独立 worker 进程、调度 API、重试/幂等/死信约定、graceful shutdown 与测试 harness。本 change 把 [cross-cutting-rules.md §12](../../cross-cutting-rules.md) 的异步任务约定落成可运行代码，让后续 change 只需「定义自己的队列 + 处理器」，不再各自造轮子。它依赖 `add-infra-foundation`（#1）建立的日志、Redis、`ctx` 注入与测试基线。

## What Changes

- 新增 `apps/server/src/queue` 模块：BullMQ `Queue`/`Worker` 封装、**BullMQ 专用 Redis 连接**（`maxRetriesPerRequest: null`，独立于 #1 幂等/限流用的 `ioredis` 客户端）。
- 新增 **worker 进程入口 `pnpm dev:worker`**：只跑 BullMQ workers、不监听端口；与 server 同一份代码、同一 Docker 镜像、不同 entry。
- 调度 API 封装：`enqueue`（立即）、`schedule`（延迟 delay）、`repeatable`（定时 cron），统一构造并注入 **`JobContext`**（`log`/`now`/`db`），与 #1 的 `AppContext` 平行。
- `JobContext`：在 job 起点用 child logger 绑定 `job_id`/`queue`/`attempt`（cross-cutting §11 的 Job 日志字段），注入 `now`（可测）与 `db` 句柄；下游 job 代码用 `ctx.log`，不自行拼接。
- **队列命名约定** `<capability>:<job-kind>`（全小写连字符）。
- **Job payload Zod schema 约定**：payload schema 定义在 `packages/shared`，worker 消费前先 `parse`，不合法直接进死信。
- **Job 幂等**：用业务 key 作 `jobId`，重复入队自动去重。
- **重试策略**：默认 `attempts: 3` + 指数退避（2s/8s/32s）；外部 API 调用类放宽到 5 次；DB 写入类不重试（按 job 类型可配）。
- **死信扫描**：每日 repeatable job 扫各队列 `failed` 集合，打 **`error` 级结构化日志**（cross-cutting §11 约定 error 触发告警），并通过**可插拔 `alert` hook** 预留真实告警渠道接入点。
- **Graceful shutdown**：worker 收到 SIGTERM 停止接新 job，最多等 30s 完成在途 job，超时强制退出。
- 一个 **demo/`ping` 队列 + 处理器**：证明「调度 → worker 处理」闭环（满足 phase 1 验收）。
- **队列测试 harness**：真 Redis + 真 worker（不 mock），订阅 Worker `completed` / `failed` 事件以事件驱动方式等待任务执行完成，延迟 job 采用短真实延迟（150ms 级别），死信用「必失败 job 跑完 attempts → 断言进 `failed`」。

> 本 change **实现**而非**修改**横切规则（§11 Job 日志、§12 异步任务），无需 ⚠️ 横切规则变更标注。

## Capabilities

### New Capabilities

- `infra-queue`: BullMQ 队列封装、worker 进程入口、调度 API（立即/延迟/定时）、`JobContext`、队列命名/payload/幂等/重试约定、死信扫描 + 告警 hook、graceful shutdown、队列测试 harness。

### Modified Capabilities

（无。`infra-log`（#1）已规定 Job 日志字段，本 change 只是实现 worker 去使用，不修改其 spec；不涉及其他既有 spec。）

## Impact

- **新增代码**：`apps/server/src/queue/{connection,queue,worker,scheduler,context,dead-letter}`、worker entry（`apps/server/src/worker.ts`）、`packages/shared/src/jobs`（Job payload schema 约定 + demo ping payload）、`apps/server/tests/integration/queue`。
- **新增配置/脚本**：`pnpm dev:worker` 脚本、worker 的 docker-compose/部署 entry 说明。
- **依赖**：`bullmq`（自带/复用 `ioredis`，用 BullMQ 专用连接配置）。
- **横切契约落地**：cross-cutting §12 的命名、payload、幂等、重试、死信、worker 进程约定从此 change 起生效；后续 change 必须复用本 change 的调度 API、`JobContext` 与测试 harness，不得另起一套。
- **下游解锁**：`add-wechat-integration`（#3，`notify:wechat-subscribe`）、`add-qiniu-storage`（#4，`storage:orphan-cleanup`）、`add-order-state-machine`/`add-no-show-per-store`（#17/#18，`order:reminder`/`order:no-show-detect`）、`add-membership-trial`（#28，`membership:trial-expiry-notice`）。

## Non-goals

- **不定义业务队列**：`notify:*`、`order:*`、`membership:*`、`storage:*` 等队列与处理器由各自 capability 建。本 change 只建框架 + demo `ping` 队列。⚠️ 这是与 #1「spine only」一致的有意收窄。
- **不接真实 ops 告警渠道**：死信扫描只打 `error` 日志 + 预留 `alert` hook；真实渠道（webhook/邮件等）后置。
- **不做 RabbitMQ / 事件总线**：阶段 13（#42）才引入。本 change **严禁**在 job 内 publish 事件——job 内触发其他能力副作用一律**直接函数调用**（cross-cutting §13）。
- **不实现具体批处理 job**：框架支持 repeatable/批处理，但具体的日/月聚合 job 随对应后台 capability 落地。
- **不做跨能力解耦用途的队列**：MVP 单服务，跨能力调用走直接函数调用，不为「解耦」引入队列。
