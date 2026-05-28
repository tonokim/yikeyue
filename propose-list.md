# 易可约 — Propose 清单

> 完整开发计划。
> **阶段 1-12** = MVP 主体（#1-#41）；**阶段 13** = 事件总线改造（#42，MVP 收尾/v2.0 准备）；**阶段 14-17** = 🔮 v2.0 功能（#43-#53）。
> 每个 change 控制在 1-3 天。MVP 主体优先做；v2.0 在 MVP 上线后按业务优先级穿插。
> 严格按顺序执行：下一阶段依赖前一阶段。
> 详细依赖关系见 [openspec/capability-map.md](openspec/capability-map.md)。

## 使用方式

每个 change 都给了**英文命令**和**中文命令**两种写法，**任选其一**：

- 英文：直接复制粘贴，目录名一致，跨平台稳
- 中文：opsx 会自动总结出英文目录名，输入更顺手

```
/opsx:propose add-infra-foundation
# 或
/opsx:propose 搭建项目基础设施
```

完成后跑 `/opsx:apply <change-name>`（用英文目录名），全部任务通过后跑 `/opsx:archive <change-name>` 归档到 specs。

---

## 阶段 1：地基（预计 4-5 天）

| # | 英文命令 | 中文命令 | 说明 |
|---|---|---|---|
| 1 | `/opsx:propose add-infra-foundation` | `/opsx:propose 搭建项目基础设施` | pnpm workspace、4 app + 1 package（shared）骨架、Hono 服务、Drizzle、Pino 日志、全局中间件（错误/Zod/JWT/request_id/响应封装/幂等）、`/health`、Docker Compose（PG + Redis）、**Vitest + testcontainers 测试基础设施 + API test harness + coverage 配置（line ≥ 80%/branch ≥ 70%）**、CI |
| 2 | `/opsx:propose add-queue-infra` | `/opsx:propose 搭建队列基础设施` | BullMQ 封装（queue 定义/worker 进程入口/调度 API/死信扫描/graceful shutdown）+ `pnpm dev:worker` 入口 + 命名约定 + 队列测试 harness |
| 3 | `/opsx:propose add-wechat-integration` | `/opsx:propose 集成微信SDK` | 封装微信登录、订阅消息、微信支付到 `apps/server/src/wechat`；订阅消息发送走 BullMQ 队列 |
| 4 | `/opsx:propose add-qiniu-storage` | `/opsx:propose 集成七牛云存储` | 封装七牛云 Kodo 到 `apps/server/src/storage`：私有/公开两个 bucket、`/upload/token` endpoint、key 命名规则、孤儿文件清理 BullMQ job |

**阶段验收**：能本地起 server 和 worker 两个进程；能用微信 code 换 JWT；能用七牛 token 直传图片；能调度一个 BullMQ job 并被 worker 处理。

---

## 阶段 2：身份系统（预计 2 天）

| # | 英文命令 | 中文命令 | 说明 |
|---|---|---|---|
| 5 | `/opsx:propose add-uid-system` | `/opsx:propose 实现UID用户系统` | UID 生成规则（`EKY` + 年 + 6 位）、`user` 表、`/me` endpoint、admin 通过 UID 查用户；注册成功后直接调用 referral 服务判定邀请奖励（阶段 9 接入） |
| 6 | `/opsx:propose add-admin-auth` | `/opsx:propose 实现后台账号登录` | 门店/运营后台账号、手机号+密码登录、RBAC 中间件、Web 登录页 |

**阶段验收**：用户能看到自己 UID；门店管理员能通过 UID 查到任意用户。

---

## 阶段 3：门店与服务（预计 3 天）

| # | 英文命令 | 中文命令 | 说明 |
|---|---|---|---|
| 7 | `/opsx:propose add-store-crud` | `/opsx:propose 实现门店管理` | 门店表、运营后台门店 CRUD、上下线、补充信息（面积/座位/简介） |
| 8 | `/opsx:propose add-service-item` | `/opsx:propose 实现服务项目管理` | 服务项目 CRUD（门店后台）、分类、价格、时长 |

