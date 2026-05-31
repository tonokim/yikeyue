## ADDED Requirements

### Requirement: 关联表与联合主键

系统 SHALL 建立 `consultant_service` 关联表,包含:`consultant_id`(FK consultant)、`service_id`(FK service)、`created_at`,**联合主键 `(consultant_id, service_id)`**。MUST NOT 设置独立 `id`、`updated_at` 或 `status` 字段——关联存在即生效,删除即解绑。

#### 场景:同对绑定只能存在一条

- **WHEN** 对同一 `(consultant_id, service_id)` 重复 insert
- **THEN** DB 因联合主键冲突拒绝,服务端将其视为已绑定(幂等),不报错

#### 场景:同一顾问可绑定多个服务,同一服务可被多个顾问绑定

- **WHEN** 张三绑定 [剪发, 烫染],李四绑定 [剪发]
- **THEN** `consultant_service` 中有 3 行记录,均不冲突

### Requirement: 本店一致性与 IDOR 防护

绑定写入与查询时, 所有顾问与服务必须均属于当前店铺。 任何属于其他店铺或不存在的顾问 ID 或服务 ID, 统一返回 `404` (`consultant_service.consultant_not_found` 或 `consultant_service.service_not_found`), 以防跨店数据泄露, 且 MUST NOT 持久化任何关联行。

#### 场景:跨店绑定被拒

- **WHEN** 请求将 A 店顾问绑定 B 店的服务项目
- **THEN** 返回 404 `consultant_service.service_not_found`, 关联表无新增

### Requirement: 顾问状态拦截(left)

系统 SHALL 在新增绑定时校验 `consultant.status != 'left'`。对 left 顾问新增任意绑定 SHALL 返回 409 `consultant_service.consultant_left`。已存在的关联 MUST NOT 因顾问被软解绑而被级联删除。

#### 场景:不能给已离职顾问加新服务

- **WHEN** 顾问 status=left,请求新增其服务绑定
- **THEN** 返回 409 `consultant_service.consultant_left`

#### 场景:顾问软解绑后存量关联保留

- **WHEN** 顾问绑定了 [剪发, 烫染] 后被置为 left
- **THEN** `consultant_service` 中该顾问的 2 行记录仍存在,未被删除

### Requirement: 服务上下架拦截(inactive)

系统 SHALL 在新增绑定时校验 `service.status = 'active'`。对 inactive 服务新增绑定 SHALL 返回 409 `consultant_service.service_inactive`。已存在的关联 MUST NOT 因服务下架而被级联删除;服务再次上架后 SHALL 重新生效。

#### 场景:不能绑定已下架服务

- **WHEN** 服务 status=inactive,请求将其绑定到某顾问
- **THEN** 返回 409 `consultant_service.service_inactive`

#### 场景:服务下架后存量关联保留

- **WHEN** 已被多名顾问绑定的服务被下架
- **THEN** `consultant_service` 中该服务的关联行全部保留,未被删除

### Requirement: 门店后台替换式编辑顾问服务集合

系统 SHALL 提供 `PUT /api/v1/store-admin/consultants/:consultantId/services`(requireRole store_owner + withStore):请求体 `service_ids: string[]`,服务端在**单一事务**内 diff 出增/删差集并落库。所有 `service_ids` MUST 属本店且 status=active;顾问 MUST 属本店且非 left。

#### 场景:替换式编辑增删差集

- **WHEN** 顾问现绑定 [A, B, C],提交 `service_ids = [A, C, D]`
- **THEN** 单事务内删除关联 B、插入关联 D,A/C 保留;响应返回最终集合 [A, C, D]

#### 场景:空集合表示清空全部绑定

- **WHEN** 提交 `service_ids = []`
- **THEN** 该顾问全部关联被删除,响应返回空集合

#### 场景:任一 service_id 非本店则整体拒绝

- **WHEN** `service_ids` 含一个属他店的 id
- **THEN** 返回 404 `consultant_service.service_not_found`,事务不提交,关联无任何变化

#### 场景:任一 service_id 已下架则整体拒绝

- **WHEN** `service_ids` 含一个 status=inactive 的服务
- **THEN** 返回 409 `consultant_service.service_inactive`,事务不提交,关联无任何变化

### Requirement: 门店后台单条解绑

系统 SHALL 提供 `DELETE /api/v1/store-admin/consultants/:consultantId/services/:serviceId`(requireRole store_owner + withStore):硬删一条关联;顾问与服务 MUST 均属本店;关联不存在时 SHALL 返回 204(幂等)。

#### 场景:单条解绑成功

- **WHEN** store_owner 删除一条本店存在的绑定
- **THEN** `consultant_service` 该行被删除,响应 204

#### 场景:解绑不存在的关联幂等

- **WHEN** store_owner 删除一条本就不存在的绑定(顾问/服务均属本店)
- **THEN** 响应 204,关联表无变化

#### 场景:跨店解绑被拒(IDOR)

- **WHEN** store_owner 用他店顾问或他店服务 id 解绑
- **THEN** 返回 404 `consultant_service.consultant_not_found` 或 `consultant_service.service_not_found`,不泄露存在性

