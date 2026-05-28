## Why

易可约后端尚无任何代码，仅有规划文档。所有后续 capability（身份、门店、排班、订单……）都依赖一套统一的地基：Hono 运行时、Drizzle 数据访问、Pino 日志、全局中间件、以及一个能跑真实 PostgreSQL/Redis 的测试基础设施。这套地基把 [cross-cutting-rules.md](../../cross-cutting-rules.md) 里的横切约定（时间/时区、错误码、日志、测试金字塔）**第一次落成可运行的代码与约定**，让后面 40 个 change 都站在同一套契约上。先做地基是因为它是整张依赖图的根节点，缺了它任何业务 change 都无法 `apply`。

## What Changes

- 初始化 pnpm workspace 单仓骨架，本次只落 **`apps/server` + `packages/shared`** 两个真实包（前端三端骨架本次不做，见 Non-goals）。
- `apps/server` 起 Hono HTTP 服务，提供 `/health`（含 DB + Redis 连通性探测）。
- 建立 **request context（`AppContext`）** 形状：`ctx.now`（注入式时间）、`ctx.requestId`、`ctx.log`（child logger）、`ctx.user`（JWT 解析结果，可空）、`ctx.db`（**可注入的事务句柄**，供测试按请求绑定独立事务）。
- 全局中间件栈（按顺序）：`request_id` → `logger` → `error`（`BizError` → 统一响应封装 + HTTP 状态码映射）→ `jwt`（**仅校验**，签发留给 auth change）→ `rate_limit`（按 identity + endpoint 维度，基于 Redis，超限返回 429 `rate_limit.exceeded`，**按路由 opt-in**）→ `zod 校验`（在边界 `.transform()` 做 snake_case ↔ camelCase，**逐 schema 显式手写**，不做通用 codec）→ `idempotency`（基于 Redis，TTL 24h）。
- `infra-db`：Drizzle 配置 + 迁移目录 + cuid2 主键生成 + 时间/时区约定（`timestamptz` 全 UTC、`_local` 字段按 `Asia/Shanghai`）+ **金额整数分约定（`*_cents` 整型 + `currency`，禁止浮点）** + seed 入口；db 句柄经 `ctx` 注入而非全局单例。
- `infra-log`：Pino 初始化（生产 JSON / 本地 pretty）、`request_id` 绑定 child logger、redact 脱敏规则、日志级别约定；CI 加 lint 规则禁止 `console.log`。
- `packages/shared`：Zod 基础设施、统一响应类型（`{request_id, data}` / `{request_id, error}`）、横切错误码常量（cross-cutting §10）、分页/幂等相关共享类型。
- Docker Compose 起本地 PostgreSQL 16 + Redis。
- 测试基础设施：Vitest + testcontainers（真起 PG + Redis）、**每文件独立 schema + 每用例 BEGIN/ROLLBACK 隔离**、API 集成测试 client/harness、契约测试骨架、coverage 门槛配置（line ≥ 80% / branch ≥ 70% / function ≥ 80%）。
- CI：lint（含 no-console）+ typecheck + test + coverage 门槛，低于门槛构建失败。

> 本 change **实现**而非**修改**横切规则（§6 时间、§10 错误码、§11 日志、§14 测试），因此无需 ⚠️ 横切规则变更标注。

## Capabilities

### New Capabilities

- `infra-db`: Drizzle 配置与客户端、迁移机制、cuid2 主键、时间/时区约定（UTC `timestamptz` + `_local`）、**金额整数分约定（`*_cents` 整型列 + `currency`，禁止浮点）**、seed；db 句柄经 `ctx` 注入以支持测试事务隔离；配套 PG testcontainer + 每文件 schema + 每用例事务回滚的测试基线。
- `infra-log`: Pino 结构化日志、`request_id` child logger、redact 脱敏、日志级别与上下文字段约定、禁用 `console.*`。
- `infra-api`: Hono 运行时、`AppContext` 形状、全局中间件栈（request_id / error+BizError / jwt 仅校验 / **rate_limit 限流** / zod 边界 transform / 响应封装 / idempotency）、`/health`、Redis 客户端（供幂等与限流使用）、API 集成测试 harness。

### Modified Capabilities

（无。`openspec/specs/` 当前为空，本 change 是首个落地的能力，不修改任何既有 spec。）

## Impact

- **新增代码**：`apps/server/src/{db,logger,index.ts,health,middleware}`（middleware 含 `rate-limit`）、`packages/shared/src/{errors,response,pagination,zod,money}`（`money` 为整数分约定与工具）、`apps/server/tests/{integration,contract,factories}`、`apps/server/drizzle.config.ts`。
- **新增配置/工具**：根 `pnpm-workspace.yaml`、`package.json`、`tsconfig` 基线、`docker-compose.yml`（PG + Redis）、`vitest.config.ts`（testcontainers globalSetup）、CI workflow、ESLint（no-console）。
- **依赖**：Hono、Drizzle ORM + drizzle-kit、`@paralleldrive/cuid2`、Zod、Pino + pino-pretty、`ioredis`、`jose`（JWT 校验）、`pg`、Vitest、`testcontainers`。
- **横切契约落地**：cross-cutting §6/§10/§11/§14 的代码与约定从此 change 起生效，后续 change 必须复用本 change 建立的 `AppContext`、`BizError`、响应封装、测试 harness，不得另起一套。
- **下游解锁**：`add-queue-infra`（#2）、`add-wechat-integration`（#3）、`add-qiniu-storage`（#4）及之后所有 capability。

## Non-goals

- **不做前端三端骨架**：`apps/weapp`（unibest）、`apps/store-admin`、`apps/admin`（vue-pure-admin）本次不脚手架。理由：phase 1 验收纯后端，且两套脚手架重量级、与 workspace/`shared` 的集成需单独验证。三端骨架拆为后续独立 change（建议在各自端首个页面 change 之前补一个 `add-weapp-scaffold` / `add-admin-scaffold`）。⚠️ 这是对 [propose-list.md](../../../propose-list.md) #1「4 app + 1 package 骨架」描述的**有意收窄**。
- **不做 BullMQ / worker 进程**：队列封装、`pnpm dev:worker` 入口归 `add-queue-infra`（#2）。本 change 只引入 Redis 客户端供幂等中间件使用。
- **不做微信 / 七牛**：登录、订阅消息、支付、对象存储分别归 #3 / #4。
- **不做 JWT 签发**：本 change 只提供 `jwt` 校验中间件；签发逻辑随 `auth-weapp` / `auth-admin` 落地。为可测性会提供一个**仅测试用**的 token 铸造 helper。
- **不做 RabbitMQ / 事件总线**：阶段 13 才引入，本 change **严禁**预留任何「假事件接口」。
- **不引入 Kysely**：复杂 SQL 一律用 Drizzle 的 `sql` 模板。
- **不做业务表**：本 change 只建迁移机制与时间/ID 约定，不建 `user`/`store`/`order` 等业务表（各自 capability 自带迁移）。
