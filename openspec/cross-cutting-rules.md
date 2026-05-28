# 横切规则（架构不变量）

> 这些是**跨多个 capability 的契约**，每个 change 都必须遵守。改动这些规则必须单独提一个 change 并显式列出影响面。
> 这一份文档防止架构跑偏。每写一个新 change 前，先读一遍相关章节。

## 1. UID 系统

### 规则

- UID 格式：`EKY` + 注册年份 4 位 + 6 位自增数字，例如 `EKY20260418`
- UID 在 `user` 表创建时生成，**全局唯一、终身不变、不可编辑**
- UID 是**唯一对外暴露**的用户标识，绝不暴露 user.id（cuid2）或 openid
- 所有跨用户操作（门店添加顾问、运营冻结用户、查询订单关联用户）**必须通过 UID**，不允许通过 user.id

### 影响的 capability

`user-profile`、`consultant`（添加顾问）、`admin-user-mgmt`（冻结/查询）、`referral`（邀请码可独立于 UID，但查询时通过 UID 关联）

### 反模式

- 前端任何地方展示 user.id：禁止
- 接口请求体里既有 `userId` 又有 `uid`：禁止，统一用 `uid`
- 在 URL 里暴露 user.id：禁止，用 UID 或临时 token

---

## 2. 订单状态机

### 状态定义（**唯一权威定义**，PRD §8.3 同步）

```
[创建] ──手动确认模式──> 待确认
[创建] ──自动确认模式──> 待服务

待确认 ──顾问确认──> 待服务
待确认 ──用户取消──> 已取消（cancel_reason: user_self）
待确认 ──顾问拒绝──> 已取消（cancel_reason: consultant_reject）
待确认 ──超时未确认（24小时）──> 已取消（cancel_reason: auto_expire）

待服务 ──顾问开始──> 服务中
待服务 ──用户取消（>=取消时限）──> 已取消（cancel_reason: user_self）
待服务 ──门店/顾问取消──> 已取消（cancel_reason: store_cancel）
待服务 ──顾问标记爽约（过了服务开始时间）──> 已爽约

服务中 ──顾问完成──> 已完成
服务中 ──门店异常取消（需填原因）──> 已取消（cancel_reason: exception）
服务中 ──顾问标记爽约（极少数情况，如服务到一半客人跑了）──> 已爽约

已完成 / 已取消 / 已爽约 ──> [终态]
```

### 状态字段

```ts
type OrderStatus =
  | 'pending_confirm'   // 待确认
  | 'pending_service'   // 待服务
  | 'in_service'        // 服务中
  | 'completed'         // 已完成
  | 'cancelled'         // 已取消
  | 'no_show';          // 已爽约

type CancelReason =
  | 'user_self'         // 用户自行取消
  | 'consultant_reject' // 顾问拒单
  | 'store_cancel'      // 门店/顾问取消
  | 'auto_expire'       // 超时未确认
  | 'exception';        // 服务中异常
```

### 规则

- **状态流转必须经过 state machine 模块**，禁止任何接口直接 `UPDATE order SET status = ...`
- 每次状态变更写一条 `order_event` 日志（操作人、时间、from_status、to_status、reason）
- 取消必须填 `cancel_reason`；非取消的状态变更 `cancel_reason` 必须为 null
- "已爽约"独立于"已取消"，不要混在一起

### 时段占用规则（影响 slot-engine）

| 状态 | 是否占用时段 |
|---|---|
| 待确认 | ✅ 占用 |
| 待服务 | ✅ 占用 |
| 服务中 | ✅ 占用 |
| 已完成 | ❌ 不占用 |
| 已取消 | ❌ 不占用 |
| 已爽约 | ✅ 占用到「服务开始时间 + 服务时长」之后释放 |

---

## 3. 可预约时段计算（slot-engine）

### 输入

```ts
{
  storeId: string;
  consultantId: string;
  serviceId: string;
  dateRange: { from: Date; to: Date };   // 通常是未来 7 天
}
```

### 输出

```ts
Array<{
  date: string;           // YYYY-MM-DD
  slots: Array<{
    start: string;        // HH:mm
    end: string;          // HH:mm
    available: boolean;   // 始终 true，不可约的不返回
  }>;
}>
```

### 计算流程（严格按顺序，单元测试每一步都覆盖）

