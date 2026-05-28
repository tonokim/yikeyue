## ADDED Requirements

### Requirement: Hono 运行时与 RESTful 路径约定

系统 SHALL 以 Hono 构建 HTTP 服务，API 路径遵循 `/api/v1/<capability>/<resource>`，并按角色拆 namespace：`/api/v1/weapp/...`、`/api/v1/store-admin/...`、`/api/v1/admin/...`。HTTP server 与 worker SHALL 为同一份代码的不同 entry。

#### 场景：服务以 v1 前缀挂载路由

- **WHEN** 客户端请求 `/api/v1/weapp/...` 下的已注册 endpoint
- **THEN** 请求被路由到对应 handler 并返回，未注册路径返回 404

### Requirement: 统一请求上下文 AppContext

每个请求 SHALL 持有一个 `AppContext`，至少包含：`now`（注入式当前时间）、`requestId`、`log`（绑定 `request_id` 的 child logger）、`user`（JWT 解析结果，未登录为 null）、`db`（可注入的事务句柄）。业务与 service 层 MUST NOT 直接调用 `new Date()`，当前时间 SHALL 从 `ctx.now` 取。

#### 场景：业务层从 ctx.now 取时间

- **WHEN** 业务逻辑需要当前时间
- **THEN** 它读取 `ctx.now`，而非调用 `new Date()`

#### 场景：测试注入固定时间

- **WHEN** 测试为请求注入一个固定的 `now`
- **THEN** 该请求内所有依赖当前时间的逻辑都使用该固定值，结果可重现

### Requirement: 请求 ID 生成与回传

系统 SHALL 为每个请求生成一次 `request_id`（cuid2 加 `req_` 前缀），写入日志并通过 `X-Request-Id` 响应头回传；同时该 ID SHALL 出现在响应 body 的 `request_id` 字段中。

#### 场景：响应携带 request_id

- **WHEN** 任意请求被处理
- **THEN** 响应头包含 `X-Request-Id`，且响应 body 的 `request_id` 与响应头一致

### Requirement: 统一成功响应封装

成功响应（HTTP 2xx）SHALL 封装为 `{ "request_id": ..., "data": ... }`。系统 MUST 使用真实 HTTP 状态码，MUST NOT 「永远返回 200」。

#### 场景：成功响应结构

- **WHEN** 一个 endpoint 成功处理请求
- **THEN** 响应为 2xx 且 body 形如 `{ request_id, data }`

### Requirement: 统一错误处理与状态码映射

业务错误 SHALL 通过抛出 `BizError(code, message, { httpStatus, details })` 表达，由全局错误中间件统一序列化为 `{ "request_id": ..., "error": { code, message, details } }`。状态码映射 SHALL 为：400 校验失败 / 401 未登录 / 403 无权限 / 404 不存在 / 409 业务冲突 / 429 限流 / 500 服务端异常。错误码格式 SHALL 为 `<capability>.<snake_case>`，横切通用码（如 `auth.unauthorized`、`validation.invalid_input`、`idempotency.replay`、`rate_limit.exceeded`）统一定义在 `packages/shared`。

#### 场景：BizError 被序列化为统一错误体

- **WHEN** handler 抛出 `BizError('auth.forbidden', ..., { httpStatus: 403 })`
- **THEN** 响应 HTTP 403，body 形如 `{ request_id, error: { code: 'auth.forbidden', message, details } }`

#### 场景：未捕获异常返回 500

- **WHEN** handler 抛出一个非 `BizError` 的异常
- **THEN** 响应 HTTP 500，错误被记录在 `error` 级别日志，body 仍为统一错误体且不泄露堆栈

### Requirement: Zod 在边界做校验与显式 case 转换

请求/响应 SHALL 用 `packages/shared` 中定义的 Zod schema 在路由边界校验。API JSON 字段为 `snake_case`，TS 内部为 `camelCase`，二者转换 SHALL 由 Zod schema 在边界用 `.transform()` **逐 schema 显式手写**完成，MUST NOT 引入通用的 key 自动转换 codec。校验失败 SHALL 返回 400 且错误码 `validation.invalid_input`。

#### 场景：非法输入返回 400

- **WHEN** 请求 body 不满足 Zod schema
- **THEN** 响应 HTTP 400，错误码为 `validation.invalid_input`

#### 场景：边界完成 snake/camel 转换

