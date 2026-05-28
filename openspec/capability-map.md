# 能力地图与开发顺序

> 每个 capability 是一个独立的 OpenSpec spec；每个 change 提案落在 1-N 个 capability 上。
> 顺序按依赖关系，**不按 PRD 章节顺序**。预计 MVP 全量 40-50 天人日。

## 能力清单（24 个 MVP + 11 个 v2.0）

### 基础设施层（阶段 1，必须最先做）

| capability | 说明 | 依赖 |
|---|---|---|
| `infra-db` | Drizzle 配置、迁移、cuid2、时区处理 | 无 |
| `infra-log` | Pino 初始化、request_id 中间件、redact 规则、child logger | infra-db |
| `infra-api` | Hono 框架、错误中间件、Zod 校验、JWT 中间件、响应封装、幂等中间件 | infra-log |
| `infra-queue` | BullMQ 队列封装、worker 进程入口、job 调度 API、死信扫描、graceful shutdown | infra-log |
| `infra-wechat` | 微信登录、订阅消息、微信支付封装 | infra-api、infra-queue |
| `infra-storage` | 七牛云 Kodo 封装：upload token、私有/公开 bucket、CDN URL、孤儿清理 job | infra-api、infra-queue |

### 延迟引入的基础设施

| capability | 说明 | 引入阶段 |
|---|---|---|
| `infra-events` | RabbitMQ 连接、publisher、consumer 抽象、event_outbox 表 + worker、死信交换机、events.md | 阶段 13（MVP 业务全部跑通后） |

### 🔮 v2.0 能力（不在 MVP 范围）

| capability | 说明 | 引入阶段 |
|---|---|---|
| `recurring-booking` | 周期自动预约（每 7/10/15/20 天自动约同一顾问）；BullMQ 调度 + 冲突降级提醒 | 14（v2.0） |
| `consultant-time-block` | 顾问手动设置某天/某时段禁用（私事、培训） | 14（v2.0） |
| `online-payment` | 微信支付集成、预约付款 / 到店付款、退款、对账 | 15（v2.0） |
| `membership-multi-tier` | 多档位会员 + 升级降级规则 | 15（v2.0） |
| `points` | 积分获取、消费、商城 | 15（v2.0） |
| `coupon` | 优惠券发放、领取、核销、规则引擎 | 15（v2.0） |
| `im-system` | WebSocket 长连 + 消息存储 + 未读 + 撤回 + 多媒体 + 合规审计 | 16（v2.0） |
| `advanced-analytics` | 客户画像（RFM）、流失预警、经营建议 | 17（v2.0） |
| `anomaly-alert` | 差评率/爽约率/订单异常自动预警 + 推送 | 17（v2.0） |
| `admin-platform-config` | 取消规则、爽约处罚、入驻协议、消息模板 | 17（v2.0） |
| `banner-analytics` | Banner 曝光/点击/转化统计 + P1 扩展 Banner 类型 | 17（v2.0） |

### 身份层

| capability | 说明 | 依赖 |
|---|---|---|
| `auth-weapp` | 微信 code 换 openid，签发 JWT | infra-wechat |
| `auth-admin` | 门店/运营后台手机号+密码登录，RBAC | infra-api |
| `uid-system` | 用户 UID 生成、展示、查询（横切，多端用） | infra-db |
| `user-profile` | 用户基础信息、头像昵称、状态（正常/冻结） | auth-weapp、uid-system |

### 核心实体层

| capability | 说明 | 依赖 |
|---|---|---|
| `store` | 门店 CRUD、照片、营业时间、预约规则 | infra-api |
| `service-item` | 服务项目 CRUD（属于门店），价格、时长、分类 | store |
| `consultant` | 顾问 CRUD、UID 添加流程、绑定门店、标签、自动确认开关 | store、user-profile、uid-system |
| `consultant-service-binding` | 顾问 ↔ 服务项目 多对多 | consultant、service-item |

### 排班与时段（最难，单独拆）