```
1. 加载门店预约规则：
   - 营业时间 [openAt, closeAt]
   - 时段粒度 granularityMin（15/30/60）
   - 最多提前 maxAdvanceDays（默认 7）
   - 最少提前 minAdvanceMin（默认 30）
   - 取消时限 cancelDeadlineMin（默认 60）

2. 生成原始时间格子：从 openAt 到 closeAt 按 granularityMin 切分

3. 叠加顾问周期排班 schedule_cycle：
   只保留顾问周期排班覆盖的格子

4. 叠加临时调整 schedule_override（优先级高于周期排班）：
   - day_off: 整天清空
   - temp_close [start, end]: 区间内格子清空
   - temp_open [start, end]: 在门店营业时间内新增格子（已有的不重复）

5. 扣除已占用订单：
   - 状态 ∈ {pending_confirm, pending_service, in_service}: 占用 [appointmentTime, appointmentTime + serviceDuration]
   - 状态 = no_show: 同样占用到 [appointmentTime + serviceDuration]
   - 状态 ∈ {completed, cancelled}: 不占用

6. 按服务时长 serviceDuration 检查连续可用格子：
   - 需要的格子数 = ceil(serviceDuration / granularityMin)
   - 从每个格子开始，检查连续 N 个格子是否都可用
   - 例：服务 60min、粒度 30min，需要连续 2 个空闲格子
   - 例：服务 45min、粒度 30min，向上取整为 60min，需要连续 2 个空闲格子

7. 扣除最少提前预约限制：
   - 若 date = 今天：所有 start < now() + minAdvanceMin 的格子去掉
   - 例：当前 10:10、minAdvance 30 → 10:30 不可约，最早 11:00（向上取整到粒度）

8. 扣除最多提前预约限制：
   - 若 date > today() + maxAdvanceDays：返回空

9. 顾问状态校验：
   - 顾问 status != 'active'：返回空
   - 顾问未绑定该 serviceId：返回空

10. 会员权益门槛（在 API 层判断，不在引擎内）：
    - 用户非会员且非试用期内：接口直接返回 membership.required，不走引擎
```

### 并发安全

- **下单时必须二次校验**，不能信任前端拿到的 slots
- 下单接口流程：
  1. 获取 Redis 分布式锁：`lock:slot:{consultantId}:{appointmentTime}`，TTL 10s
  2. 重新跑一次步骤 1-9（不含 10），确认目标时段仍可用
  3. 插入 order
  4. 释放锁
- 如果二次校验失败，返回 `order.slot_taken`，前端提示「该时段已被预约」并刷新

### 反模式

- 前端直接读 schedule 表：禁止，永远走 `/slots` 接口
- 时段计算在数据库 SQL 里做：禁止，必须在 Node 层（保证可测试性）
- 不同接口各自实现一遍计算：禁止，只有 slot-engine 一份实现，order-create 调用同一个函数

---

## 4. 按门店爽约累计

### 规则

- 爽约记录粒度：`(user_id, store_id)` 维度独立累计
- 阈值：**3 次**（写在 store.no_show_threshold，门店可配置，默认 3）
- 触发时机：顾问标记爽约 → 自动写入 `no_show_record`
- 阻断范围：**仅该门店**。用户在 A 店爽约 3 次，B 店、C 店预约不受影响
- 解除：门店管理员或运营后台手动解除，删除或标记 `revoked = true` 该门店的爽约记录

### 阻断检查时机

| 时机 | 行为 |
|---|---|
| 进入门店详情页 | 不阻断，但顾问列表上方展示提醒「您在本门店爽约 2/3 次」 |
| 进入顾问主页 | 同上，顶部展示提醒 |
| 进入预约确认页 | 同上 |
| 提交订单 | **阻断**，返回 `order.no_show_blocked` |

### 反模式

- 全局爽约计数 + 全局阻断：禁止（PRD 明确要求按门店）
- 把爽约次数存在 user 表上：禁止，必须靠 `no_show_record` 聚合
- 解除时硬删除：禁止，用 `revoked` 标记 + 操作日志

---

## 5. 会员制门槛

### 用户会员状态

```ts
type MembershipStatus = 'trial' | 'active' | 'expired';

// 计算逻辑（每次接口调用现算，不存）：
function getStatus(user, now): MembershipStatus {
  if (user.membershipEndAt && user.membershipEndAt > now) return 'active';
  if (user.trialEndAt && user.trialEndAt > now) return 'trial';
  return 'expired';
}
```

