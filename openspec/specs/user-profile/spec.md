# user-profile Specification

## Purpose
TBD - created by archiving change add-uid-system. Update Purpose after archive.
## Requirements
### Requirement: user 表与身份字段

系统 SHALL 建立 `user` 表，包含身份与资料字段：`id`（cuid2）、`openid`（唯一）、`uid`（唯一）、`nickname`、`avatar`、`phone`、`city?`、`status`、`created_at`、`updated_at`。`user` 表本次 MUST NOT 包含会员字段（`trial_end_at`/`membership_end_at`）、`membership_status`（按 cross-cutting §5 现算不存）或 `invite_code`（由 referral capability 加）。`openid` SHALL 有唯一约束。

#### 场景：openid 唯一约束

- **WHEN** 尝试以已存在的 openid 再插入一条 user
- **THEN** 被唯一约束阻止，不产生重复用户

### Requirement: 用户状态

用户 SHALL 有 `status` 字段，取值 `active`（正常）或 `frozen`（冻结）。冻结状态用于运营全局封禁（与按门店爽约限制相互独立）。

#### 场景：默认状态为 active

- **WHEN** 创建一个新用户
- **THEN** 其 `status` 为 `active`

### Requirement: 查看本人资料 /me

系统 SHALL 提供 `GET /api/v1/weapp/me`（requireAuth），返回当前登录用户的 UID 与基础资料（nickname/avatar/phone/city/status）。未登录 SHALL 返回 401 `auth.unauthorized`。响应 MUST NOT 包含 user.id 或 openid。

#### 场景：登录用户获取本人资料

- **WHEN** 已登录用户请求 `GET /weapp/me`
- **THEN** 返回其 UID 与基础资料，且不含 user.id/openid

#### 场景：未登录访问 /me

- **WHEN** 未带 token 请求 `GET /weapp/me`
- **THEN** 返回 401 `auth.unauthorized`

### Requirement: 编辑本人资料

系统 SHALL 允许登录用户编辑自己的昵称与头像。其他身份字段（uid/openid/status）MUST NOT 通过该接口修改。

#### 场景：修改昵称与头像

- **WHEN** 登录用户提交新的昵称与头像
- **THEN** 资料更新成功，再次 `GET /me` 返回新值

#### 场景：不能通过资料编辑改 UID/状态

- **WHEN** 资料编辑请求里夹带 uid 或 status 字段
- **THEN** 这些字段被忽略，不被修改
