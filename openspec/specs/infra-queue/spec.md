# infra-queue Specification

## Purpose
TBD - created by archiving change add-queue-infra. Update Purpose after archive.
## Requirements
### Requirement: BullMQ 作为唯一异步任务框架

系统 SHALL 使用 BullMQ 作为唯一的延迟/定时/可重试任务框架。BullMQ SHALL 使用专用的 Redis 连接（`maxRetriesPerRequest: null`），与幂等/限流使用的普通 Redis 客户端分开配置。异步任务 SHALL 仅用于：定时/延迟任务、可重试的副作用、批处理；MUST NOT 用于跨能力解耦（MVP 单服务，跨能力走直接函数调用）或需立即同步返回的逻辑。

#### 场景：调度的 job 被 worker 处理

- **WHEN** 通过调度 API 向某队列 enqueue 一个 job 且 worker 正在运行
- **THEN** worker 接收并处理该 job，处理完成后 job 从等待集合移除

### Requirement: Worker 独立进程入口

系统 SHALL 提供独立的 worker 进程入口（`pnpm dev:worker`），该进程只运行 BullMQ workers、MUST NOT 监听 HTTP 端口。worker 与 HTTP server SHALL 为同一份代码、同一镜像的不同 entry。单个 worker 进程 SHALL 可监听多个队列，并按 capability 分组配置 concurrency。

#### 场景：worker 进程不监听端口

- **WHEN** 以 worker entry 启动进程
- **THEN** 进程运行 BullMQ workers 但不绑定任何 HTTP 端口

### Requirement: 队列命名约定

队列名 SHALL 遵循 `<capability>:<job-kind>` 格式，全小写、连字符分隔（如 `notify:wechat-subscribe`、`order:no-show-detect`）。

#### 场景：非法队列名被拒绝

- **WHEN** 用不符合 `<capability>:<job-kind>` 格式的名称注册队列
- **THEN** 注册时报错，阻止使用非法队列名

### Requirement: 调度 API 与 JobContext

系统 SHALL 提供统一调度 API，支持立即入队、延迟入队（delay）、定时重复（repeatable/cron）。每个 job 在执行起点 SHALL 获得一个 `JobContext`，至少包含：`log`（绑定 `queue`/`job_id`/`attempt` 的 child logger）、`now`（注入式当前时间）、`db`（数据库句柄）。job 处理代码 MUST NOT 直接调用 `new Date()`，当前时间 SHALL 从 `ctx.now` 取；MUST NOT 自行拼接 `job_id` 到日志。

#### 场景：job 日志带队列上下文

- **WHEN** 一个 job 在处理过程中通过 `ctx.log` 记录日志
- **THEN** 该日志包含 `queue`、`job_id`、`attempt` 字段

#### 场景：延迟 job 到期才执行

- **WHEN** 以 delay 调度一个 job
- **THEN** 在延迟时间到达前 job 不被处理，到达后被 worker 处理

### Requirement: Job payload 经 Zod 校验

Job payload 的 Zod schema SHALL 定义在 `packages/shared`，worker 消费 job 时 SHALL 先 `parse` payload；payload 不合法的 job MUST NOT 进入业务处理，SHALL 直接判为失败并最终进入死信。

#### 场景：非法 payload 直接失败

- **WHEN** 一个 job 的 payload 不满足其 Zod schema
- **THEN** worker 不执行业务逻辑，该 job 判为失败

### Requirement: Job 幂等

需要幂等的 job SHALL 使用业务 key 作为 `jobId`，使同一业务 key 重复入队被自动去重。

#### 场景：同 jobId 重复入队去重

- **WHEN** 用同一个 `jobId` 重复入队同一队列
- **THEN** 队列中只存在一个该 `jobId` 的 job，不重复处理

### Requirement: 重试与退避策略

job SHALL 支持按类型配置重试：默认 `attempts: 3` + 指数退避（约 2s/8s/32s）；外部 API 调用类（如微信、七牛）SHALL 可放宽到 5 次；DB 写入类 SHALL 可配置为不重试。

#### 场景：失败 job 按退避重试

- **WHEN** 一个配置了 `attempts: 3` 的 job 首次执行抛错
- **THEN** 该 job 按退避策略被重新调度，最多重试至 attempts 上限

### Requirement: 死信扫描与告警 hook

超过 `attempts` 仍失败的 job SHALL 进入该队列的 `failed` 集合。系统 SHALL 提供一个每日运行的死信扫描 job，扫描各队列 `failed` 集合并以 `error` 级结构化日志记录；系统 SHALL 暴露一个可插拔的 `alert` hook 作为接入真实告警渠道的扩展点（MVP 默认仅打日志，不接外部渠道）。

#### 场景：最终失败的 job 进入 failed 集合

- **WHEN** 一个必定失败的 job 跑完全部 attempts
- **THEN** 该 job 进入队列的 `failed` 集合，不再重试

#### 场景：死信扫描记录 error 日志

- **WHEN** 死信扫描 job 运行且存在 `failed` job
- **THEN** 扫描以 `error` 级别记录这些失败 job，并调用 `alert` hook

### Requirement: Graceful shutdown

worker 进程收到 SIGTERM 后 SHALL 停止接收新 job，并最多等待 30s 完成在途 job，超时后强制退出。

#### 场景：SIGTERM 后停止接新 job

- **WHEN** worker 进程收到 SIGTERM 且有在途 job
- **THEN** 进程不再领取新 job，等待在途 job 完成（最多 30s）后退出

### Requirement: 队列测试 harness

系统 SHALL 提供队列测试 harness：用真实 Redis + 真实 worker（不 mock），订阅 Worker `completed` / `failed` 事件以事件驱动方式等待任务执行，延迟 job 采用短真实延迟，死信场景可构造必失败 job 验证进入 `failed`。

#### 场景：harness 断言 job 入队

- **WHEN** 测试通过调度 API 入队一个 job
- **THEN** harness 可用 `getWaiting()` 断言该 job 存在且 payload 正确

#### 场景：harness 验证死信

- **WHEN** 测试构造一个必失败的 job 并跑完 attempts
- **THEN** harness 可断言该 job 进入 `failed` 集合

