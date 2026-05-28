## Context

易可约后端是一个 greenfield 仓库，当前只有规划文档。本 change 落地整张依赖图的根节点：Hono 运行时 + Drizzle + Pino + 全局中间件 + 真容器测试基础设施。它一次性把 [cross-cutting-rules.md](../../cross-cutting-rules.md) 的 §6（时间）、§10（错误码）、§11（日志）、§14（测试）从「文字约定」变成「可运行代码」。之后 40 个 change 都复用本 change 建立的 `AppContext`、`BizError`、响应封装、测试 harness，因此这里的几个结构性决策一旦定型、改动成本极高，需要在编码前想清楚。

约束来自三份根文档：单服务不上微服务、只用 Drizzle 不引入 Kysely、阶段 13 前严禁预留事件接口、API JSON snake_case / TS camelCase / Zod 边界 transform、所有 ID 字符串、时间 UTC `Z`、金额整数分。

## Goals / Non-Goals

**Goals:**

- 可本地 `pnpm dev:server` 起 Hono 服务，`/health` 探测 PG + Redis。
- 固化 `AppContext` 形状与依赖注入方式，使时间、db、日志、用户身份全部可注入、可测。
- 全局中间件栈成型：request_id / error+BizError / zod 边界 transform / jwt 仅校验 / 响应封装 / idempotency。
- 测试基础设施成型：testcontainers 真起 PG+Redis、每文件独立 schema、每用例事务回滚、API 集成 harness、契约测试骨架、coverage 门槛。
- CI 跑通 lint（no-console）+ typecheck + test + coverage 门槛。

**Non-Goals:**

- 前端三端（weapp / store-admin / admin）骨架——拆为后续独立 change（对 propose-list #1 的有意收窄）。
- BullMQ / worker 进程（#2）、微信（#3）、七牛（#4）。
- JWT 签发、业务表、RabbitMQ、Kysely。

## Decisions

### D1：本仓只落 `apps/server` + `packages/shared`（其余 app 后置）

phase 1 验收纯后端；unibest 与 vue-pure-admin 都是重量级脚手架，且能否干净地从 `packages/shared` import（uni-app 的 Vite 管线 + workspace symlink）需要单独验证。把三端脚手架塞进 #1 会显著放大风险与体积，却不被 phase 1 验收触及。
**Alternative（已否决）**：propose-list 字面意义的「4 app 骨架」。否决理由：增大 #1 体积与失败面，收益（仅占位空目录）极低。
**代价**：workspace 的最终目录形状（4 app）要到后续 change 才完整成型；接受。

### D2：app 用工厂函数构造，依赖显式注入——`createApp({ db, redis, clock, jwtSecret })`

这是支撑「可测性」的核心决策。`AppContext` 的 `now` / `db` 在生产取真实时钟与连接池，在测试取固定时钟与事务作用域句柄。通过工厂注入而非模块级全局 import，让测试无需 mock 即可替换时间与数据库。
- `clock()` → `ctx.now`：生产为 `() => new Date()`，测试传固定值。业务层只读 `ctx.now`，从根上杜绝 `new Date()`（cross-cutting §6）。
- `db` → `ctx.db`：生产为连接池上的 Drizzle 实例；测试为「绑定到单条连接的事务内」的 Drizzle 实例（见 D5）。
**Alternative（已否决）**：模块级 `export const db = drizzle(pool)` 全局单例。否决理由：无法为单个测试绑定独立事务，回滚隔离破功，只能退化为「测试间 truncate」，慢且易串数据。

### D3：集成测试用 Hono in-process `app.request()`，不起真实网络端口

用 Hono 内建的 fetch 风格测试入口直接打 app，省去监听端口、避免端口竞争，并让「per-test 注入 db/clock」变得简单（测试用注入了事务句柄与固定时钟的 `createApp(...)` 实例发起请求）。
**Alternative（已否决）**：起真实 HTTP server + supertest。否决理由：端口管理 + 注入 per-request 上下文更别扭，收益不大（MVP 不做 E2E）。

### D4：中间件顺序固定

```
request_id  →  logger  →  error(onError)  →  jwt(parse)  →  [rate_limit]  →  zod(validate+transform)  →  [idempotency]  →  handler
```
- `request_id` 最先：后续所有日志/响应都要带它。
- `logger` 紧随：绑定 child logger 到 `ctx.log`。
- `error` 用 Hono 的 `app.onError` 统一兜底：`BizError` → 映射状态码 + 统一错误体；非 `BizError` → 500 + `error` 级日志，不泄露堆栈。
- `jwt` 仅 parse：带 token 则填 `ctx.user`，不带/无效则 `ctx.user=null`，**不在此拦截**；拦截交给路由级 `requireAuth` 守卫（返回 `auth.unauthorized` 401）。这样 `/health`、公开 endpoint 无需特殊豁免。
- `rate_limit` 排在 `jwt` 之后、`zod` 之前：放在 jwt 后才能按 `ctx.user` 限流（未登录退化为 IP）；放在 zod/handler 前以便在解析 body、执行业务前就挡掉超额请求。**按路由 opt-in**，不全局，且不挂 `/health`。
- `idempotency` 只挂在标注幂等的写 endpoint 上，不全局。

### D5：测试事务回滚的具体机制