### Requirement: 门店后台读取顾问的服务列表

系统 SHALL 提供 `GET /api/v1/store-admin/consultants/:consultantId/services`(requireRole store_owner + withStore):返回该顾问当前绑定的服务项目列表(含 `inactive`),每项含 `id` / `name` / `price_cents` / `currency` / `duration_minutes` / `category_id` / `status`。顾问 MUST 属本店。

#### 场景:店长查看顾问能做的服务(含下架)

- **WHEN** store_owner 查询本店某顾问的绑定服务
- **THEN** 返回该顾问全部绑定的服务项目,active 与 inactive 都返回

#### 场景:跨店读取被拒

- **WHEN** store_owner 查询他店顾问的服务
- **THEN** 返回 404 `consultant_service.consultant_not_found`

### Requirement: 门店后台读取服务的顾问列表

系统 SHALL 提供 `GET /api/v1/store-admin/services/:serviceId/consultants`(requireRole store_owner + withStore):返回能做该服务的顾问列表(仅 `consultant.status = active`),每项含 `id` / `name` / `avatar` / `level`。服务 MUST 属本店。MUST NOT 在响应暴露 user.id/openid。

#### 场景:店长查看可服务该项目的顾问

- **WHEN** store_owner 查询本店某服务的可服务顾问
- **THEN** 返回 `status=active` 的顾问列表,不含 left/inactive 顾问

#### 场景:响应不含敏感字段

- **WHEN** 解析响应体
- **THEN** 任何条目 MUST NOT 包含 `user_id`、`openid` 字段

### Requirement: 用户端读取门店可做某服务的顾问

系统 SHALL 提供 `GET /api/v1/weapp/stores/:storeId/services/:serviceId/consultants`:仅当门店 `online` 且服务 `active` 且服务 `store_id == :storeId` 时返回 `consultant.status = active` 的顾问列表。任何前置条件不满足 SHALL 返回 404 或空列表,不泄露存在性。响应 MUST NOT 包含 user.id/openid。

#### 场景:online 门店 + active 服务返回可服务顾问

- **WHEN** 用户查询一个 online 门店内一个 active 服务的可服务顾问
- **THEN** 返回 status=active 的顾问列表

#### 场景:门店非 online 不返回

- **WHEN** 门店为 offline/draft
- **THEN** 返回 404 或空列表

#### 场景:服务非 active 不返回

- **WHEN** 服务 status=inactive
- **THEN** 返回 404 或空列表

#### 场景:服务不属该门店不返回

- **WHEN** 路径 `:serviceId` 的 service 不归属 `:storeId`
- **THEN** 返回 404,不泄露存在性

### Requirement: 用户端读取顾问可做的服务

系统 SHALL 提供 `GET /api/v1/weapp/consultants/:consultantId/services`:仅当顾问 `status = active` 且其所属门店 `online` 时,返回其绑定的 `status = active` 服务项目;否则 404 或空。响应每项含 `id` / `name` / `price_cents` / `currency` / `duration_minutes` / `category_id`,MUST NOT 包含 inactive 服务。

#### 场景:active 顾问 + online 门店返回可做服务

- **WHEN** 用户查询一个 active 顾问的可做服务,且其门店 online
- **THEN** 返回该顾问绑定的 active 服务列表

#### 场景:顾问 left 不返回

- **WHEN** 顾问 status=left
- **THEN** 返回 404 或空列表

#### 场景:顾问门店非 online 不返回

- **WHEN** 顾问所属门店为 offline/draft
- **THEN** 返回 404 或空列表

#### 场景:不返回 inactive 服务

- **WHEN** 顾问的存量绑定中含 status=inactive 的服务
- **THEN** 响应仅含 active 服务,inactive 被过滤

### Requirement: 数据隔离与 IDOR 防护

store-admin 单条接口 SHALL 同时校验路径上的 `consultantId` 与 `serviceId` 均归属本店(任一不属则按不存在处理)。MUST NOT 通过 404 与 403 的区别泄露存在性。

#### 场景:他店顾问 id 操作被拒

- **WHEN** store_owner 用他店顾问 id 调用本能力任意 store-admin 端点
- **THEN** 返回 404 `consultant_service.consultant_not_found`,不影响他店数据

#### 场景:他店服务 id 操作被拒

- **WHEN** store_owner 用他店服务 id 调用本能力任意 store-admin 端点
- **THEN** 返回 404 `consultant_service.service_not_found`,不影响他店数据

### Requirement: 错误码命名

本能力的错误码 SHALL 使用 `consultant_service.<snake_case>` 命名空间,MUST NOT 复用 `consultant.*` 或 `service.*` 前缀。定义如下:

- `consultant_service.consultant_left`(409)
- `consultant_service.service_inactive`(409)
- `consultant_service.consultant_not_found`(404)
- `consultant_service.service_not_found`(404)

#### 场景:错误响应带规范前缀

- **WHEN** 任一本能力错误被抛出
- **THEN** 响应 `error.code` 以 `consultant_service.` 开头
