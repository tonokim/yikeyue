## ADDED Requirements

### Requirement: 微信 code 登录

系统 SHALL 提供 `POST /api/v1/weapp/auth/login`：接收微信登录 code，调用 infra-wechat `code2Session` 换取 openid，按 openid find-or-create user（首次登录创建用户并经 uid-system 生成 UID），签发 JWT（HS256）并返回 access_token 与用户基础资料。

#### 场景：首次登录创建用户并签发 token

- **WHEN** 一个新 openid 第一次用有效 code 登录
- **THEN** 创建 user（生成 UID）并返回 access_token 与基础资料

#### 场景：老用户登录复用同一账号

- **WHEN** 一个已存在 openid 再次登录
- **THEN** 复用已有 user（不新建），返回 access_token 与基础资料

#### 场景：无效 code 登录失败

- **WHEN** 用微信判定无效的 code 登录
- **THEN** 登录失败并返回错误，不创建用户、不签发 token

### Requirement: find-or-create 并发安全

按 openid find-or-create user SHALL 在并发首登场景下不产生重复用户（依赖 openid 唯一约束 + 冲突处理）。

#### 场景：同 openid 并发首登只建一个用户

- **WHEN** 同一 openid 并发发起两次首登
- **THEN** 最终只存在一个该 openid 的用户，两次请求都返回同一账号

### Requirement: 冻结用户拒绝登录

`status = frozen` 的用户 SHALL 被拒绝登录，返回明确的错误，且不签发 token。

#### 场景：冻结用户登录被拒

- **WHEN** 一个 `frozen` 用户尝试登录
- **THEN** 登录被拒绝、不签发 token

### Requirement: 签发的 JWT 内容

签发的 JWT SHALL 以 user.id 为 subject，供 infra-api 的 jwt 中间件解析填充 `ctx.user`。token MUST NOT 在可被前端读取的位置暴露 openid。

#### 场景：token 可被 jwt 中间件解析

- **WHEN** 用登录返回的 access_token 访问 requireAuth 接口
- **THEN** infra-api jwt 中间件校验通过并填充 `ctx.user`
