# 易可约 项目上下文

> OpenSpec 项目说明：这是所有 change 提案都要引用的根上下文。
> 配套阅读：[capability-map.md](./capability-map.md)、[cross-cutting-rules.md](./cross-cutting-rules.md)

## 产品形态

4 端 MVP，详见 [PRD.md](../PRD.md)：

- 用户端 微信小程序（C 端）
- 顾问工作台 嵌入用户端小程序「我的」页面
- 门店管理后台 Web
- 运营管理后台 Web

## 技术栈（锁定）

| 层 | 选型 | 备注 |
|---|---|---|
| 小程序 | uni-app + unibest 脚手架（Vue 3 + TypeScript + Vite） | 用户端 + 顾问工作台共用一个小程序 |
| 小程序 UI | Wot Design Uni | 配套 unibest 使用 |
| Web 后台 | vue-pure-admin（Vue 3 + Element Plus + Pinia + Vite） | 门店后台 + 运营后台两个独立部署，基于同一脚手架裁剪 |
| Backend | Node.js + Hono + TypeScript | 单服务，按能力分模块，不上微服务 |
| ORM / 查询 / 迁移 | Drizzle | schema 是 single source of truth；复杂 SQL 用 Drizzle 的 `sql` 模板，dashboards 多表聚合也走 Drizzle |
| 校验 | Zod | 请求/响应/job/event payload 都走 Zod，定义在 `packages/shared` |
| 日志 | Pino | JSON 结构化日志，挂载 request_id，敏感字段 redact |
| 延迟/定时任务 | BullMQ（Redis） | 订阅消息发送、爽约自动检测、试用到期提醒、孤儿文件清理 |
| 业务事件总线 | RabbitMQ | 跨能力解耦：订单创建 → 通知/统计/积分。**阶段 13 引入**（MVP 业务全部跑通后），早期跨能力调用一律走直接函数调用 |
| DB | PostgreSQL 16+ | |
| 缓存/锁 | Redis | 时段并发锁、订阅消息去重、BullMQ backend |
| 对象存储 | 七牛云 Kodo | 资质图、作品、评价图；公开 bucket 走七牛 CDN |
| 鉴权 | 微信小程序登录 + JWT（HS256） | Web 后台用手机号+密码 + JWT |
| 部署 | Docker + 单机起步 | server / worker 同镜像不同 entry，docker-compose 起 |

> **延迟引入策略**：RabbitMQ 不在 phase 1。等到 MVP 业务跑通、有明确的多消费者扇出场景时再做迁移（阶段 13）。在引入之前，**严禁**预留任何"假事件接口"，宁可后期重构也别提前抽象。
>
> 不引入 Kysely。Drizzle 的 `sql` 模板能写任意原生 SQL，dashboards 多表聚合也能搞定，没必要再引入第二个查询库。

## 代码组织

```
yikey/
├── apps/
│   ├── weapp/            # unibest 小程序（用户端 + 顾问工作台）
│   ├── store-admin/      # 门店后台 Web（vue-pure-admin 裁剪）
│   ├── admin/            # 运营后台 Web（vue-pure-admin 裁剪）
│   └── server/           # Hono 服务（按 capability 分目录）
├── packages/
│   └── shared/           # 跨端共享 types、zod schema、常量、错误码（前后端都 import）
├── openspec/
└── PRD.md
```

> 为什么只有 `shared` 独立成 package：它是**真正跨 app 用**的（前端三个 + 后端都要 import zod schema 做请求/响应校验）。`db`/`wechat`/`storage` 只有 server 一家用，没必要拆 npm 包。

后端按 capability 而非按层组织：

