# service-item Specification

## Purpose
TBD - created by archiving change add-service-item. Update Purpose after archive.
## Requirements
### Requirement: 服务项目表与字段

系统 SHALL 建立 `service` 表,包含:`store_id`(FK store)、`category_id`(FK service_category)、`name`、`price_cents`、`currency`、`duration_minutes`、`status`、`sort_order`、时间字段。

#### 场景:服务项目挂在门店下

- **WHEN** 创建一个服务项目
- **THEN** 它必须关联到一个存在的 `store_id`

### Requirement: 价格以整数分存储

服务项目价格 SHALL 用 `price_cents`(整型)+ `currency`(MVP 固定 `CNY`)表示,MUST NOT 使用浮点。读写 SHALL 不丢精度。

#### 场景:价格整数分读写

- **WHEN** 以 `price_cents = 5800`(¥58.00)创建服务项目并读回
- **THEN** 读回值精确为 5800,不发生浮点误差

#### 场景:拒绝非整数/负价格

- **WHEN** 提交非整数或负数的 `price_cents`
- **THEN** 返回 400 `validation.invalid_input`

### Requirement: 服务时长必填

`duration_minutes` SHALL 必填且为正整数,作为后续时段占用计算(slot-engine)的权威时长。MUST NOT 允许为空。

#### 场景:缺时长被拒

- **WHEN** 创建服务项目但未提供 `duration_minutes` 或提供非正值
- **THEN** 返回 400 `validation.invalid_input`

### Requirement: 服务分类约束

服务项目的 `category_id` SHALL 引用一个存在且启用的全局 `service_category`,且 MUST 属于该门店在 `store_category` 已声明的分类集合。不满足任一条件 SHALL 返回 400。

#### 场景:分类必须是门店已声明的分类

- **WHEN** 服务项目指定的 `category_id` 不在该门店的 `store_category` 中
- **THEN** 返回 400 `service.category_not_in_store`

#### 场景:引用不存在/停用分类被拒

- **WHEN** `category_id` 指向不存在或已停用的分类
- **THEN** 返回 400 `service.invalid_category`

### Requirement: 门店服务项目 CRUD

系统 SHALL 提供门店(requireRole store_owner + withStore)对**本店**服务项目的 CRUD:创建、列表、详情、编辑、删除。store_owner MUST NOT 读取或修改其他门店的服务项目。

#### 场景:店长管理本店服务项目

- **WHEN** store_owner 创建/编辑本店服务项目
- **THEN** 操作成功,数据归属本店

#### 场景:不能操作他店服务项目

- **WHEN** store_owner 尝试编辑/删除非本店的服务项目
- **THEN** 返回 403 或 404,不影响他店数据

### Requirement: 服务项目上下架

服务项目 SHALL 有 `status`(`active`/`inactive`)。下架(inactive)的服务项目 SHALL NOT 对用户端展示,但门店后台仍可见与管理。

#### 场景:下架服务项目对用户不可见

- **WHEN** 一个服务项目为 `inactive`
- **THEN** 用户端查询不返回它,门店后台仍可见

### Requirement: 用户端读取门店服务项目

系统 SHALL 提供 `GET /api/v1/weapp/stores/:storeId/services`:仅当门店为 `online` 时返回其 `active` 服务项目;门店非 online 或不存在 SHALL 返回 404 / 空。

#### 场景:用户读取 online 门店的 active 服务

- **WHEN** 用户查询一个 online 门店的服务项目
- **THEN** 只返回该门店的 active 服务项目,不含 inactive

#### 场景:非 online 门店服务不可见

- **WHEN** 用户查询一个 offline/draft 门店的服务项目
- **THEN** 返回 404 或空,不泄露其服务项目

### Requirement: 运营读取门店服务项目

系统 SHALL 提供运营(requireRole super_admin)读取指定门店服务项目的能力(含 active 与 inactive),供运营查看门店详情。

#### 场景:运营查看任意门店服务项目

- **WHEN** super_admin 查询某门店的服务项目
- **THEN** 返回该门店全部服务项目(含 inactive)