| capability | 说明 | 依赖 |
|---|---|---|
| `schedule-template` | 班次模板（早班/晚班/全班） | store |
| `schedule-cycle` | 顾问周期排班（每周固定班次） | consultant、schedule-template |
| `schedule-override` | 临时关闭、临时开放、休息日 | schedule-cycle |
| `slot-engine` | **可预约时段计算引擎**（横切） | schedule-cycle、schedule-override、order |

### 订单主流程

| capability | 说明 | 依赖 |
|---|---|---|
| `order-create` | 创建订单、时段二次校验、Redis 锁防并发 | slot-engine、user-profile、consultant、service-item |
| `order-state-machine` | 状态流转（待确认/待服务/服务中/已完成/已取消/已爽约） | order-create |
| `no-show-per-store` | 按门店爽约累计、预约阻断、解除（横切） | order-state-machine |
| `auto-confirm-toggle` | 顾问自动确认开关（顾问端 + 门店端逐个/批量） | consultant |

### 增值能力

| capability | 说明 | 依赖 |
|---|---|---|
| `review` | 评价（评分、文字、标签、图片、匿名） | order-state-machine |
| `favorite` | 收藏顾问 | consultant |
| `membership` | 试用期 + 付费会员 + 权益门槛（横切） | user-profile、infra-wechat（支付） |
| `referral` | 邀请新用户、推荐门店奖励 | membership |
| `banner` | 首页轮播图（运营管理） | infra-api |
| `store-application` | 商家入驻申请 + 审核流程 | infra-wechat、store |

### 后台聚合（最后做）

| capability | 说明 | 依赖 |
|---|---|---|
| `store-admin-*` | 门店后台各页面接口聚合 | 上述全部 |
| `admin-*` | 运营后台各页面接口聚合 | 上述全部 |

## 开发阶段（建议 OpenSpec change 拆分）

每个阶段产出可独立验收的成果。每个 change 不超过 3 天。

### 阶段 1：地基（4-5 天）

1. `add-infra-foundation`：仓库结构、CI、Drizzle、Hono、Pino、错误/Zod/JWT/request_id/响应封装/幂等 中间件、`/health`、Docker Compose（PG + Redis）、Vitest + testcontainers
2. `add-queue-infra`：BullMQ 封装（queue/worker 进程入口/调度 API/死信扫描/graceful shutdown）+ `pnpm dev:worker` 入口
3. `add-wechat-integration`：封装微信登录、订阅消息、微信支付到 `apps/server/src/wechat`；订阅消息发送走 BullMQ
4. `add-qiniu-storage`：封装七牛云到 `apps/server/src/storage`、私有/公开两 bucket、`/upload/token` endpoint、孤儿清理 BullMQ job

**验收**：能本地起 server 和 worker，能用微信 code 换到 JWT，能用七牛 token 直传图片，能调度一个 BullMQ job 并被 worker 处理。

### 阶段 2：身份系统（2 天）

5. `add-uid-system`：UID 生成规则、用户表、`/me` 接口、admin 通过 UID 查用户
6. `add-admin-auth`：门店/运营后台账号体系、RBAC、Web 端登录页

**验收**：用户登录后能看到自己 UID；门店管理员能通过 UID 查到任意用户基础信息。

### 阶段 3：门店与服务（3 天）

7. `add-store-crud`：门店表、运营后台门店 CRUD、上下线、补充信息
8. `add-service-item`：服务项目 CRUD（门店后台）、分类、价格、时长

**验收**：运营后台能新建门店；门店后台能配置服务项目。

### 阶段 4：顾问（3 天）

9. `add-consultant-binding`：UID 查询添加顾问、顾问信息编辑、解绑、微信通知（订阅消息）
10. `add-consultant-service-binding`：顾问绑定可提供的服务项目
11. `add-auto-confirm-toggle`：顾问自动确认开关（顾问端 + 门店端逐个 + 批量开关）

**验收**：门店管理员能添加顾问、用户能在「我的」看到顾问工作台入口；门店后台能批量开关自动确认。

### 阶段 5：排班引擎（5 天，最关键）