**阶段验收**：运营后台能新建门店；门店后台能配置服务项目。

---

## 阶段 4：顾问（预计 3 天）

| # | 英文命令 | 中文命令 | 说明 |
|---|---|---|---|
| 9 | `/opsx:propose add-consultant-binding` | `/opsx:propose 实现顾问绑定` | UID 查询添加顾问、信息编辑、解绑、微信订阅消息通知 |
| 10 | `/opsx:propose add-consultant-service-binding` | `/opsx:propose 实现顾问服务项目绑定` | 顾问 ↔ 服务项目多对多绑定 |
| 11 | `/opsx:propose add-auto-confirm-toggle` | `/opsx:propose 实现自动确认开关` | 顾问自动确认开关：顾问端自改 + 门店端逐个 + 全部开启/关闭批量按钮 |

**阶段验收**：门店管理员能添加顾问；用户「我的」能看到顾问工作台入口；门店后台能批量开关自动确认。

---

## 阶段 5：排班引擎（预计 5 天，最关键）

| # | 英文命令 | 中文命令 | 说明 |
|---|---|---|---|
| 12 | `/opsx:propose add-schedule-template` | `/opsx:propose 实现班次模板` | 班次模板 CRUD、默认早/晚/全班 3 个模板 |
| 13 | `/opsx:propose add-schedule-cycle` | `/opsx:propose 实现周期排班` | 顾问周期排班（每周固定）、店长批量排班、复制上周 |
| 14 | `/opsx:propose add-schedule-override` | `/opsx:propose 实现排班临时调整` | 临时关闭/开放、休息日、顾问端今日/明日请假快捷操作 |
| 15 | `/opsx:propose add-slot-engine` | `/opsx:propose 实现可预约时段引擎` | **核心算法**：可预约时段计算引擎（按 cross-cutting-rules §3 的 10 步流程） |

**阶段验收**：给定门店+顾问+服务+日期，能返回正确的可预约时段；冲突场景全部覆盖单测。

> ⚠️ 第 15 个（slot-engine）是整个项目最大的风险点，建议单独 1 天设计、1 天实现、1 天测试。

---

## 阶段 6：预约主流程（预计 4 天）

| # | 英文命令 | 中文命令 | 说明 |
|---|---|---|---|
| 16 | `/opsx:propose add-order-create` | `/opsx:propose 实现创建订单` | 创建订单 endpoint、时段二次校验、Redis 分布式锁、自动/手动确认分支；创建后调用 dispatchOrderEvent 触发通知/统计 |
| 17 | `/opsx:propose add-order-state-machine` | `/opsx:propose 实现订单状态机` | 订单状态机所有流转 endpoint（取消/拒单/开始/完成/爽约）、order_event 日志表；状态变更后调用 dispatchOrderEvent 编排副作用；预约前 1h/30min 提醒走 BullMQ |
| 18 | `/opsx:propose add-no-show-per-store` | `/opsx:propose 实现按门店爽约累计` | 按门店爽约累计、阈值阻断（默认 3 次）、运营/门店后台解除；BullMQ 爽约自动检测 job |

**阶段验收**：完整闭环跑通（找门店 → 选顾问 → 选服务 → 选时段 → 预约 → 服务 → 评价）；爽约 3 次后被该门店阻断、其他门店不受影响。

---

## 阶段 7：用户端核心页面（预计 5-7 天）

