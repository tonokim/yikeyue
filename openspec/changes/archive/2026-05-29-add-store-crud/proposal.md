## Why

门店是平台的核心实体:服务项目挂在门店下、顾问绑定门店、排班与时段依赖门店的营业时间与预约规则、爽约按门店累计。本 change 建立 `store` 能力(门店表 + 运营 CRUD + 上下线 + 门店自管),并顺手补上计划缺失的 `service-category`(全局服务分类,store 第一个消费者)。它落地门店预约规则字段(供 phase 5 slot-engine)与爽约阈值(供 #18),依赖已归档的 `auth-admin`(requireRole/withStore)、`infra-storage`(门店照片)、`infra-db`。

## What Changes

- 新增 `store` 表 + 迁移:name、address、lat/lng、phone、photos、营业时间(`open_at`/`close_at` time)、status(`draft`/`online`/`offline`/`frozen`)、补充信息(area/seat_count/description),以及**预约规则字段**(`granularity_min` 15/30/60 默认 30、`max_advance_days` 默认 7、`min_advance_min` 默认 30、`cancel_deadline_min` 默认 60)与 `no_show_threshold`(默认 3)。
- 新增 `service_category` 表(一级分类:理发/美容/按摩…,name/sort_order/enabled)+ `store_category` 关联表 + 迁移。
- **运营门店 CRUD**(requireRole super_admin,`/api/v1/admin/stores`):建店、列表(按 status 筛选)、详情、编辑(含代配补充信息/预约规则)、上线/下线/冻结。
- **门店自管**(requireRole store_owner + withStore,`/api/v1/store-admin/store`):查看与编辑本店基本信息、补充信息、营业时间、预约规则、照片、所属分类;**门店不能改自己的 status**(上下线归运营)。
- **运营服务分类 CRUD**(requireRole super_admin,`/api/v1/admin/service-categories`):增删改、排序、启停。
- 门店照片走 infra-storage:注册 `store` 上传策略(公开 bucket),编辑时对新图 `confirmUpload(keys)`。
- 预约规则校验:granularity ∈ {15,30,60}、cancel_deadline ≤ 24h、max_advance 上限等。

> 本 change **实现**而非**修改**横切规则,无需 ⚠️ 标注。`store` 的预约规则字段是 cross-cutting §3 slot-engine 与 §4 爽约阈值的数据来源,本次只建字段与默认值,引擎在 phase 5/#18 实现。

## Capabilities

### New Capabilities

- `store`: 门店表(信息/照片/营业时间/预约规则/爽约阈值/状态)、运营 CRUD + 上下线、门店自管本店信息与规则、所属分类关联、门店可见性(仅 online 对用户可见)。
- `service-category`: 全局一级服务分类的运营 CRUD(增删改/排序/启停),供 store、service-item(#8)、用户端分类入口/筛选(phase 7)引用。

### Modified Capabilities

(无。复用 `auth-admin`/`infra-storage`/`infra-db`,不修改其 spec。)

## Impact

- **新增代码**:`apps/server/src/store/{store,service-category}`、`/admin/stores`、`/store-admin/store`、`/admin/service-categories` 路由、`apps/server/src/db/schema` 增 `store`/`service_category`/`store_category` 表、注册 `store` 上传策略、`packages/shared/src/store`(schema)、`apps/server/tests/{integration,contract}/store`。
- **新增迁移**:`store`、`service_category`、`store_category` 表。
- **横切契约落地**:门店预约规则成为 slot-engine(#15)与爽约(#18)的权威数据源;所有门店端点用 requireRole + store 自管走 withStore。
- **下游解锁**:`add-service-item`(#8,服务项目挂门店、引用分类)、`add-consultant-binding`(#9,顾问绑门店)、`add-schedule-*`(#12-14,排班依赖营业时间)、`add-slot-engine`(#15,读预约规则)、`add-store-application-review`(#33,审核通过调 store 建店)、用户端门店列表/筛选(phase 7)。

## Non-goals

- **不做服务项目**:service-item 是 #8。本次只建分类与门店,不建服务项目表。
- **不做顾问/预约确认设置**:顾问绑定 #9、自动确认开关 #11。
- **不做标签库**:⚠️ `tag-library`(顾问标签/评价标签,PRD §7.2.6 P0)同样在计划里缺失,但首个消费者是 #9(顾问标签)/#25(评价),不在本次;建议在 #9 落地时一并补 `tag-library`(与本次补 service-category 同法)。
- **不做用户端门店列表/详情/距离排序**:phase 7(#20/#21);本次只产出门店数据与分类、可见性规则。
- **不做门店公告**:PRD §6.2.2 门店公告为 P2,推后。
- **不做门店数据看板**:`add-store-admin-dashboard`(#34)。
- **门店不能自改 status**:上下线/冻结仅运营。