每个测试函数：从 PG 连接池取一条**专用连接** → `BEGIN` → 用该连接构造 Drizzle 实例作为注入的 `ctx.db` → 跑用例 → `ROLLBACK` → 释放连接。嵌套事务用 SAVEPOINT。每个测试**文件**在 `beforeAll` 建 `test_<fileId>` schema 跑迁移、`afterAll` drop。Redis 用 `test:<fileId>:` 前缀隔离，`afterAll` 清理。
**关键约束**：这要求 D2（db 经 ctx 注入）成立；二者绑定。

### D6：snake/camel 转换逐 schema 显式手写，不做通用 codec

cross-cutting 要求边界 transform。显式 `.transform()` 把字段映射写在 schema 文件里，类型漂移可见、易调试；通用自动 codec 虽 DRY 但对缩写词、嵌套 key 容易产生意外，且把映射藏进黑盒。
**Alternative（已否决）**：通用 snake↔camel 递归 codec。否决理由：隐式、边界 case 多、排错难。
**代价**：每个 schema 多写 transform 样板；接受（换来显式与可调试）。

### D7：JWT 用 `jose`、HS256、仅校验

本 change 不签发；提供校验中间件 + **仅测试用**的 token 铸造 helper（让集成测试能造受保护请求）。签发随 `auth-weapp`/`auth-admin` 落地。RBAC `requireRole`（cross-cutting §9）也留给 `auth-admin`，本 change 只提供「是否登录」的 `requireAuth`。

### D8：Redis 客户端在本 change 引入（独立于 BullMQ）

幂等中间件需要 Redis，但 BullMQ 封装是 #2。Docker Compose 本就起 Redis，故本 change 引入一个普通 `ioredis` 客户端供幂等使用；#2 的 BullMQ 用自己的连接配置。二者不耦合。

### D9：响应封装与错误码常量住在 `packages/shared`

`{request_id, data}` / `{request_id, error}` 的类型、分页类型、横切错误码（`auth.unauthorized`、`validation.invalid_input`、`idempotency.replay`、`rate_limit.exceeded` 等）定义在 `packages/shared`，前后端共用，避免错误码字符串散落与重名。

### D10：数据库与时间/金额约定

主键 `id` = cuid2 字符串；外键 `<entity>_id`；表名单数。时间字段 `_at` 后缀、`timestamptz` 存 UTC；每日时段用 `time` 类型按 `Asia/Shanghai` 解释；本地日期 `_local` 后缀。**金额统一整数分**：字段 `*_cents` 整型 + 配套 `currency`（MVP 固定 `CNY`），禁止浮点；`infra-db` 提供金额 column helper 与 `packages/shared` 的金额工具，统一该约定。本 change 只建迁移机制 + 约定 + 一张可选的探活/示例迁移，不建业务表。
> ⚠️ PRD §9 ER 图把 `price`/`amount` 标为 `float`，与 project.md「金额整数分」冲突；以 project.md 为准，下游 `service-item`(#8)、`membership-payment`(#29) 建表时一律用 `*_cents` 整型，不得跟随 PRD 的 float。

### D11：限流策略

限流用 Redis 实现（复用 D8 的 `ioredis` 客户端），采用**固定/滑动窗口计数**（`ratelimit:<endpoint>:<identity>` + TTL），按路由 opt-in 配置「窗口 + 阈值」。标识优先取 `ctx.user`，未登录取客户端 IP。超限返回 429 `rate_limit.exceeded` + `Retry-After`。
**理由**：PRD §10.2 明确要求「接口限流」，cross-cutting §10 已预留 `rate_limit.exceeded`，但此前无任何 capability 产出它；限流是横切、需 Redis（#1 已具备），与 idempotency 同属 opt-in 写/读保护中间件，放地基最省事，避免日后跨大量路由补限流。
**Alternative（已否决）**：放到网关层（Nginx/Kong）。否决理由：project.md 锁定单服务、无网关；且应用内限流才能按 `ctx.user` 精细控制。

## Risks / Trade-offs

- **testcontainers 在 CI 慢/需 Docker** → 用 globalSetup 全程共享一组容器（不每文件起容器）；CI runner 选支持 Docker 的镜像；本地可跑。
- **事务回滚隔离与连接池冲突**（池里多连接，事务必须绑定同一条）→ D5 强制每测试取专用连接并以该连接构造 Drizzle 实例；禁止测试中走全局池。这是 D2/D5 绑定的根因。
- **bootstrap 代码难达 80% coverage**（大量是配置胶水）→ 中间件（request_id/error/idempotency/zod）本身可测且应测；coverage 豁免 `db/migrations`、`packages/shared`（纯类型）、生成代码（cross-cutting §14）。
- **JWT 校验中间件无签发方，端到端难测** → D7 提供仅测试用的 token 铸造 helper，集成测试可造受保护请求。

## Migration Plan

Greenfield，无存量数据、无回滚需求。落地顺序：workspace + 工具链 → `packages/shared` 基础类型/错误码 → `infra-db`（Drizzle + 迁移 + ctx.db）→ `infra-log`（Pino）→ `infra-api`（中间件栈 + /health）→ Docker Compose → 测试 harness → CI。部署用单镜像，本 change 只需 server entry（worker entry 随 #2）。

## Open Questions

- 前端三端骨架的拆分与命名（建议 `add-weapp-scaffold` / `add-admin-scaffold`，在各自端首个页面 change 前置）——需用户确认放在哪个阶段。
- JWT 的 HS256 密钥来源与轮转策略——本 change 先从环境变量读单一密钥，轮转留给 auth change 评估。