| # | 英文命令 | 中文命令 | 说明 |
|---|---|---|---|
| 19 | `/opsx:propose add-weapp-home` | `/opsx:propose 开发小程序首页` | 小程序首页：轮播图、分类入口、优秀评价展示 |
| 20 | `/opsx:propose add-weapp-store-list` | `/opsx:propose 开发小程序门店列表` | 预约 Tab：搜索、分类筛选、距离排序 |
| 21 | `/opsx:propose add-weapp-store-detail` | `/opsx:propose 开发小程序门店详情` | 门店详情页：顶部信息 + 底部弹窗、服务项目、顾问列表、快速预约 |
| 22 | `/opsx:propose add-weapp-consultant-detail` | `/opsx:propose 开发小程序顾问主页` | 顾问主页：基础信息、作品、评价、可预约时段、收藏 |
| 23 | `/opsx:propose add-weapp-booking-flow` | `/opsx:propose 开发小程序预约流程` | 完整预约流程页（选服务 → 选时段 → 填手机号 → 确认提交） |
| 24 | `/opsx:propose add-weapp-my-orders` | `/opsx:propose 开发小程序我的订单` | 我的订单：待服务/已完成/已取消三 Tab + 详情 + 取消 |

**阶段验收**：用户端 3 个 Tab 完整可用，能在小程序里完成完整预约闭环。

> 此阶段末尾建议同步启动微信小程序提审准备（审核需 1-3 天）。

---

## 阶段 8：评价 + 收藏 + 顾问工作台（预计 3-4 天）

| # | 英文命令 | 中文命令 | 说明 |
|---|---|---|---|
| 25 | `/opsx:propose add-review-system` | `/opsx:propose 实现评价系统` | 评价提交（评分/文字/标签/图片/匿名）、展示、聚合到顾问/门店；订单完成时由 dispatchOrderEvent 调用，推送评价邀请微信订阅消息 |
| 26 | `/opsx:propose add-favorite` | `/opsx:propose 实现收藏顾问` | 收藏顾问、收藏列表 |
| 27 | `/opsx:propose add-consultant-workbench` | `/opsx:propose 开发顾问工作台` | 顾问工作台 UI（嵌入「我的」）：今日概览、接单/拒单、标记完成/爽约、自动确认开关 |

**阶段验收**：用户能评价；顾问能在工作台完成日常接单。

---

## 阶段 9：会员制（预计 3-4 天）

| # | 英文命令 | 中文命令 | 说明 |
|---|---|---|---|
| 28 | `/opsx:propose add-membership-trial` | `/opsx:propose 实现会员试用期` | 3 个月免费试用、倒计时展示、到期前 7/3/1 天 BullMQ 调度微信订阅消息提醒 |
| 29 | `/opsx:propose add-membership-payment` | `/opsx:propose 实现会员付费` | ¥9.9/年微信支付、会员有效期计算（按 cross-cutting-rules §5 公式） |
| 30 | `/opsx:propose add-membership-gate` | `/opsx:propose 实现会员权益门槛` | 在 `/slots` 和 `POST /orders` 接口加 `requireMembership` 中间件 + 前端遮罩 |
| 31 | `/opsx:propose add-referral` | `/opsx:propose 实现拉新奖励` | 邀请码、邀请新用户/推荐门店奖励 3 个月、防作弊；在 user-profile 注册接口和 store-application 审核接口里直接调用 referral.grant() |

**阶段验收**：试用到期后看不到可预约时段；付费后恢复；邀请新用户自动 +3 个月。

---

## 阶段 10：商家入驻（预计 2-3 天）

| # | 英文命令 | 中文命令 | 说明 |
|---|---|---|---|
| 32 | `/opsx:propose add-store-application-form` | `/opsx:propose 开发商家入驻表单` | 小程序入驻表单 3 步（门店信息/经营者信息/资质材料）、查看进度 |
| 33 | `/opsx:propose add-store-application-review` | `/opsx:propose 实现入驻审核流程` | 运营后台审核列表、详情、通过/拒绝、微信通知、通过后自动开通门店账号；通过时调用 referral.grant() 发放推荐人奖励 |

**阶段验收**：用户能在小程序提交入驻申请；运营审核通过后自动建门店并通知。

---

## 阶段 11：门店后台（预计 4-6 天）