12. `add-schedule-template`：班次模板 CRUD、默认早/晚/全班
13. `add-schedule-cycle`：顾问周期排班、店长批量排班、复制上周
14. `add-schedule-override`：临时关闭/开放、休息日、顾问端今日/明日请假
15. `add-slot-engine`：**核心算法**——可预约时段计算（详见 cross-cutting-rules §3）

**验收**：给定门店+顾问+服务+日期，能返回正确的可预约时段列表；冲突场景全部覆盖单元测试。

### 阶段 6：预约主流程（4 天）

16. `add-order-create`：下单接口、时段二次校验、Redis 分布式锁、自动确认/手动确认分支
17. `add-order-state-machine`：状态流转所有接口、取消、拒单、开始、完成、爽约；触发副作用通过 `dispatchOrderEvent` 编排（调用通知、统计等模块）
18. `add-no-show-per-store`：按门店爽约累计、阈值阻断、运营/门店后台解除；BullMQ 爽约自动检测 job

**验收**：用户能完成"找门店→选顾问→选服务→选时段→预约→服务→评价"完整闭环；爽约 3 次后被该门店阻断、其他门店不受影响。

### 阶段 7：用户端核心页面（5-7 天）

19. `add-weapp-home`：首页轮播图、分类入口、优秀评价
20. `add-weapp-store-list`：预约 Tab、搜索、分类筛选、距离排序
21. `add-weapp-store-detail`：门店详情、顾问列表、快速预约
22. `add-weapp-consultant-detail`：顾问主页、作品、评价、可预约时段
23. `add-weapp-booking-flow`：完整预约流程页
24. `add-weapp-my-orders`：订单列表 + 详情 + 取消

**验收**：用户端 3 个 Tab 完整可用，能完成完整预约闭环。

### 阶段 8：评价 + 收藏 + 顾问工作台（3-4 天）

25. `add-review-system`：评价提交、展示、标签
26. `add-favorite`：收藏顾问
27. `add-consultant-workbench`：顾问工作台 UI（嵌入小程序「我的」）、今日概览、接单/拒单、标记完成/爽约

**验收**：用户能评价；顾问能在工作台接单。

### 阶段 9：会员制（3-4 天）

28. `add-membership-trial`：3 个月试用、倒计时、到期前订阅消息 BullMQ 提醒
29. `add-membership-payment`：¥9.9/年微信支付、有效期计算
30. `add-membership-gate`：在 slot-engine 和 order-create 加权益门槛
31. `add-referral`：邀请码、邀请新用户/推荐门店奖励、防作弊；在 user-profile 注册接口和 store-application 审核通过接口里直接调用 referral 服务发放奖励

**验收**：试用到期后看不到可预约时段；付费后恢复；邀请新用户自动增加 3 个月。

### 阶段 10：商家入驻（2-3 天）

32. `add-store-application-form`：小程序入驻表单 3 步
33. `add-store-application-review`：运营后台审核、通过/拒绝、微信通知、自动开通门店账号；通过时直接调用 referral 服务（如果有推荐人）

**验收**：用户能在小程序提交入驻申请；运营审核通过后自动建门店并通知。

### 阶段 11：门店后台（4-6 天）

34. `add-store-admin-dashboard`：数据看板（多表聚合用 Drizzle 的 `sql` 模板写原生 SQL）
35. `add-store-admin-staff`：员工管理页（UID 添加、编辑、移除）
36. `add-store-admin-schedule`：排班管理页（周/日/月视图、批量、模板、冲突面板）
37. `add-store-admin-order`：订单管理、异常处理、爽约管理

**验收**：门店管理员能在 Web 端完成全部日常运营。

### 阶段 12：运营后台 + Banner（3-4 天）

38. `add-admin-dashboard`：全平台数据大盘（多表聚合用 Drizzle）
39. `add-banner-mgmt`：轮播图管理
40. `add-admin-user-mgmt`：用户列表、详情、冻结、爽约记录
41. `add-admin-membership-mgmt`：会员数据、配置

**验收**：运营能上下线门店、配置 Banner、管理用户和会员。

