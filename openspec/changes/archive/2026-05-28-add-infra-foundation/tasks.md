## 1. Workspace 与工具链

- [ ] 1.1 初始化 pnpm workspace：根 `package.json`、`pnpm-workspace.yaml`（仅纳入 `apps/server`、`packages/shared`）、`.gitignore`、`.nvmrc`
- [ ] 1.2 配置 TypeScript 基线：根 `tsconfig.base.json` + 各包 `tsconfig.json`（project references），确保 `apps/server` 能 import `packages/shared`
- [ ] 1.3 配置 ESLint + Prettier，加入禁止 `console.*` 的 lint 规则（cross-cutting §11）
- [ ] 1.4 创建目录骨架：`apps/server/src/{db,logger,middleware,health}`、`packages/shared/src`、`apps/server/tests/{integration,contract,factories}`

## 2. packages/shared 基础

- [ ] 2.1 定义统一响应类型：`{ request_id, data }`（成功）/ `{ request_id, error: { code, message, details } }`（失败）
- [ ] 2.2 定义横切错误码常量（cross-cutting §10）：`auth.unauthorized`、`auth.forbidden`、`validation.invalid_input`、`idempotency.replay`、`rate_limit.exceeded` 等
- [ ] 2.3 定义分页相关共享类型（`page_size`/`page_token`/`next_page_token`/`has_more`）与 Zod 基础工具（含 snake/camel 显式 transform 的约定示例）
- [ ] 2.4 定义金额工具与类型：整数分 `*_cents` 约定、`currency`（MVP `CNY`）、分↔元展示换算 helper（前后端共用，禁止浮点）

## 3. infra-db 实现

- [ ] 3.1 引入 Drizzle + `drizzle-kit` + `pg` + `@paralleldrive/cuid2`，编写 `drizzle.config.ts` 指向 `src/db/schema`
- [ ] 3.2 实现连接池与 Drizzle 客户端构造函数；导出可注入的 `createDb(connectionOrPool)`，**不**导出模块级全局单例（design D2）
- [ ] 3.3 约定 cuid2 主键 helper、`timestamptz`/UTC 与 `_local`/`time` 字段约定（写成可复用的 column helper）
- [ ] 3.4 实现金额 column helper（整型分 `*_cents` + 配套 `currency`），与 §2.4 的 shared 金额工具对齐，禁止浮点
- [ ] 3.5 编写 `seed` 入口骨架（空实现 + 运行命令）

## 4. infra-db 数据库迁移

- [ ] 4.1 配置 `drizzle-kit generate` / `migrate` 脚本，建立迁移目录
- [ ] 4.2 生成并提交首个迁移（仅建迁移机制所需的最小内容，例如 schema_migrations 元信息；不建业务表）
- [ ] 4.3 验证迁移可在空数据库幂等应用（apply 两次不报错）

## 5. infra-log 实现

- [ ] 5.1 初始化 Pino：按 `NODE_ENV` 切换 JSON / pino-pretty 输出
- [ ] 5.2 配置 redact 字段路径：`req.headers.authorization`、`req.body.password`、`req.body.id_card_no`、`*.phone`、`*.openid`、`*.access_token`
- [ ] 5.3 实现按请求绑定 `request_id` 的 child logger 工厂（供 `ctx.log` 使用）

## 6. infra-api 运行时与上下文

- [ ] 6.1 定义 `AppContext` 类型：`now`、`requestId`、`log`、`user`、`db`
- [ ] 6.2 实现 `createApp({ db, redis, clock, jwtSecret })` 工厂（design D2/D3），生产入口 `apps/server/src/index.ts` 用真实依赖构造
- [ ] 6.3 引入普通 `ioredis` 客户端（独立于 BullMQ，design D8）

## 7. infra-api 中间件栈