| # | 英文命令 | 中文命令 | 说明 |
|---|---|---|---|
| 34 | `/opsx:propose add-store-admin-dashboard` | `/opsx:propose 开发门店后台数据看板` | 数据看板：今日/本周/本月预约数、完成数、取消数、翻台率、顾问利用率（多表聚合用 Drizzle `sql` 模板写原生 SQL） |
| 35 | `/opsx:propose add-store-admin-staff` | `/opsx:propose 开发门店员工管理` | 员工管理页：顾问列表、UID 添加、编辑、移除、批量自动确认开关 |
| 36 | `/opsx:propose add-store-admin-schedule` | `/opsx:propose 开发门店排班管理` | 排班管理页：周/日/月视图、批量排班、模板复用、冲突面板 |
| 37 | `/opsx:propose add-store-admin-order` | `/opsx:propose 开发门店订单管理` | 订单管理：列表、详情、异常处理、爽约管理、按门店爽约解除 |

**阶段验收**：门店管理员能在 Web 端完成全部日常运营操作。

---

## 阶段 12：运营后台 + Banner（预计 3-4 天）

| # | 英文命令 | 中文命令 | 说明 |
|---|---|---|---|
| 38 | `/opsx:propose add-admin-dashboard` | `/opsx:propose 开发运营后台数据大盘` | 全平台数据大盘：用户/门店/顾问/订单/GMV、趋势图（多表聚合用 Drizzle） |
| 39 | `/opsx:propose add-banner-mgmt` | `/opsx:propose 开发轮播图管理` | 首页轮播图管理：CRUD、排序、上下线、跳转目标配置 |
| 40 | `/opsx:propose add-admin-user-mgmt` | `/opsx:propose 开发用户管理` | 用户列表、详情（含按门店爽约明细）、全局冻结/解冻、按门店解除爽约 |
| 41 | `/opsx:propose add-admin-membership-mgmt` | `/opsx:propose 开发会员管理` | 会员数据概览、会员列表、试用期/价格/拉新奖励配置 |

**阶段验收**：运营能上下线门店、配置 Banner、管理用户和会员。

---

## 阶段 13：事件总线改造（预计 2-3 天，MVP 收尾 / v2.0 准备）

| # | 英文命令 | 中文命令 | 说明 |
|---|---|---|---|
| 42 | `/opsx:propose add-rabbitmq-events` | `/opsx:propose 引入RabbitMQ事件总线` | 引入 RabbitMQ + outbox pattern；建 `event_outbox` 表 + outbox worker、死信交换机；迁移 4 个高扇出调用（`order.created` / `order.completed` / `user.registered` / `store.application.approved`）从直接函数调用到事件 publish/consume；补齐 RabbitMQ testcontainers + consumer 测试 harness + 去重测试约定；创建 `openspec/events.md` 维护事件清单 |

**阶段验收**：迁移后行为不变（阶段 1-12 的所有集成测试全过）；4 个事件 publish 后能被对应 consumer 收到且幂等（同 event_id 重复 publish 不重复处理）。

> 阶段 13 严格上是"MVP 收尾 + v2.0 准备"。如果上线压力大可以**先在阶段 12 结束时上线，再回头做 #42**。所有阶段 1-12 的代码不应该预留任何"假事件接口"，避免提前抽象——直接函数调用是显式约定。

---

# 🔮 v2.0 路线图（阶段 14-17）

以下阶段属于 **v2.0 功能**，**不在 MVP 范围内**。建议先把阶段 1-13 跑完上线、跑一段时间收集用户反馈后，再按业务优先级选择性穿插实施。

⚠️ **每个 v2.0 change 命名都带 `v2-` 前缀**，避免和 MVP change 混淆。

---

## 🔮 阶段 14（v2.0）：核心增长功能（预计 4-6 天）

| # | 英文命令 | 中文命令 | 说明 |
|---|---|---|---|
| 43 | `/opsx:propose v2-add-recurring-booking` | `/opsx:propose v2新增周期自动预约` | **PRD 核心亮点**：用户开启后每 7/10/15/20 天自动预约同一顾问、到期前提醒；BullMQ 调度 + 用户可随时关闭/调整；冲突时降级为提醒 |
| 44 | `/opsx:propose v2-add-consultant-time-block` | `/opsx:propose v2新增顾问时段禁用` | 顾问工作台手动设置某天/某时段禁止预约（私事、培训、外出等），独立于 schedule-override |

