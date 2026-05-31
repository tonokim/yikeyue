## Why

顾问 (#9) 与服务项目 (#8) 已分别建好,但二者尚无关联——下单流程 (#16) 与可约时段计算 (#15) 都需要回答「这个顾问在本店能不能做这个服务」。本 change 建立 `consultant-service-binding` 能力,以**多对多关联表**承载「本店顾问 ↔ 本店服务」的归属,并由门店后台维护:店长开店时一次性勾选「张三能做剪发/烫染、李四只能剪发」,后续下单/排班/可约时段全部以此为准。依赖已归档的 `consultant`(顾问归属本店)、`service-item`(服务项目归属本店)、`auth-admin`(requireRole store_owner + withStore)、`infra-db`(迁移/cuid2)。

## What Changes

- 新增 `consultant_service` 关联表 + 迁移:`consultant_id`(FK consultant)、`service_id`(FK service)、`created_at`;**联合主键 `(consultant_id, service_id)`**(同对绑定只能存在一条,自然去重)。
- **绑定约束(本店一致性与 IDOR 防护)**: 绑定写入与查询时, 顾问与服务必须均属于当前店铺。 传入他店或不存在的 ID 统一返回 `404` (`consultant_service.service_not_found` 或 `consultant_service.consultant_not_found`), 以防跨店数据泄露。 MUST NOT 出现跨门店绑定。
- **顾问状态约束**:不可对 `status = left` 的顾问新增绑定 → `consultant_service.consultant_left`(409);存量绑定不级联清理(保留历史)。
- **服务上下架约束**:不可对 `status = inactive` 的服务项目新增绑定 → `consultant_service.service_inactive`(409);存量绑定不级联清理(服务再次上架仍生效)。
- **门店后台:替换式编辑顾问的服务集合**(requireRole store_owner + withStore,`PUT /api/v1/store-admin/consultants/:consultantId/services`):请求体传 `service_ids: string[]`,服务端 diff 后增/删差集,**单一事务**完成。所有 service_id MUST 属本店且 active,顾问 MUST 属本店且非 left。
- **门店后台:查顾问的服务列表**(`GET /api/v1/store-admin/consultants/:consultantId/services`):返回该顾问当前绑定的服务项目(含基础字段:id/name/price_cents/duration_minutes/category_id/status,含 inactive)。
- **门店后台:查服务的顾问列表**(`GET /api/v1/store-admin/services/:serviceId/consultants`):返回能做该服务的顾问列表(仅 `status = active`),为门店后台「服务详情→可服务顾问」反向视图使用。
- **用户端:查门店可做某服务的顾问**(`GET /api/v1/weapp/stores/:storeId/services/:serviceId/consultants`):仅当门店 online、服务 active 时返回 `status = active` 的顾问列表;否则 404 / 空。供用户端「选了服务再选顾问」分支使用。
- **用户端:查顾问可做的服务**(`GET /api/v1/weapp/consultants/:consultantId/services`):仅当顾问 active 且所在门店 online 时返回其绑定的 `status = active` 服务项目;否则 404 / 空。供用户端「选了顾问再选服务」分支使用。
- **IDOR 防护**:store-admin 单条路径上的 `consultantId` / `serviceId` MUST 校验归属本店;跨店访问 → 404 / 403,不泄露存在性。
- **删除策略**:本 change 提供两种删除入口——(1) 通过替换式 PUT 从集合移除(批量 diff);(2) `DELETE /api/v1/store-admin/consultants/:consultantId/services/:serviceId`(单条解绑)。两者均为**硬删**关联表行(关联表无业务实体语义,只是连线,可直接删;订单一旦创建已快照 service/consultant_id,与本绑定无引用)。
- **运营读取**:不提供。运营后台 MVP 不参与门店日常运营配置(详见 capability-map.md);如有排查需要,走 admin 接口在后续阶段聚合。

> 本 change **实现**而非**修改**横切规则,无需 ⚠️ 标注。

## Capabilities

### New Capabilities

- `consultant-service-binding`: 顾问 ↔ 服务项目 多对多关联表(同店、联合主键去重)、门店后台替换式编辑/单条解绑/正反向查询、用户端「选服务→可服务顾问」与「选顾问→可做服务」两个读接口、本店一致性 + IDOR 防护,为 #11 自动确认、#15 slot-engine 顾问技能校验、#16 下单校验提供「这个顾问能不能做这个服务」的权威数据。

### Modified Capabilities

(无。复用 `consultant`/`service-item`/`auth-admin`/`infra-db`,不修改其 spec。)

## Impact

- **新增代码**:`apps/server/src/consultant/service-binding/{service,router}`、`/api/v1/store-admin/consultants/:consultantId/services`(GET/PUT)、`/api/v1/store-admin/consultants/:consultantId/services/:serviceId`(DELETE)、`/api/v1/store-admin/services/:serviceId/consultants`(GET)、`/api/v1/weapp/stores/:storeId/services/:serviceId/consultants`(GET)、`/api/v1/weapp/consultants/:consultantId/services`(GET) 路由、`apps/server/src/db/schema` 增 `consultant_service` 表、`packages/shared/src/consultant-service`(Zod schema)、`apps/server/tests/{integration,contract}/consultant-service`。
- **新增迁移**:`consultant_service` 关联表(双 FK + 联合主键)。
- **横切契约落地**:门店数据隔离(withStore + 单条 IDOR)在多 FK 场景的首次实践——单条接口需同时校验关联两端均属本店;不暴露 user.id/openid 仍延续 #9 约束。
- **下游解锁**:`add-auto-confirm-toggle`(#11,自动确认开关需先有顾问绑定服务的语义)、`add-slot-engine`(#15,计算可约时段前 MUST 校验顾问绑定了该服务,否则不返回)、`add-order-create`(#16,下单时 MUST 校验顾问 ↔ 服务绑定存在,否则拒单)、用户端顾问主页(#22)展示「我能做这些服务」、门店后台员工管理 (#35) 展示「张三能做的服务」。

## Non-goals

- **不做自动确认开关**:`auto-confirm-toggle`(#11)。本 change 只建立顾问 ↔ 服务的归属,自动确认是顾问字段开关,与服务集合无关。
- **不做服务擅长程度/熟练度/价格覆盖**:绑定关系仅表达「可以做」,不附加分级、加价、个人时长覆盖等元信息;PRD 未定义该需求,MVP 不引入。
- **不做下单时绑定校验**:在 `add-order-create`(#16) 由订单能力调用本能力的查询函数(`isBound(consultantId, serviceId)`)完成,本 change 只暴露查询能力,不在订单流程里写校验代码。
- **不做 slot-engine 集成**:在 `add-slot-engine`(#15) 由 slot-engine 调用本能力查询「这个顾问绑了哪些服务」。本 change 不输出可约时段,不引入「顾问 + 服务 → 时段」逻辑。
- **不做顾问软解绑级联清理**:#9 软解绑置 `status=left`,关联记录保留(供历史订单对账);新增绑定时拦截 left,不回头清理存量。
- **不做服务下架级联清理**:服务下架(inactive)时关联记录保留,服务再次上架后绑定自动生效;新增绑定时拦截 inactive。
- **不做跨门店复制/批量分配模板**:店长每个顾问独立配置;批量勾选 UI 留给门店后台员工管理页(#35)。
- **不做运营后台配置**:运营不参与门店日常运营(capability-map.md);排查需要走 admin 聚合 change。
- **不做绑定变更通知**:绑定调整为门店内部配置,不发微信订阅消息(#9 添加/移除顾问才通知,绑定服务不通知)。