### 门槛矩阵

| 接口 / 行为 | trial | active | expired |
|---|---|---|---|
| 浏览门店列表 | ✅ | ✅ | ✅ |
| 浏览门店详情 | ✅ | ✅ | ✅ |
| 浏览顾问主页（基础信息+评价+作品） | ✅ | ✅ | ✅ |
| 查看可预约时段（`/slots` 接口） | ✅ | ✅ | ❌ |
| 创建订单 | ✅ | ✅ | ❌ |
| 查看历史订单 | ✅ | ✅ | ✅ |
| 取消订单 | ✅ | ✅ | ✅ |
| 收藏 | ✅ | ✅ | ✅ |
| 评价 | ✅ | ✅ | ✅ |
| 购买/续费会员 | ✅ | ✅ | ✅ |

### 实现

- Hono 中间件 `requireMembership`，加在 `/slots` 和 `POST /orders` 两个接口上
- 拦截后返回 `membership.required`，前端展示遮罩 + 开通会员入口
- **不要在业务代码里到处 if 判断**，统一走中间件

### 有效期计算（**唯一权威定义**，PRD §4.3.10 同步）

| 场景 | 公式 |
|---|---|
| 新用户注册 | trialEndAt = registerAt + 3 months |
| 试用期内购买 | membershipEndAt = trialEndAt + 1 year |
| 试用过期后购买 | membershipEndAt = paidAt + 1 year |
| 有效期内续费 | membershipEndAt += 1 year |
| 过期后续费 | membershipEndAt = paidAt + 1 year |
| 邀请新用户奖励 | membershipEndAt = max(membershipEndAt, now) + 3 months |
| 推荐门店奖励 | membershipEndAt = max(membershipEndAt, now) + 3 months |

### 反模式

- 接口里手写 `if (user.status !== 'active')`：禁止，用中间件
- 把试用期和会员有效期合并成一个字段：禁止，必须分开两个字段，因为奖励规则不同
- 续费时直接覆盖 `membershipEndAt`：禁止，必须用「累加 or 重置」分支

---

## 6. 时间与时区

- 数据库存 `timestamptz`，全部 UTC
- API 收发时间戳统一 **UTC ISO 字符串 + `Z` 后缀**（如 `2026-05-10T12:00:00Z`），**禁止**用 `+08:00` 形式
- 本地日期字段以 `_local` 后缀标识（如 `date_local: "2026-05-10"`），固定按 `Asia/Shanghai` 解释，不带时区
- 前端展示统一东八区，由前端在渲染层做转换，不在接口里做
- 排班、营业时间这种「每日时段」用 `time` 类型（不含日期、不含时区），按门店所在时区解释（MVP 只做大陆，统一 `Asia/Shanghai`）
- **绝不**在 service/business 层用 `new Date()` 直接取当前时间，统一从 `req.ctx.now` 注入（方便测试）

---

## 7. 文件上传

- 所有图片走**七牛云 Kodo**，**不走自己服务器**
- 上传流程：客户端请求 `/upload/token` 拿到七牛 upload token → 客户端直传七牛 → 把返回的 key/URL 提交给业务接口
- 两个 bucket 分开建：
  - `yikey-private`：资质材料（营业执照、卫生许可、身份证等），**bucket 设私有**，访问走 `private_download_url` 生成签名 URL（短 TTL），永不直连
  - `yikey-public`：用户作品、评价图、门店环境照、轮播图等，**bucket 公开读**，七牛 CDN 域名直出
- upload token 必须**带 scope（bucket:key 前缀）+ 文件大小限制 + mimeType 白名单 + 短 TTL（≤ 5 分钟）**，禁止签发"任意 key"的开放 token
- key 命名：`<capability>/<entity_id>/<yyyymm>/<cuid2>.<ext>`，例如 `review/ord_xxx/202605/img_yyy.jpg`，方便按业务线统计和清理
- 客户端上传完成后必须**调业务接口确认绑定**（如 `POST /reviews` 把 key 写入评价记录），孤儿文件由定时任务清理

---

## 8. 通知

- 微信订阅消息是**唯一**用户通知渠道（MVP 不做短信不做 IM）
- 触发场景：
  - 用户：预约成功、预约前 1 小时提醒、预约被拒、入驻审核结果
  - 顾问：新订单通知、用户取消通知