---

## 🔮 阶段 15（v2.0）：商业模型升级（预计 6-8 天）

| # | 英文命令 | 中文命令 | 说明 |
|---|---|---|---|
| 45 | `/opsx:propose v2-add-online-payment` | `/opsx:propose v2接入在线支付` | 接入微信支付到订单流程；支持预约付款（下单付）/ 到店付款（顾问端确认收款）；退款流程；对账 |
| 46 | `/opsx:propose v2-add-membership-multi-tier` | `/opsx:propose v2会员多档位` | 多档会员（如 9.9 / 99 / 199 年），不同档位不同权益；会员升级降级规则 |
| 47 | `/opsx:propose v2-add-points-system` | `/opsx:propose v2积分系统` | 消费/活动得积分、积分商城、积分抵扣 |
| 48 | `/opsx:propose v2-add-coupon-system` | `/opsx:propose v2优惠券系统` | 优惠券发放（系统/活动/拉新）、领取、核销、规则引擎 |

---

## 🔮 阶段 16（v2.0）：用户沟通（预计 5-7 天）

| # | 英文命令 | 中文命令 | 说明 |
|---|---|---|---|
| 49 | `/opsx:propose v2-add-im-system` | `/opsx:propose v2用户顾问IM` | 用户与顾问在线聊天：WebSocket 长连、消息存储、未读计数、消息撤回、图片/语音消息；接入门槛是消息合规（敏感词/审计） |

---

## 🔮 阶段 17（v2.0）：运营增强（预计 5-7 天）

| # | 英文命令 | 中文命令 | 说明 |
|---|---|---|---|
| 50 | `/opsx:propose v2-add-advanced-analytics` | `/opsx:propose v2高级数据分析` | 客户画像（活跃度/RFM/喜好标签）、流失预警、经营建议（基于规则） |
| 51 | `/opsx:propose v2-add-anomaly-alert` | `/opsx:propose v2异常预警` | 差评率突增、爽约率过高、订单量异常下降自动预警；告警推送（短信/邮件/订阅消息） |
| 52 | `/opsx:propose v2-add-admin-platform-config` | `/opsx:propose v2平台规则配置` | 全局取消规则、爽约处罚规则、入驻协议模板管理、消息模板管理 |
| 53 | `/opsx:propose v2-add-banner-analytics` | `/opsx:propose v2轮播图数据分析` | Banner 曝光量、点击率、转化率统计；扩展 P1 Banner（新店开业优惠、潮流趋势等） |

---

> 📌 **v3.0 不在此清单**。PRD §11.3 提到的多门店连锁、独立 App、AI 推荐、开放平台属于 v3.0 范畴，差不多是一个新项目了，等 v2.0 稳定后再做专门规划。

---

## 里程碑

| 里程碑 | 完成的 propose | 价值 |
|---|---|---|
| **能下单** | 1 → 18 | 后端闭环跑通，可以用 curl 走完整业务 |
| **能用** | 1 → 24 | 用户端可演示，能给真实用户试用 |
| **顾问可接单** | 1 → 27 | 真实门店+顾问能跑业务 |
| **能收钱** | 1 → 31 | 会员付费跑通，商业闭环 |
| **能开店** | 1 → 37 | 门店能自主运营，平台不需要人工介入 |
| **MVP 上线** | 1 → 41 | 全功能可上线（事件总线改造可后置） |
| **v2.0 准备就绪** | 1 → 42 | RabbitMQ 就位，可承接多消费者/多服务扩展 |
| 🔮 **v2.0 增长** | 43, 44 | 周期自动预约 + 顾问时段禁用——PRD 核心亮点，能显著提升留存 |
| 🔮 **v2.0 商业** | 45-48 | 在线支付 + 多档位会员 + 积分 + 优惠券——商业模型成熟 |
| 🔮 **v2.0 沟通** | 49 | IM 即时通讯——用户 ↔ 顾问深度互动 |
| 🔮 **v2.0 运营** | 50-53 | 高级数据 + 异常预警 + 平台配置 + Banner 数据 |