- **WHEN** 一个 `snake_case` JSON 请求通过 schema 校验进入业务层
- **THEN** 业务层拿到的是 `camelCase` 对象；响应在边界又被转回 `snake_case` JSON

### Requirement: JWT 校验中间件（仅校验）

系统 SHALL 提供一个 JWT 校验中间件：若请求带 `Authorization: Bearer <token>`，校验签名（HS256）后将解析结果填入 `ctx.user`，否则 `ctx.user` 为 null。该中间件 MUST NOT 负责签发 token。受保护路由 SHALL 通过 `requireAuth` 守卫强制登录，未登录时返回 401 且错误码 `auth.unauthorized`。

#### 场景：有效 token 填充 ctx.user

- **WHEN** 请求携带有效的 Bearer token
- **THEN** `ctx.user` 被填充为 token 的解析结果

#### 场景：受保护路由缺 token 返回 401

- **WHEN** 访问 `requireAuth` 守卫的 endpoint 且未带 token
- **THEN** 响应 HTTP 401，错误码 `auth.unauthorized`

#### 场景：无效签名返回 401

- **WHEN** 请求携带签名无效或过期的 token 访问受保护 endpoint
- **THEN** 响应 HTTP 401，`ctx.user` 不被填充

### Requirement: 接口限流中间件

系统 SHALL 提供一个限流中间件，按 endpoint opt-in 挂载（不全局）。限流计数 SHALL 基于 Redis，按「调用方标识 + endpoint」维度统计（已登录用 `ctx.user`，未登录退化为客户端 IP）。超过阈值时 SHALL 返回 HTTP 429 且错误码 `rate_limit.exceeded`，并通过响应头告知重试时机（如 `Retry-After`）。限流 MUST NOT 影响 `/health`。

#### 场景：超过阈值返回 429

- **WHEN** 同一调用方在窗口内对一个限流 endpoint 的请求数超过阈值
- **THEN** 后续请求返回 HTTP 429，错误码 `rate_limit.exceeded`，并携带 `Retry-After` 响应头

#### 场景：未超阈值正常放行

- **WHEN** 调用方在窗口内的请求数未达阈值
- **THEN** 请求正常进入后续处理，不被限流拦截

#### 场景：不同调用方独立计数

- **WHEN** 两个不同标识的调用方分别请求同一限流 endpoint
- **THEN** 二者的限流计数相互独立，一方触顶不影响另一方

### Requirement: 幂等中间件

标注为需要幂等的写 endpoint SHALL 接收 `Idempotency-Key` 请求头。同一 key 在 24 小时内的重复请求 SHALL 返回首次的响应（成功或失败均缓存）。实现 SHALL 用 Redis 存储 `idem:<endpoint>:<key>` → `{ status, response_body }`，TTL 24h。

#### 场景：同 key 重放返回首次响应

- **WHEN** 用同一 `Idempotency-Key` 对同一幂等 endpoint 发起两次请求
- **THEN** 第二次返回与第一次完全相同的响应，且副作用只发生一次

#### 场景：不同 key 分别处理

- **WHEN** 用不同 `Idempotency-Key` 对同一 endpoint 发起两次请求
- **THEN** 两次请求被独立处理

### Requirement: 健康检查 endpoint

系统 SHALL 提供 `/health` endpoint，探测 PostgreSQL 与 Redis 连通性。两者均可达时返回 200，任一不可达时返回 503。

#### 场景：依赖正常返回 200

- **WHEN** PostgreSQL 与 Redis 均可连接时请求 `/health`
- **THEN** 响应 HTTP 200，body 标识各依赖为健康

#### 场景：依赖异常返回 503

- **WHEN** Redis 不可达时请求 `/health`
- **THEN** 响应 HTTP 503，body 标识 Redis 不健康

### Requirement: API 集成测试 harness

系统 SHALL 提供一套 API 集成测试 harness（基于 testcontainers 真起 PG + Redis 的测试 client），支持注入 `now`、事务作用域 `db`、以及仅测试用的 JWT token 铸造 helper。每个 endpoint SHALL 至少有 3 个集成测试：正常路径、鉴权失败、业务/校验失败。

#### 场景：harness 可发起带鉴权的请求

- **WHEN** 测试用 token 铸造 helper 生成一个 token 并通过 harness 发起请求
- **THEN** 请求被 JWT 中间件接受，`ctx.user` 被正确填充