- 每个场景对应一个模板，模板 ID 在 `apps/server/src/wechat/templates.ts` 集中管理
- 同一事件 + 同一接收者 5 分钟内去重（Redis 设置 `notify:dedup:<event>:<user>` ttl 300）

---

## 9. RBAC（后台权限）

- 角色：`super_admin`（运营）、`store_owner`（店长）、`store_staff`（门店员工）、`consultant`（顾问，仅小程序内）
- 中间件 `requireRole([...])` 在路由层做，不在业务层做
- 数据级隔离：门店后台所有查询自动加 `WHERE store_id = ctx.user.storeId`，不要靠业务代码手动加

---

## 10. 错误码命名

- 格式：`<capability>.<error>`
- 已规划的码（每个 capability 自己的 spec 里追加，但下面的横切码统一在这里维护）：

| 码 | 说明 |
|---|---|
| `auth.unauthorized` | 未登录 |
| `auth.forbidden` | 无权限 |
| `membership.required` | 需要开通会员 |
| `order.slot_taken` | 时段已被预约（二次校验失败） |
| `order.no_show_blocked` | 在该门店爽约达阈值 |
| `order.cancel_too_late` | 超过取消时限 |
| `order.invalid_transition` | 状态机非法转移 |
| `validation.invalid_input` | 输入校验失败（zod） |
| `rate_limit.exceeded` | 限流 |
| `idempotency.replay` | 幂等 key 重放（返回首次响应即可，业务层一般无需感知） |
| `queue.job_failed` | 队列任务最终失败（已到死信） |

---

## 11. 日志（Pino）

- **唯一日志库 Pino**，禁止 `console.log` / `console.error`，CI 加 lint 规则拦截
- 输出 JSON 行（生产）或 pino-pretty（本地），由 `NODE_ENV` 切换
- 每条日志**必须**带：`request_id`、`level`、`time`、`msg`；HTTP/job/event 三类各自加上下文字段：
  - HTTP：`method`、`path`、`status`、`latency_ms`、`user_id?`、`uid?`
  - Job：`queue`、`job_id`、`attempt`、`latency_ms`
  - Event：`exchange`、`routing_key`、`event_id`
- **redact 必须配置**，自动脱敏以下字段路径（不在日志里出现明文）：
  ```
  req.headers.authorization
  req.body.password
  req.body.id_card_no
  *.phone
  *.openid
  *.access_token
  ```
- 日志级别：
  - `fatal`：进程要挂了
  - `error`：业务异常 + 系统异常，触发告警
  - `warn`：值得注意但不影响功能（如重试一次后成功、降级路径触发）
  - `info`：业务关键路径（订单创建、支付完成、入驻审核），默认级别
  - `debug`：开发态详细，生产关闭
- **绝不**记录请求/响应**全量 body**到 info 级别；如需排查，开 debug 临时打开
- 用 Pino 的 child logger 在每个请求/job 起点绑定 `request_id`，下游业务代码用 `ctx.log.info(...)`，**不要**自己拼接 request_id

---

## 12. 异步任务（BullMQ）

### 适用场景

- **定时/延迟**：试用到期前 7/3/1 天提醒、预约前 1h/30min 提醒、爽约自动检测（服务结束后 N 分钟）、孤儿文件清理
- **可重试的副作用**：发送微信订阅消息、推送（重试 3 次后进死信）
- **批处理**：日数据聚合、月报生成

### 不适用场景

- 跨业务能力解耦——MVP 阶段单服务部署，直接函数调用即可
- 立即同步响应——直接在请求里同步做

### 队列命名

`<capability>:<job-kind>`，全小写连字符，例如：

| 队列名 | 用途 |
|---|---|
| `notify:wechat-subscribe` | 微信订阅消息发送 |
| `order:no-show-detect` | 爽约自动检测 |
| `order:reminder` | 预约前提醒 |
| `membership:trial-expiry-notice` | 试用期到期前提醒 |
| `storage:orphan-cleanup` | 七牛云孤儿文件清理 |

### Job 约定

