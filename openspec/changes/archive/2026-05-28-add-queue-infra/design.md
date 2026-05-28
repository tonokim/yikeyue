## Context

`add-infra-foundation`（#1）已建立 Hono 运行时、`AppContext`、Pino 日志、普通 `ioredis` 客户端（幂等/限流用）与 testcontainers 测试基线。本 change 在其之上加一条**异步任务能力线**：BullMQ 队列 + 独立 worker 进程。它是 #3（微信订阅消息）、#4（孤儿清理）、#6（爽约检测/预约提醒）、#9（试用到期提醒）等的共同依赖。

约束来自 cross-cutting §12（异步任务）与 §11（Job 日志）：队列命名 `<capability>:<job-kind>`、payload 走 Zod、jobId 幂等、重试退避、死信扫描、worker 独立进程、SIGTERM 30s 优雅退出。同时受 §13 约束：**MVP 阶段 job 内触发其他能力副作用一律直接函数调用，严禁在 job 里 publish 事件**。

## Goals / Non-Goals

**Goals:**

- 可 `pnpm dev:worker` 起独立 worker 进程，与 server 同镜像不同 entry。
- 一套调度 API（立即/延迟/定时）+ `JobContext`（log/now/db），让后续 capability 只写「队列定义 + 处理器」。
- 固化命名、payload、幂等、重试、死信、graceful shutdown 约定。
- 队列测试 harness：真 Redis + 真 worker、手动驱动、fake timers、死信验证。
- demo `ping` 队列证明闭环（phase 1 验收）。

**Non-Goals:**

- 业务队列与处理器（各自 capability）。
- 真实 ops 告警渠道（只打 error 日志 + 预留 hook）。
- RabbitMQ / 事件总线（阶段 13）；job 内严禁 publish 事件。
- 具体批处理 job 实现。

## Decisions

### D1：BullMQ 专用 Redis 连接，独立于 #1 的 ioredis 客户端

BullMQ 要求连接设 `maxRetriesPerRequest: null`、且其阻塞命令会独占连接，不能和幂等/限流的普通 `ioredis` 客户端共用。故本 change 引入 BullMQ 专用连接工厂。二者连同一个 Redis 实例但用不同连接配置。
**Alternative（已否决）**：复用 #1 的 ioredis 单连接。否决理由：BullMQ 的 blocking pop 会卡住共享连接，破坏幂等/限流。

### D2：`JobContext` 与 `AppContext` 平行，但 db 不是事务句柄

job 不是 HTTP 请求，没有「请求事务」语义。`JobContext` 提供 `log`（绑定 `queue`/`job_id`/`attempt`）、`now`（可注入，测试固定）、`db`（连接池上的 Drizzle 实例）。job 若需要事务自己开 `db.transaction()`。测试时可注入 fake clock 与（如需要）事务作用域 db。
**理由**：复用 #1 的可注入时钟/可注入 db 思路，保持「业务代码不碰 `new Date()`、不碰全局 db」的一致性（cross-cutting §6）。

### D3：调度 API 三形态——enqueue / schedule(delay) / repeatable(cron)

- `enqueue(queue, payload, opts)`：立即。
- `schedule(queue, payload, delayMs, opts)`：延迟（预约前提醒、试用到期提醒）。
- `repeatable(queue, payload, cron, opts)`：定时（死信扫描、日/月聚合）。
调度 API 统一负责：用业务 key 设 `jobId`（幂等）、按 job 类型套重试策略、入队前用 Zod 校验 payload（早失败优于消费端失败）。

### D4：payload 在 packages/shared 定义 Zod schema，消费端二次 parse

payload schema 与 API schema 一样住 `packages/shared`，前后端/调度端/消费端共用同一份。worker 消费时先 `parse`，不合法直接判失败 → 最终进死信。入队端也校验一次（早失败）。
**理由**：和 #1 的「Zod 在边界」一致；防止脏 payload 在队列里反复重试。