- [ ] 7.1 `request_id` 中间件：生成 `req_<cuid2>`、写 `X-Request-Id` 响应头、注入 `ctx.requestId`
- [ ] 7.2 `logger` 中间件：绑定 child logger 到 `ctx.log`，请求结束记录 `method/path/status/latency_ms`
- [ ] 7.3 `error` 处理（`app.onError`）：实现 `BizError(code, message, { httpStatus, details })`，序列化为统一错误体 + 状态码映射（400/401/403/404/409/429/500），非 BizError → 500 且不泄露堆栈
- [ ] 7.4 `jwt` 校验中间件（`jose`/HS256，仅校验填充 `ctx.user`，不签发）+ `requireAuth` 守卫（未登录 → 401 `auth.unauthorized`）
- [ ] 7.5 Zod 边界校验中间件：请求按 schema 校验、`.transform()` 做 snake→camel；校验失败 → 400 `validation.invalid_input`；响应在边界 camel→snake
- [ ] 7.6 `idempotency` 中间件：读取 `Idempotency-Key`，Redis 存 `idem:<endpoint>:<key>`（TTL 24h），重放返回首次响应
- [ ] 7.7 `rate_limit` 中间件：基于 Redis 按「identity（`ctx.user` 优先，回退 IP）+ endpoint」窗口计数，超限 → 429 `rate_limit.exceeded` + `Retry-After`，按路由 opt-in，不挂 `/health`

## 8. infra-api 健康检查

- [ ] 8.1 实现 `/health`：探测 PostgreSQL + Redis，均健康 → 200，任一不可达 → 503
- [ ] 8.2 实现仅测试用的 JWT token 铸造 helper（design D7）

## 9. 本地环境

- [ ] 9.1 编写 `docker-compose.yml`：PostgreSQL 16 + Redis，含健康检查与端口/卷配置
- [ ] 9.2 编写 `.env.example` + 配置加载（DB/Redis 连接串、`JWT_SECRET`、`NODE_ENV`），并加 `pnpm dev:server` 脚本

## 10. 测试基础设施

- [ ] 10.1 配置 Vitest + coverage（v8），coverage 门槛 line ≥ 80% / branch ≥ 70% / function ≥ 80%，豁免 `db/migrations`、`packages/shared`、生成代码
- [ ] 10.2 `vitest.config.ts` globalSetup：testcontainers 全程共享启动 PG + Redis
- [ ] 10.3 实现每文件独立 schema 的 `beforeAll`/`afterAll`（建 `test_<fileId>` 跑迁移 / drop）+ Redis `test:<fileId>:` 前缀隔离与清理
- [ ] 10.4 实现每用例事务回滚：取专用连接 `BEGIN` → 用该连接构造 Drizzle 作为注入的 `ctx.db` → `afterEach` `ROLLBACK`（design D5）
- [ ] 10.5 实现 API 集成测试 harness：基于 Hono in-process `app.request()`，支持注入 `clock`/事务 `db`/test token（design D3）
- [ ] 10.6 编写 factory 骨架目录 `tests/factories/`（最小有效集约定，本 change 暂无业务表，放占位与约定）

## 11. 测试用例

- [ ] 11.1 `infra-log` 单元测试：redact 生效（authorization / phone 脱敏）、同请求多条日志共享 `request_id`、info 级别不记录全量 body
- [ ] 11.2 `infra-db` 集成测试：cuid2 主键自动生成且唯一、`timestamptz` 读写不偏移、金额 `*_cents` 整型读写不丢精度、每用例回滚后数据不残留、并行文件 schema 隔离
- [ ] 11.3 中间件集成测试：`request_id` 回传（body 与 `X-Request-Id` 一致）、成功响应封装结构、`BizError` → 对应状态码与错误体、未捕获异常 → 500
- [ ] 11.4 `jwt`/`requireAuth` 集成测试：有效 token 填充 `ctx.user`、缺 token 受保护路由 → 401、无效签名 → 401
- [ ] 11.5 Zod 校验集成测试：非法输入 → 400 `validation.invalid_input`、边界 snake/camel 双向转换正确
- [ ] 11.6 `idempotency` 集成测试：同 key 重放返回首次响应且副作用只发生一次、不同 key 分别处理
- [ ] 11.7 `/health` 集成测试：依赖正常 → 200、依赖异常 → 503
- [ ] 11.8 契约测试骨架：用 `packages/shared` 的响应类型反向校验一个 endpoint 响应（建立 `tests/contract/` 模式）
- [ ] 11.9 `rate_limit` 集成测试：超阈值 → 429 `rate_limit.exceeded` + `Retry-After`、未超阈值放行、不同 identity 独立计数、`/health` 不受限流

## 12. CI

- [ ] 12.1 编写 CI workflow：install → lint（含 no-console）→ typecheck → test（testcontainers）→ coverage 门槛
- [ ] 12.2 验证低于 coverage 门槛时构建失败；分支命名/commit 约定写入 README 或贡献说明