- **Job payload 用 Zod schema 校验**（和 API 一样在 `packages/shared` 定义），消费者收到 job 先 `parse`，不合法直接进死信
- **Job 必须幂等**：用业务 key 作为 jobId（如 `order:no-show-detect` 队列用 `orderId` 当 jobId），重复入队自动去重
- **重试策略**：默认 `attempts: 3` + 指数退避（2s/8s/32s）；外部 API 调用类（微信、七牛）放宽到 5 次；DB 写入类不重试（先排查再重放）
- **死信处理**：超过 attempts 进 `<queue>:failed` 集合，定时任务每天扫一次推告警
- **Job 内部如需触发其他能力副作用，直接调函数**：MVP 阶段单服务，不要为了"解耦"再 publish 一个事件出去；job 只做"执行"

### Worker 进程

- BullMQ workers 跑在独立进程（`pnpm dev:worker`），不混在 HTTP server 进程
- 单 worker 进程可以监听多个 queue，按 capability 分组配置 concurrency
- 优雅退出：收到 SIGTERM 后 worker 停止接新 job，最多等待 30s 完成在途 job，超时强制退出

---

## 13. 跨能力调用（阶段 1-12）/ 业务事件（阶段 13+）

### 阶段 1-12：直接函数调用

阶段 13 引入 RabbitMQ 之前，**跨能力调用走直接函数调用**。

- 触发副作用：在源能力 service 里**直接 import 目标能力的 service 函数**，例如：
  ```ts
  // order.service.ts
  await notifyService.sendOrderCreated(order);
  await analyticsService.recordOrderCreated(order);
  ```
- 如果副作用**可以延迟、可以失败重试**（如发微信订阅消息）：**推一个 BullMQ job**，不是阻塞调用
- 如果副作用**多个**：写一个 `dispatchOrderCreated(order)` 编排函数，集中编排
- **禁止循环依赖**：A 调 B、B 调 A 是设计问题，重构成 A 和 B 都依赖 C
- **严禁提前抽象事件接口**：什么 `EventEmitter`、`Pub<T>` 接口现在不要写，阶段 13 重构时直接换成 RabbitMQ publisher，**重构比抽象便宜**

### 阶段 13：迁移到 RabbitMQ

阶段 13 的 `add-rabbitmq-events` change 会把以下高扇出调用迁移到 RabbitMQ：

- `order.created` → 通知 + 统计（+ v2.0 积分等）
- `order.completed` → 评价邀请 + 收入统计
- `user.registered` → 邀请奖励
- `store.application.approved` → 推荐人奖励 + 运营通知

迁移后这些能力之间不再有直接函数调用，源能力只 publish，消费方各自订阅。

### RabbitMQ 引入后的规则（阶段 13+ 生效）

- Topic exchange 一个：`yikey.events`
- Routing key 格式：`<capability>.<event-name>`，全小写连字符
- Event payload schema：
  ```jsonc
  {
    "event_id": "evt_01HXYZ...",              // cuid2，全局唯一，消费方用来去重
    "event_type": "order.created",            // 同 routing key
    "schema_version": 1,
    "occurred_at": "2026-05-23T10:00:00Z",    // UTC Z
    "actor": { "type": "user", "id": "usr_xxx", "uid": "EKY..." },
    "data": { ... }
  }
  ```
- payload schema 在 `packages/shared/events/`，前后端共用
- **Publisher 走 outbox pattern**：`event_outbox` 表 + 独立 worker 扫描发布，禁止在 DB 事务里直接 publish
- **Consumer 必须幂等**：用 `event_id` 在 Redis/DB 去重 TTL ≥ 7 天
- 死信进 `yikey.events.dlx`，定时扫描告警
- Consumer 处理时长 > 30s 转 BullMQ
- 事件类型集中维护在 `openspec/events.md`（由 `add-rabbitmq-events` 创建）

---

## 14. 测试规范

### 测试金字塔

| 层 | 工具 | 写在哪 | 跑多频繁 |
|---|---|---|---|
| 单元测试 | Vitest | 业务文件就近，`xxx.service.ts` 旁边 `xxx.service.test.ts` | 每次保存 + CI |
| 集成测试 | Vitest + testcontainers | `apps/server/tests/integration/<capability>/*.test.ts` | CI 必跑、本地按需 |
| 契约测试 | Vitest + `packages/shared` Zod schema | `apps/server/tests/contract/*.test.ts` | CI 必跑 |

> MVP 不做 E2E（浏览器自动化）。原因：维护成本高、跑得慢，集成测试已能覆盖 95% 的 API 行为。

