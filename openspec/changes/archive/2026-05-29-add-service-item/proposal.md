## Why

门店要能配置「卖什么」:服务项目(剪发/烫染/按摩等),带价格、时长、分类。它是预约流程的起点(用户先选服务项目),也是 slot-engine 的关键输入——**服务时长决定占用几个连续时段格子**。本 change 建立 `service-item` 能力:门店后台 CRUD,挂在门店下,引用门店已声明的服务分类。依赖已归档的 `store`(门店 + store_category)、`auth-admin`(requireRole/withStore)、`infra-db`(整数分金额约定)。

## What Changes

- 新增 `service` 表 + 迁移:`store_id`(FK)、`category_id`(FK service_category)、`name`、**`price_cents`(整型)+ `currency`(CNY)**、`duration_minutes`(整型,**必填**)、`status`(`active`/`inactive`)、`sort_order`、时间。
- **门店服务项目 CRUD**(requireRole store_owner + withStore,`/api/v1/store-admin/services`):创建、列表、详情、编辑、上/下架(status)、删除。所有操作限本店。
- **分类约束**:`category_id` MUST 是全局有效分类,且 MUST 属于该门店在 `store_category` 已声明的分类集合(服务项的分类必须是门店声明提供的分类之一)。
- **金额整数分**:价格用 `price_cents` 整型 + `currency`,禁止浮点。⚠️ PRD §9 ER 的 `service.price float` 与 infra-db「金额整数分」冲突,以后者为准。
- **时长必填**:`duration_minutes` 必填且为正,作为 slot-engine(#15)计算占用格子的权威值。
- **用户端读取**(`/api/v1/weapp/stores/:storeId/services`):列出某 online 门店的 active 服务项目(供门店详情/预约流程),inactive 与非 online 门店不返回。
- **运营读取**(requireRole super_admin):列出指定门店的服务项目(供运营门店详情查看)。

> 本 change **实现**而非**修改**横切规则,无需 ⚠️ 标注(金额整数分是落地既有约定,非改规则)。

## Capabilities

### New Capabilities

- `service-item`: 门店服务项目(价格整数分/时长必填/分类约束/上下架)、门店后台 CRUD(本店隔离)、用户端读取 active 服务、运营读取、与门店分类的引用约束。

### Modified Capabilities

(无。复用 `store`/`service-category`/`auth-admin`/`infra-db`,不修改其 spec。)

## Impact

- **新增代码**:`apps/server/src/service/{service,router}`、`/store-admin/services`、`/weapp/stores/:storeId/services`、`/admin/stores/:storeId/services` 路由、`apps/server/src/db/schema` 增 `service` 表、`packages/shared/src/service`(schema)、`apps/server/tests/{integration,contract}/service`。
- **新增迁移**:`service` 表(FK 到 store、service_category)。
- **横切契约落地**:服务时长成为 slot-engine(#15)占用计算的权威输入;价格整数分约定在业务表首次落地。
- **下游解锁**:`add-consultant-service-binding`(#10,顾问↔服务多对多)、`add-slot-engine`(#15,读 duration 算格子)、`add-order-create`(#16,下单选服务、快照价格/时长)、用户端门店详情/预约流程(phase 7)。

## Non-goals

- **不做顾问↔服务绑定**:`consultant-service-binding`(#10)。本次服务项目只属于门店,不关联顾问。
- **不做下单/价格快照**:order(#16)下单时如何快照服务价格/时长由订单能力定;本次只提供服务项目数据。
- **不做服务项目图片**:MVP 服务项目无图(PRD ER 无 image 字段);如需后续加。
- **不做多级分类/服务包/SKU**:仅一级分类引用、单一服务项;套餐/组合留后续。
- **不做服务项目分析**:`store-admin` 服务项目分析是 phase 11/数据看板。
- **不在 slot-engine 内取默认时长**:duration 必填,不允许为空靠引擎兜底(把权威值定在服务项目)。
