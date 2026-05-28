## Why

身份是所有业务的起点：用户要能微信登录、拿到自己的终身 UID、维护基础资料；门店加顾问、运营冻结用户、跨用户查询都**只认 UID**（绝不暴露 user.id/openid）。本 change 落地三件相互咬合的能力——UID 生成（uid-system）、用户资料与状态（user-profile）、微信登录签发 JWT（auth-weapp）——把 [cross-cutting-rules.md §1](../../cross-cutting-rules.md)（UID 系统）变成可运行代码。它依赖已归档的 `infra-wechat`（`code2Session`）、`infra-api`（jwt/requireAuth/响应封装）、`infra-db`（user 表、cuid2、时间约定）。

## What Changes

- **uid-system**：UID 格式 `EKY + YYYY + 年内自增（补零至少 6 位）`（如 `EKY2026000001`）；按**不透明变长字符串**处理——6 位是补零下限而非容量上限（uid 列 varchar、校验用 `\d{6,}`、年内序号超 99.9 万自然延长为 7 位+，零迁移不破坏存量）；生成**原子、年内序列、全局唯一、终身不变、不可编辑**；`findUserByUid(uid)` 查询服务；约定所有跨用户操作只通过 UID，绝不暴露 user.id/openid。
- **user-profile**：`user` 表（仅身份+资料字段：openid、uid、nickname、avatar、phone、city?、status `active`/`frozen`、时间）；`GET /api/v1/weapp/me`（requireAuth，返回自己的 UID+资料）；资料编辑（昵称、头像）。
- **auth-weapp**：`POST /api/v1/weapp/auth/login`——`code → openid`（调 infra-wechat `code2Session`）→ find-or-create user（首登生成 UID）→ 签发 JWT（HS256，复用 infra-api jwt）；冻结用户拒绝登录。
- 迁移：`user` 表 + `uid_sequence` 年内自增计数表。
- 共享 schema：登录请求/响应、`/me` 响应、资料编辑 schema（`packages/shared`）。

> 本 change **实现**而非**修改**横切规则（§1 UID），无需 ⚠️ 横切规则变更标注。
> ⚠️ cross-cutting §1 的示例 `EKY20260418`（8 位）与规则文字「6 位自增」矛盾；本 change 以**规则文字**为准（`EKY2026000001`），建议另提 change 修正该示例。

## Capabilities

### New Capabilities

- `uid-system`: UID 格式与原子生成（年内序列）、唯一/终身/不可变约束、`findUserByUid` 查询服务、「跨用户操作只走 UID、绝不暴露 user.id/openid」不变量。
- `user-profile`: `user` 表（身份+资料+状态）、`GET /weapp/me`、资料编辑（昵称/头像）、用户状态（active/frozen）。
- `auth-weapp`: 微信 `code` 登录、find-or-create user、签发 JWT、冻结用户拒登。

### Modified Capabilities

（无。复用 `infra-wechat`/`infra-api`/`infra-db`，不修改其 spec。）

## Impact

- **新增代码**：`apps/server/src/user/{uid,user-profile}`、`apps/server/src/auth/auth-weapp`、`/weapp/auth/login` 与 `/weapp/me` 路由、`apps/server/src/db/schema` 增 `user` + `uid_sequence` 表、`packages/shared/src/user`（schema）、`apps/server/tests/{integration,contract}/user`。
- **新增迁移**：`user` 表、`uid_sequence` 计数表。
- **横切契约落地**：cross-cutting §1（UID 唯一对外、跨用户只走 UID）从此 change 起生效；后续 capability（顾问、冻结、订单关联用户）必须通过 UID 查询，不得用 user.id。
- **下游解锁**：`add-admin-auth`（#6，建受 RBAC 保护的 admin 按 UID 查用户端点）、`add-consultant-binding`（#9，UID 加顾问）、`add-membership-trial`（#28，给 user 表加会员字段）、`add-referral`（#31，加 invite_code + 注册时调 referral）、所有需要登录态的 weapp 接口。

## Non-goals

- **不做 admin 按 UID 查用户的 HTTP 端点**：本次只做 `findUserByUid` 服务（可测）；受 `requireRole` 保护的 admin 端点由 `add-admin-auth`（#6）建。⚠️ 对 propose-list #5「admin 通过 UID 查用户」的有意拆分（#5 出服务、#6 出端点）。
- **不做 referral / 邀请关系捕获**：注册时**不**调 referral、不捕获邀请码。referral 在 `add-referral`（#31）接入时再修改注册流程（cross-cutting §13：严禁提前抽象，重构比抽象便宜）。
- **不加会员字段**：`trial_end_at`/`membership_end_at` 由 `add-membership-trial`（#28）以 ALTER 迁移加入；本次 user 表无会员字段，也不存 `membership_status`（cross-cutting §5：现算不存）。
- **不加 `invite_code` 列**：由 `add-referral`（#31）加。
- **不做后台账号/RBAC**：门店/运营手机号+密码登录与 `requireRole` 是 `add-admin-auth`（#6）。
- **不做顾问身份**：consultant 关联是 `add-consultant-binding`（#9）。
- **不做用户密码**：用户端只走微信登录（关键决策已锁定）。
- **不做 refresh token**：MVP 仅签发 access_token，过期重新 `wx.login`。