### API 集成测试要求（**强制**）

每个 endpoint **至少 3 个测试**：

| 测试名 | 断言 |
|---|---|
| 正常路径 | HTTP 200 / 201 / 204、响应 body schema 通过 Zod 校验、DB/队列副作用正确 |
| 鉴权失败 | 没带 token → 401；越权 → 403 |
| 业务校验失败 | 输入非法 → 400；业务冲突 → 409；不存在 → 404 |

对于有**幂等**要求的接口（订单创建、支付）：**必须额外测**

- 同一 `Idempotency-Key` 重放：返回首次响应，**DB 只写一次**
- 不同 key 两次请求：分别处理

对于触发**异步副作用**的接口（订阅消息发送、爽约检测等）：**必须额外测**

- BullMQ job 入队：用 `getWaiting()` 断言 job 存在 + payload 正确

### testcontainers 使用规范

- 测试启动顺序：`vitest.config.ts` 的 `globalSetup` 启动 PG + Redis 容器，全部测试共享
- **每个测试文件独立 DB schema**：`beforeAll` 创建 `test_<file_id>` schema 跑迁移，`afterAll` drop schema
- **每个测试函数独立事务**：`beforeEach` `BEGIN`，`afterEach` `ROLLBACK`（除非显式测事务提交）
- **Redis namespace 隔离**：每个文件 prefix `test:<file_id>:`，跑完 `KEYS test:<file_id>:* | DEL`

### BullMQ 测试

- 用**真 Redis + 真 worker**，不 mock
- 测试中**手动驱动**：调度 job → `queue.getWaiting()` 断言入队 → 启动 worker → 等待 job 完成 → 断言副作用
- 延迟 job 用 Vitest fake timers：`vi.useFakeTimers()` + `vi.advanceTimersByTime(ms)` + `await queue.process()`
- 死信测试：构造一定失败的 job → attempts 跑完 → 断言进入 `failed` 集合

### 契约测试

用 `packages/shared` 里的 Zod schema 反向校验响应：

```ts
// apps/server/tests/contract/order.test.ts
import { OrderResponseSchema } from '@yikey/shared/order';

it('GET /orders/:id matches contract', async () => {
  const res = await client.get(`/api/v1/weapp/orders/${id}`);
  OrderResponseSchema.parse(res.data);  // 类型不对会抛
});
```

防止后端字段悄悄改了前端报错。

### 测试数据

- **每个测试自建数据**，不共享 fixture（共享 fixture 是测试间互相干扰的头号原因）
- 提供 factory 函数：`createTestUser()`, `createTestStore()`, `createTestOrder()` 在 `apps/server/tests/factories/`
- factory 返回的数据**最小有效集**，测试需要的额外字段在调用处覆盖

### 命名约定

- 测试文件后缀 `.test.ts`；不用 `.spec.ts`
- `describe` 名 = 被测对象（`describe('OrderService')` / `describe('POST /orders')`）
- `it` 名用陈述句，描述行为不描述实现：`it('returns 409 when slot is already taken')`，不写 `it('should call slotEngine.check')`

### 覆盖率

- **CI 强制门槛**：line ≥ 80%、branch ≥ 70%、function ≥ 80%
- 低于门槛构建失败
- 可豁免目录：`packages/shared`（纯类型）、`apps/server/src/db/migrations`、生成代码
- **不追求 100%**：100% 通常意味着在测无意义的胶水代码；80% 是健康水位

### 反模式

- 测试里 mock 数据库：禁止
- 测试里 sleep 几秒等异步：禁止，用 fake timers 或 polling helper
- 一个测试文件 1000+ 行：禁止，按 endpoint 拆
- 测试名只写 "works"、"test1"：禁止
- 跨测试共享变量/状态：禁止
- 测试里写业务逻辑断言（"用户 A 应该比 B 早 1 秒"），但断言依赖 `new Date()`：禁止，时间从 `ctx.now` 注入

---

## 修订流程

修改本文档需要：

1. 提一个 `change/update-cross-cutting-<topic>` 的 OpenSpec change
2. 在 proposal.md 里列出受影响的所有 capability
3. 必须更新对应章节并在 commit 里引用 PRD 章节号
4. 不允许「悄悄改」一个规则——这是架构跑偏的最常见原因
