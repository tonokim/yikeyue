## ADDED Requirements

### Requirement: 顾问表与字段

系统 SHALL 建立 `consultant` 表,包含:`user_id`(FK user)、`store_id`(FK store)、`name`、`avatar`、`experience_years`、`level`、`rating`(默认 0)、`status`(`active`/`inactive`/`left`)、`auto_confirm`(默认 false)、时间。`(user_id, store_id)` SHALL 唯一。

#### 场景:同一用户可在多店各有一条顾问记录

- **WHEN** 门店 A 与门店 B 各自添加同一 UID 的用户为顾问
- **THEN** 产生两条 consultant 记录(分属 A、B),互不冲突

#### 场景:同店不可重复添加

- **WHEN** 同一门店再次添加已是本店顾问的用户
- **THEN** 返回 409 `consultant.already_bound`,不产生重复记录

### Requirement: 按 UID 添加顾问

系统 SHALL 提供 `POST /api/v1/store-admin/consultants`(requireRole store_owner + withStore):接收用户 UID,经 uid-system `findUserByUid` 解析用户,创建本店 consultant 记录并填写顾问资料。UID 不存在 SHALL 返回 404 `consultant.user_not_found`。MUST NOT 通过 user.id 添加,MUST NOT 在响应暴露 user.id/openid。

#### 场景:用有效 UID 添加顾问

- **WHEN** store_owner 用存在的 UID + 顾问资料添加顾问
- **THEN** 创建本店 consultant 记录,响应含 UID 但不含 user.id/openid

#### 场景:UID 不存在

- **WHEN** 用不存在的 UID 添加顾问
- **THEN** 返回 404 `consultant.user_not_found`

### Requirement: 添加/移除顾问通知用户

成功添加顾问后系统 SHALL 通过 `notify.send` 推送微信订阅消息(事件 `consultant.bound`)告知被添加用户;软解绑顾问时 SHALL 推送 `consultant.unbound`。通知 MUST 走集中模板与 notify 服务,MUST NOT 直接调微信接口。

#### 场景:添加后入队通知

- **WHEN** 顾问添加成功
- **THEN** 一条 `consultant.bound` 订阅消息经 notify 服务入队发送给该用户

### Requirement: 顾问信息管理(本店)

系统 SHALL 提供门店(store_owner + withStore)对**本店**顾问的列表(可按 status 筛)、详情、信息编辑(name/avatar/experience_years/level/tags)。store_owner MUST NOT 读取或修改其他门店的顾问;单条操作 SHALL 校验 consultant.store_id 属本店(防 IDOR)。

#### 场景:店长编辑本店顾问资料

- **WHEN** store_owner 修改本店顾问的资料与标签
- **THEN** 更新成功

#### 场景:不能操作他店顾问

- **WHEN** store_owner 用他店顾问的 id 编辑/移除
- **THEN** 返回 404/403,不影响他店数据

### Requirement: 软解绑顾问

移除顾问 SHALL 置 `status = left`(软处理,保留记录),MUST NOT 硬删除。已置 left 的顾问 SHALL NOT 作为在职顾问用于排班/可约计算。

#### 场景:移除顾问保留记录

- **WHEN** store_owner 移除一名顾问
- **THEN** 该 consultant 记录 status 变为 `left`,记录仍存在(供历史)

### Requirement: auto_confirm 默认手动确认

`auto_confirm` 字段 SHALL 默认 false(预约默认需顾问手动确认)。本能力 MUST NOT 提供修改 auto_confirm 的端点(开关由 auto-confirm-toggle 能力提供)。

#### 场景:新顾问默认手动确认

- **WHEN** 创建一名新顾问
- **THEN** 其 `auto_confirm` 为 false

### Requirement: 用户查询本人顾问身份

系统 SHALL 提供 `GET /api/v1/weapp/consultants/me`(requireAuth):返回当前登录用户的 consultant 记录(所属门店、status),供「我的」页判断是否展示顾问工作台入口。非顾问 SHALL 返回空列表。

#### 场景:顾问用户看到自己的顾问身份

- **WHEN** 一个已是顾问的用户请求该接口
- **THEN** 返回其 consultant 记录列表(含所属门店)

#### 场景:非顾问返回空

- **WHEN** 一个不是任何门店顾问的用户请求该接口
- **THEN** 返回空列表

## Error Codes
- `consultant.user_not_found` (404): 提供的 UID 未匹配到任何用户。
- `consultant.already_bound` (409): 该用户已是本店顾问。
- `consultant.consultant_not_found` (404): 请求的顾问不存在或不属于本店。
- `consultant.invalid_tag` (400): 绑定的标签不存在、已停用或 type 非 consultant。