### D5：重试策略按 job 类型分档

| 类型 | attempts | 退避 | 说明 |
|---|---|---|---|
| 默认 | 3 | 指数 2s/8s/32s | 一般副作用 |
| 外部 API（微信/七牛） | 5 | 指数 | 网络抖动容忍 |
| DB 写入类 | 1（不重试） | — | 失败先排查再重放，避免脏写放大 |

调度 API 暴露类型档位，调用方选档，不各自手填。

### D6：死信处理——BullMQ 原生 failed 集合 + 每日扫描 + error 日志 + alert hook

超过 attempts 的 job 进 BullMQ 原生 `failed` 集合（即 cross-cutting §12 的 `<queue>:failed`）。每日 repeatable 死信扫描 job 遍历各队列 `getFailed()`，逐条打 `error` 日志（§11 约定 error 触发告警），并调用可插拔 `alert(failedJobs)` hook。MVP 的 hook 实现为空/仅日志，真实渠道（webhook/邮件）后置。
**理由**：MVP 无 ops 告警渠道；error 结构化日志是最小可用告警面，hook 留扩展点避免日后改扫描逻辑。

### D7：Graceful shutdown——SIGTERM → worker.close(30s) → 强退

worker 进程注册 SIGTERM/SIGINT handler：调用 BullMQ `worker.close()` 停止领新 job、等在途 job 完成；设 30s 超时兜底，超时强制 `process.exit`。
**理由**：cross-cutting §12 明确要求；保证滚动部署不丢在途 job。

### D8：测试用 fake timers 驱动延迟 job，禁止 sleep

延迟/定时 job 测试使用短真实延迟 + 订阅 Worker `completed` / `failed` 事件的事件驱动方式来验证任务执行与副作用；死信用必失败 job 跑完 attempts 后断言进 `failed`。Redis 沿用 #1 的 `test:<fileId>:` 前缀隔离。

## Risks / Trade-offs

- **BullMQ + testcontainers Redis 在 CI 偶发慢/抖动** → 复用 #1 的 globalSetup 共享 Redis 容器；测试使用 Worker 事件驱动订阅（如 `worker.on('completed')`）来等待任务结束，避免使用 `setTimeout` 盲等或轮询，减少时序脆弱。
- **fake timers 与 BullMQ 内部定时器交互复杂**（BullMQ 使用 Redis 的延迟集合存储任务，其执行依赖 Redis 服务端时间，mock 本地 Date.now() 会导致 Redis 状态不一致）→ 测试采用短真实时间（150ms 级别延迟）配合 Worker 事件订阅机制，实现高效率、无盲等测试。
- **demo ping 队列可能被误当业务队列复用** → 命名为 `infra:ping` 并在代码注释标注「仅供闭环验证，勿挂业务」。
- **重试档位被滥用**（DB 写入类误配重试）→ 调度 API 用显式档位枚举而非裸 attempts 数字，降低误用。
- **job 内偷偷 publish 事件 / 循环依赖** → 评审守则：job 内只「执行」，触发其他能力副作用直接调函数（§13）；禁止为解耦在 job 里发事件。

## Migration Plan

依赖 #1 已落地。落地顺序：BullMQ 专用连接 → queue/worker 封装 + `JobContext` → 调度 API（enqueue/schedule/repeatable）→ payload schema 约定（shared）→ 重试档位 → 死信扫描 + alert hook → graceful shutdown → demo `infra:ping` 队列 → 队列测试 harness → `pnpm dev:worker` 脚本与部署 entry。生产新增一个 worker container（同镜像、worker entry）。无存量数据、无回滚需求。

## Open Questions

- 真实 ops 告警渠道（webhook/邮件/IM 机器人）的选型与接入时机——本 change 只留 `alert` hook，需后续单独决定。
- 批处理（日/月聚合）的并发与资源隔离策略——随门店/运营后台 dashboard capability 再评估。