### 阶段 13：事件总线改造（2-3 天，MVP 收尾）

42. `add-rabbitmq-events`：引入 RabbitMQ + outbox pattern + 死信交换机；建 `event_outbox` 表 + outbox worker；迁移高扇出调用（`order.created` / `order.completed` / `user.registered` / `store.application.approved`）从直接函数调用到 publish 事件，相应消费方改成 consumer；补齐 RabbitMQ testcontainers + consumer 测试 harness

**验收**：上述 4 个事件从函数调用迁移到事件总线后行为不变（原有集成测试全过）；publish 能被对应 consumer 收到且幂等。

> 阶段 13 严格上属于 MVP "收尾 + 为 v2.0 打地基"。如果上线压力大可以**先上线（阶段 12 结束）再回头做阶段 13 改造**。

---

# 🔮 v2.0 路线图（不在 MVP 范围）

以下阶段属于 v2.0，**MVP 上线后**按业务优先级穿插实施。**所有 change 命名必须带 `v2-` 前缀**。

### 🔮 阶段 14（v2.0）：核心增长功能（4-6 天）

43. `v2-add-recurring-booking`：周期自动预约（PRD 核心亮点，每 7/10/15/20 天）；BullMQ 调度；冲突降级提醒
44. `v2-add-consultant-time-block`：顾问手动禁用某天/某时段（私事、培训）

### 🔮 阶段 15（v2.0）：商业模型升级（6-8 天）

45. `v2-add-online-payment`：微信支付集成、预约付款 / 到店付款、退款、对账
46. `v2-add-membership-multi-tier`：多档位会员、升级降级规则
47. `v2-add-points-system`：积分获取、消费、商城
48. `v2-add-coupon-system`：优惠券发放、领取、核销、规则引擎

### 🔮 阶段 16（v2.0）：用户沟通（5-7 天）

49. `v2-add-im-system`：用户 ↔ 顾问 IM（WebSocket、消息存储、未读、撤回、多媒体、合规审计）

### 🔮 阶段 17（v2.0）：运营增强（5-7 天）

50. `v2-add-advanced-analytics`：客户画像（RFM）、流失预警、经营建议
51. `v2-add-anomaly-alert`：差评/爽约率/订单异常自动预警 + 推送
52. `v2-add-admin-platform-config`：取消规则、爽约处罚、入驻协议、消息模板
53. `v2-add-banner-analytics`：Banner 曝光/点击/转化统计 + P1 扩展 Banner

> v3.0（多门店连锁、独立 App、AI 推荐、开放平台）不在此清单。

---

## 关键里程碑

| 里程碑 | 阶段 | 价值 |
|---|---|---|
| **能下单** | 阶段 6 完成 | 后端闭环跑通 |
| **能用** | 阶段 7 完成 | 用户端可演示 |
| **能开店** | 阶段 11 完成 | 真实门店能用 |
| **MVP 上线** | 阶段 12 完成 | 全功能（事件总线改造可后置） |
| **v2.0 准备就绪** | 阶段 13 完成 | RabbitMQ 事件总线就位，可承接多消费者/多服务扩展 |
| 🔮 **v2.0 增长就绪** | 阶段 14 完成 | 周期自动预约 + 顾问时段禁用——提升留存的核心功能 |
| 🔮 **v2.0 商业成熟** | 阶段 15 完成 | 在线支付 + 多档会员 + 积分 + 优惠券——商业模型完整 |
| 🔮 **v2.0 全功能** | 阶段 17 完成 | IM + 高级数据 + 运营增强——v2.0 完整交付 |

## 风险点

1. **slot-engine（阶段 5）是最大风险**：算法复杂、并发难、和订单状态机耦合。如果延期，整体延期。建议这个 change 单独花一天做设计、一天做实现、一天写测试。
2. **会员门槛（阶段 9）涉及大量已有接口改造**：要在阶段 1 就把 `requireMembership` 中间件骨架放好，阶段 9 只是把它接入。
3. **微信审核**：小程序提审约需 1-3 天，到阶段 7 末尾就要并行启动。