## 总工期估算

| 阶段 | 天数 |
|---|---|
| 1（地基） | 4-5 天 |
| 2-6（后端核心闭环） | 17-20 天 |
| 7（用户端页面） | 5-7 天 |
| 8（评价+工作台） | 3-4 天 |
| 9（会员制） | 3-4 天 |
| 10（入驻） | 2-3 天 |
| 11（门店后台） | 4-6 天 |
| 12（运营后台） | 3-4 天 |
| **MVP 主体合计** | **41-54 天人日** |
| 13（事件总线改造，可后置） | 2-3 天 |
| **含 v2.0 准备合计** | **43-57 天人日** |
| 🔮 14（v2.0 核心增长） | 4-6 天 |
| 🔮 15（v2.0 商业） | 6-8 天 |
| 🔮 16（v2.0 IM） | 5-7 天 |
| 🔮 17（v2.0 运营增强） | 5-7 天 |
| 🔮 **v2.0 路线图合计** | **20-28 天人日** |

按一天 1 个 change 推进：

- **MVP（#1-#42）**：~7-9 周交付
- **v2.0（#43-#53）**：MVP 上线后按业务优先级穿插，~3-4 周完整实施

## 注意事项

1. **严格按顺序**：依赖关系都在 [openspec/capability-map.md](openspec/capability-map.md) 里。跳过前置 change 会导致后续 change 没法 apply。
2. **每个 propose 前先读三份文档**：[openspec/project.md](openspec/project.md)、[openspec/capability-map.md](openspec/capability-map.md)、[openspec/cross-cutting-rules.md](openspec/cross-cutting-rules.md)。
3. **横切规则改动**：任何修改 cross-cutting-rules 的 change 必须用 `/opsx:propose update-cross-cutting-<topic>` 命名，proposal 顶部 ⚠️ 标注。
4. **slot-engine（#15）是项目最大风险**：单独留 5 天，不要赶。
5. **微信小程序提审**：阶段 7 末尾启动准备，审核需 1-3 天。
6. **中文命令对应的英文目录名**：opsx 自动总结生成，绝大多数情况下和本表的英文命令一致。如果你需要稳定的目录名（比如已经在 git 里用了某个名字），建议用英文版避免歧义。
7. **add-queue-infra（#2）是后续大量 change 的依赖**：会员到期提醒、爽约自动检测、订阅消息发送、孤儿文件清理等都依赖它。不要省略。
8. **跨能力调用走直接函数调用**（阶段 1-12）：订单创建后通知、用户注册后发奖励等都是 `await otherService.handle(payload)`。**阶段 13 会把高扇出调用迁移到 RabbitMQ 事件**，详见 [cross-cutting-rules §13](openspec/cross-cutting-rules.md)。
9. **严禁提前抽象事件接口**：阶段 1-12 写 `EventEmitter` / `Pub<T>` 这种"为以后准备"的接口是反模式。重构比抽象便宜，阶段 13 重构时直接把直接调用换成 publish。
10. **只用 Drizzle，不引入 Kysely**：dashboards 多表聚合用 Drizzle 的 `sql` 模板写原生 SQL 即可；少一个查询库少一份认知负担。
11. **MVP 上线可以选择**：紧的话 `1 → 41` 就上线，#42 上线后再补；松的话 `1 → 42` 一起上。
12. **v2.0 change 必须用 `v2-` 前缀**：`v2-add-recurring-booking` 而不是 `add-recurring-booking`，避免和 MVP change 混淆，also 方便筛选 v2.0 工作量。
13. **v2.0 不要按顺序做**：阶段 14-17 不是依赖链，按业务价值/用户反馈优先级选做。例如：先做 #44 周期自动预约（留存利器），再做 #46 在线支付（付费转化）。
14. **v3.0 不在此清单**：连锁多店、App、AI、开放平台属于 v3.0 范畴，等 v2.0 稳定后单独规划。