```
apps/server/
├── drizzle.config.ts        # 指向 src/db/schema
└── src/
    ├── db/                  # Drizzle schema + migrations + seed
    ├── logger/              # Pino 初始化、request_id 中间件、redact 配置
    ├── queue/               # BullMQ 队列定义、worker 启动、job 调度封装
    ├── events/              # 阶段 13 加入：RabbitMQ publisher/consumer、event_outbox
    ├── wechat/              # 微信 SDK 封装（登录、订阅消息、支付）
    ├── storage/             # 七牛云 Kodo 封装（upload token、私有/公开 bucket、CDN URL）
    ├── auth/                # auth-weapp、auth-admin
    ├── user/                # user、uid-system、membership、referral
    ├── store/               # store、store-application
    ├── consultant/          # consultant、consultant-binding
    ├── service/             # service-item
    ├── schedule/            # schedule-template、schedule-cycle、schedule-override、slot-engine
    ├── order/               # order、order-state-machine、no-show
    ├── review/              # review
    ├── favorite/            # favorite
    ├── banner/              # banner
    └── admin/               # 运营后台专属接口聚合
```

server 启动有两种入口（同一份代码，不同 entry）：

- `pnpm dev:server` → 启动 Hono HTTP server，处理 API 请求
- `pnpm dev:worker` → 启动 BullMQ workers，不监听端口

生产环境是同一个 Docker 镜像，按 entry 拉两个 container。

## 约定

### 命名

- 数据库：`snake_case`；API JSON：`snake_case`；TypeScript 代码内部：`camelCase`；常量：`SCREAMING_SNAKE`
- TS ↔ JSON 转换由 Zod schema 在路由边界统一做（`.transform()`），业务层永远操作 camelCase
- 表名单数（`user`、`order`、`schedule`），不用 `users`
- 主键统一 `id`（cuid2），外键统一 `<entity>_id`
- 时间字段统一 `_at` 后缀，类型 `timestamptz`

### API 通用约定

- RESTful，路径 `/api/v1/<capability>/<resource>`
- 客户端按角色拆 namespace：`/api/v1/weapp/...`、`/api/v1/store-admin/...`、`/api/v1/admin/...`
- 字段名统一 `snake_case`
- **所有 ID 用字符串传输**，不用 number（cuid2 本来就是字符串，避免长整型在 JS 里精度丢失）
- **时间戳用 UTC ISO 字符串**，统一 `Z` 后缀，例如 `2026-05-10T12:00:00Z`
- **本地日期字段以 `_local` 后缀标识**（如 `date_local: "2026-05-10"`），固定按 `Asia/Shanghai` 解释，不含时区
- **金额用整数分**：字段 `price_cents`、`amount_cents` 等，配套 `currency: "CNY"`，禁止用浮点
- 需要登录的接口走 `Authorization: Bearer <access_token>`
- 共享业务逻辑放 service 层，不在路由里写业务
- 请求/响应 schema 在 `packages/shared` 用 Zod 定义，前后端共用

### 响应封装

成功（HTTP 2xx）：

```json
{
  "request_id": "req_01HXYZ...",
  "data": { ... }
}
```

失败（HTTP 4xx/5xx）：

```json
{
  "request_id": "req_01HXYZ...",
  "error": {
    "code": "order.slot_taken",
    "message": "该时段已被预约",
    "details": { ... }
  }
}
```

- `request_id` 每个请求生成一次（cuid2 加 `req_` 前缀），同时写入日志和 `X-Request-Id` 响应头，用户报错时直接报这个 ID
- 用**真实 HTTP 状态码**，不要"永远 200"
- 状态码映射：400 校验失败 / 401 未登录 / 403 无权限 / 404 不存在 / 409 业务冲突（如时段被抢、爽约阻断）/ 429 限流 / 500 服务端异常
- 业务错误抛 `BizError(code, message, { httpStatus, details })`，由全局中间件统一序列化

### 分页

请求参数：

- `page_size`：每页条数，默认 20，上限 100
- `page_token`：游标（首页不传，后续传上一次返回的 `next_page_token`）

响应：

```json
{
  "data": {
    "items": [...],
    "next_page_token": "cursor_xxx",   // null 表示无下一页
    "has_more": true,
    "total": 123                        // 可选，按页面需要决定是否返回
  }
}
```

