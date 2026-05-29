# store Specification

## Purpose
TBD - created by archiving change add-store-crud. Update Purpose after archive.
## Requirements
### Requirement: 门店表与字段

系统 SHALL 建立 `store` 表,包含:name、address、lat/lng、phone、photos、营业时间(`open_at`/`close_at`,`time` 类型)、status、补充信息(area/seat_count/description)、预约规则(`granularity_min`/`max_advance_days`/`min_advance_min`/`cancel_deadline_min`)、`no_show_threshold`、时间字段。营业时间 SHALL 用结构化 `time` 字段(非自由字符串),供 slot-engine 使用。

#### 场景:创建门店带默认预约规则

- **WHEN** 运营创建一个门店且未指定预约规则
- **THEN** 门店获得默认值:granularity 30、max_advance 7 天、min_advance 30 分钟、cancel_deadline 60 分钟、no_show_threshold 3

### Requirement: 运营门店 CRUD

系统 SHALL 提供运营(requireRole super_admin)的门店管理:创建、列表(可按 status 筛选)、详情、编辑(含代配补充信息与预约规则)。

#### 场景:运营创建门店

- **WHEN** super_admin 提交合法门店信息
- **THEN** 门店被创建,初始 status 为 `draft`

#### 场景:非运营无权管理门店

- **WHEN** store_owner 调用运营门店管理端点
- **THEN** 返回 403 `auth.forbidden`

### Requirement: 门店上下线

系统 SHALL 提供运营对门店 status 的流转:`draft`/`online`/`offline`/`frozen`。门店 status 变更 MUST 仅由运营(super_admin)操作。

#### 场景:门店上线

- **WHEN** super_admin 将一个门店置为 `online`
- **THEN** 门店 status 变为 `online`

#### 场景:门店不能自改 status

- **WHEN** store_owner 尝试改本店 status
- **THEN** 被拒绝(该能力不对门店开放)

### Requirement: 门店自管本店信息

系统 SHALL 提供门店(requireRole store_owner + withStore)查看与编辑**本店**的基本信息、补充信息、营业时间、预约规则、照片、所属分类。store_owner MUST NOT 读取或修改其他门店。

#### 场景:店长编辑本店预约规则

- **WHEN** store_owner 修改本店 granularity/营业时间/取消时限
- **THEN** 修改生效,后续 slot 计算使用新规则

#### 场景:店长不能改他店

- **WHEN** store_owner 尝试编辑非本店门店
- **THEN** 被拒绝(403 或不可见)

### Requirement: 预约规则校验

预约规则 SHALL 校验:`granularity_min` ∈ {15,30,60};`cancel_deadline_min` ≤ 1440(24 小时);`min_advance_min` ≥ 0;`max_advance_days` 在合理上限内。非法值 SHALL 返回 400 `validation.invalid_input`。

#### 场景:非法粒度被拒

- **WHEN** 设置 granularity_min = 20
- **THEN** 返回 400 `validation.invalid_input`

### Requirement: 门店照片走对象存储

门店照片 SHALL 通过 infra-storage 上传(公开 bucket):门店注册 `store` 上传策略,编辑保存新照片时 SHALL 对其 key 调用 `confirmUpload`。

#### 场景:保存新照片确认绑定

- **WHEN** 门店编辑提交一组已上传的照片 key
- **THEN** 这些 key 被 `confirmUpload` 置为 confirmed,不会被孤儿清理删除

### Requirement: 门店可见性

仅 `online` 门店 SHALL 对用户端可见;`draft`/`offline`/`frozen` 门店 MUST NOT 出现在面向用户的查询结果中。

#### 场景:下线门店对用户不可见

- **WHEN** 一个门店为 `offline`
- **THEN** 面向用户的门店查询不返回它(运营/门店后台仍可见)

