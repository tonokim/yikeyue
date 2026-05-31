## Context

#1-#9 已归档:地基、身份(user/UID/weapp 登录)、后台账号(auth-admin:requireRole/withStore)、对象存储、微信(notify 框架 + 模板注册表)、门店、服务项目(#8 `service` 表)、顾问(#9 `consultant` 表)。本 change 建 `consultant-service-binding`(顾问 ↔ 服务项目 多对多关联),为 #11 自动确认开关、#15 slot-engine、#16 下单提供「这个顾问在本店能不能做这个服务」的权威数据。

约束:cross-cutting §1(不暴露 user.id/openid——本能力不直接吐 user 数据,延续 #9 约束)、§9(RBAC + 门店数据隔离 withStore + 单条 IDOR)、§10(错误码 `<capability>.<snake_case>`)。PRD §5.4 顾问主页要展示「能做的服务」、§7.2 下单需校验顾问是否能做选定服务。

## Goals / Non-Goals

**Goals:**

- `consultant_service` 关联表(联合主键 `(consultant_id, service_id)`)+ 迁移。
- 门店后台:替换式编辑顾问服务集合(PUT)、单条解绑(DELETE)、正反向查询(顾问→服务、服务→顾问)。
- 用户端:服务→可服务顾问、顾问→可做服务,两个读接口。
- 本店一致性与 IDOR 防护(只允许操作或查询属于当前门店的顾问与服务)。
- 顾问 left / 服务 inactive 写时拦截,存量不级联清理。
- IDOR 防护:单条路径上的 `consultantId` / `serviceId` 都校验归属本店。

**Non-Goals:**

- 自动确认开关(#11)、slot-engine 集成(#15)、下单校验(#16)、顾问主页/作品(#22)、运营后台配置、跨店复制模板、绑定通知、绑定元信息(熟练度/加价/个人时长覆盖)。

## Decisions

### D1:多对多关联表 `consultant_service`,联合主键 `(consultant_id, service_id)`

最小结构:`consultant_id`(FK consultant)、`service_id`(FK service)、`created_at`,联合主键。无独立 `id`、无 `updated_at`、无 `status`(关联存在 = 绑定生效)。
**Alternative(已否决)**:在 `consultant` 表加 `service_ids: string[]` 数组列。否决理由:无 FK 完整性、无法按 service 反查(WHERE 数组包含 → seq scan)、与 #9 `consultant_tag` 现有 join 表风格不一致。
**Alternative(已否决)**:加 `id` cuid2 + 软删 `status`。否决理由:关联表不是业务实体,只是「连线」;软删带来「已解绑的关联是否还展示」的语义负担;订单 (#16) 创建时会快照 service/consultant_id,不依赖本表保留历史。允许硬删。

### D2:本店一致性与 IDOR 防护

写入(PUT/DELETE)与查询前,在 service 层显式过滤 `store_id = :storeId`。任何属于其他店铺或不存在的顾问 ID 或服务 ID,统一返回 404 `consultant_service.consultant_not_found` 或 `consultant_service.service_not_found` (IDOR 防护,不泄露他店数据存在性)。
**理由**:消除「A 店顾问绑定 B 店服务」这种语义错乱,且同时作为 IDOR 的兜底。
**Alternative(已否决)**:不进行店铺归属校验,或仅在绑定时报错 400 提示跨店。否决理由:非同店绑定请求是 IDOR 攻击或前端严重越界行为,应直接返回 404 隐藏存在性。

### D3:替换式 PUT(diff increments)而非「增 + 删」两个接口

`PUT /store-admin/consultants/:consultantId/services` 收完整 `service_ids: string[]`,服务端读现状 → 计算 `toAdd / toDelete` → 单事务 insert/delete。响应返回最终绑定集合。
**理由**:门店后台「员工→可服务集合」UI 天然是 checkbox 全选展示,PUT 语义对齐前端表单提交;避免并发「半增半删」的中间态。
**Alternative(已否决)**:`POST .../services`(add)+ `DELETE .../services/:serviceId`(remove)两个接口分别管增删。否决理由:前端要发 N 个请求才能完成一次集合编辑,易出半成品;但**保留 DELETE 单条接口**(快速「踢掉一个服务」入口,无需重传整个集合),增不提供 POST(增量批量增由 PUT 承担)。

### D4:写时拦截 left / inactive,存量不级联

新增绑定:服务端校验 `consultant.status != 'left'`(否则 `consultant_service.consultant_left` 409)且 `service.status = 'active'`(否则 `consultant_service.service_inactive` 409)。
存量:#9 顾问软解绑、#8 服务下架,均**不**回头清理关联表。
**理由**:
- 顾问 `left` 后若清理关联,门店再让其回归(置回 active)还得重新勾选——不现实。
- 服务 `inactive` 是「临时下架」语义,再上架时绑定应自动生效。
- 读接口由调用方按需过滤(用户端只显示 active 顾问 + active 服务;门店后台显示全部含 inactive)。

### D5:读接口分四个,各自承担不同场景

| 接口 | 用途 | 过滤 |
|---|---|---|
| `GET /store-admin/consultants/:id/services` | 店长配置面板:看张三现在能做哪些(含已下架) | 不过滤 service.status |
| `GET /store-admin/services/:id/consultants` | 店长「该服务谁能做」反向视图 | 仅 consultant.status=active |
| `GET /weapp/stores/:storeId/services/:serviceId/consultants` | C 端:选了服务再选顾问 | 门店 online + 服务 active + 顾问 active |
| `GET /weapp/consultants/:id/services` | C 端:选了顾问再选服务 | 顾问 active + 门店 online + 服务 active |

**理由**:不同端的「能不能展示」标准不同;不强行复用一个内部 list 函数靠参数开关,保持每个 endpoint 语义独立、SQL 简单、测试清晰。
**Alternative(已否决)**:单一 `list({ consultantId?, serviceId?, scope: 'admin'|'weapp' })`。否决理由:scope 开关导致条件分支爆炸,SQL 难读、测试矩阵翻倍。

### D6:IDOR 防护——单条路径上的 `consultantId` / `serviceId` 都校验本店

PUT/DELETE/GET 单条接口:withStore 注入 `ctx.user.storeId`,服务层 SELECT `consultant` / `service` 时 `WHERE id = ? AND store_id = ?`,任意一边不归本店 → 404(同 #8/#9 IDOR 防护风格,不区分 404 vs 403 避免泄露存在性)。
**理由**:本能力首次出现「单接口同时引用两个独立业务实体 id」,IDOR 面积比 #8/#9 大,必须双端都校验。

### D7:错误码命名

- `consultant_service.consultant_left`(409):顾问已离职
- `consultant_service.service_inactive`(409):服务已下架
- `consultant_service.consultant_not_found`(404):顾问不存在或非本店
- `consultant_service.service_not_found`(404):服务不存在或非本店

不复用 `consultant.*` / `service.*` 前缀,本能力的错误归属本能力 spec(cross-cutting §10:每个 capability 自己的码,禁止重名)。

### D8:DB 索引

联合主键自带 `(consultant_id, service_id)` 索引;为支持「服务→可服务顾问」反查,**额外建 `idx_consultant_service_service_id` 单列索引**(service_id 单字段)。这两个索引覆盖本 change 全部查询路径——按 consultant 查走主键左前缀,按 service 查走单列索引。
**Alternative(已否决)**:再加 `(service_id, consultant_id)` 复合索引。否决理由:本 change 无「按 service_id 查再按 consultant_id 范围过滤」的场景,单列已足够;省一个二级索引的写入开销。

## Risks / Trade-offs

- **跨店绑定/访问防护** → 集成测试必须覆盖「A 店顾问 + B 店 service_id」请求被 404 (IDOR 安全)。
- **存量不级联** → 顾问 left / 服务 inactive 后,管理端列表仍能看到关联;调用方(#11 自动确认/#15 slot-engine/#16 下单)需自行按 status 过滤。本 change 在用户端读接口已过滤,内部消费方在自己的 change 里负责再次过滤(写明在 spec)。
- **替换式 PUT 与并发编辑** → 同一店长两个浏览器标签同时编辑同一顾问,后提交者完全覆盖前者(last-write-wins)。MVP 接受;未来若需乐观锁,可加 `version` 列(本次不做)。
- **关联表行数** → 单店典型 ~50 顾问 × ~30 服务,最坏 1500 行/店;全平台千店量级 ~1.5M 行,索引足够;无需分表。
- **没有 `updated_at`** → 关联无修改语义,只有插入与删除;若未来要做「绑定变更审计」,届时另起 change 加 outbox/event(本次不预抽象)。

## Migration Plan

依赖 #1-#9 已归档(consultant、service 表均在)。落地顺序:`consultant_service` 表迁移(双 FK + 联合主键 + service_id 单列索引)→ service-binding service(本店一致性 join、left/inactive 拦截、diff 算法、IDOR 校验)→ store-admin 路由(PUT 替换、DELETE 单条、GET 正反向)→ weapp 路由(两个读接口含 online/active 链路过滤)→ 共享 schema(`packages/shared/src/consultant-service`)→ 集成 + 契约测试。单表迁移、无存量数据、无回滚需求。

## Open Questions

- 用户端顾问主页(#22)展示绑定服务时,是否要带价格 + 时长 + 分类聚合?——本次只返回最小字段(id/name/price_cents/duration_minutes/category_id/status),具体卡片展示由 #22 决定。
- 门店后台「批量勾选」UI 是否要支持「按分类全选」?——属 #35 员工管理页交互,本次只提供数据接口。
- 顾问从 left 恢复成 active 的流程(#9 未明确)——若未来恢复,本能力关联是否「自动恢复可见」?当前实现:存量关联不删,所以恢复后立即可见,无需额外动作;写明在 spec 风险段。