- 默认游标分页，**不用 page + offset**（高 offset 慢且容易跳数）
- `total` 仅在用户明确需要总数（如订单列表头部"共 X 单"）时返回；列表流不返回，避免 count(*) 拖慢

### 幂等

- 需要幂等的写接口（创建订单、支付、奖励发放）**必须接收 `Idempotency-Key` 请求头**
- 同一个 key 24 小时内重复请求返回**首次的响应**（成功或失败都缓存）
- 客户端责任：业务上一次操作生成一次 key，重试时复用同一个 key
- 服务端实现：Redis 存 `idem:<endpoint>:<key>` → `{ status, response_body }`，TTL 24h

### 错误码

- 格式 `<capability>.<snake_case>`，全小写，点分隔
- 跨能力的通用码定义在 [cross-cutting-rules.md §10](./cross-cutting-rules.md)
- 每个 capability 自己 spec 里追加自己的码，禁止重名

### 测试

- 后端用 **Vitest**，目标是 **API 全面覆盖**——每个 endpoint 至少 3 个集成测试（正常路径 / 鉴权失败 / 业务校验失败）
- **不 mock 外部依赖**：PostgreSQL / Redis 用 **testcontainers** 真启动，每个测试文件独立 schema/namespace，跑完销毁；RabbitMQ 阶段 13 引入后加入 testcontainers 列表
- 测试分层（详见 [cross-cutting-rules.md §14](./cross-cutting-rules.md)）：
  - **单元测试**：纯函数、算法、状态机（slot-engine、order-state-machine、membership 有效期）；测试文件就近放（`xxx.ts` 旁边 `xxx.test.ts`）
  - **集成测试**：API endpoint + DB + 队列副作用，统一在 `apps/server/tests/integration/`
  - **契约测试**：基于 `packages/shared` 的 Zod schema 反向校验响应（保证前后端类型不漂）
- **CI 强制覆盖率门槛**：line ≥ 80%、branch ≥ 70%，低于门槛构建失败
- 小程序/Web 端只测核心 composables 和工具函数，UI 不做单元测试

### Git

- 一个 OpenSpec change = 一个 PR，分支名 `change/<change-id>`
- Commit message 引用 change id：`[uid-system] add user uid generator`

## 不做（MVP 显式排除）

### MVP 完全不做

- 微服务、k8s
- 多门店连锁管理（v3.0）
- 独立 App / iOS / Android（v3.0）
- AI 推荐（v3.0）
- 开放平台 / 第三方接入（v3.0）

### MVP 不做，v2.0 做（详见 [propose-list.md](../propose-list.md) 阶段 14-17）

- 🔮 周期自动预约（v2.0 阶段 14）
- 🔮 顾问时段禁用（v2.0 阶段 14）
- 🔮 在线支付（除会员购买的微信支付，业务订单支付走 v2.0 阶段 15）
- 🔮 多档位会员 + 积分 + 优惠券（v2.0 阶段 15）
- 🔮 IM 即时通讯（v2.0 阶段 16）
- 🔮 高级数据分析 / 异常预警 / 平台规则配置（v2.0 阶段 17）
- 🔮 Banner 曝光/点击数据（v2.0 阶段 17）

### MVP 简化做

- 跨能力调用走直接函数调用，**不做事件总线**（阶段 13 才引入 RabbitMQ）
- 复杂查询用 Drizzle `sql` 模板（**完全不引入 Kysely**）
- 运营后台只做基础大盘（高级数据分析在 v2.0 做）

## 关键决策点（已锁定）

1. **不做用户密码**：用户端只走微信登录；门店后台和运营后台才有账号密码
2. **顾问 = 用户的另一个身份**：同一个 user 表，通过 consultant 表关联，UID 是用户身份的唯一对外标识
3. **时段计算后端权威**：前端从不直接读排班表，永远读 `/slots` 接口
4. **爽约按门店维度累计**：不全局封禁，详见 cross-cutting-rules
5. **会员制门槛只挡「查看可预约时段 + 发起预约」**：浏览、收藏、评价、查看历史不挡
