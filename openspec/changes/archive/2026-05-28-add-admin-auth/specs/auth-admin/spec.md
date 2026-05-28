## ADDED Requirements

### Requirement: 后台账号表与角色

系统 SHALL 建立 `admin_user` 表(id、phone 唯一、password_hash、role、store_id?、name、status、时间)。角色 SHALL 为 `super_admin`、`store_owner`、`store_staff` 之一;`store_owner`/`store_staff` MUST 绑定 `store_id`,`super_admin` MUST NOT 绑定 store_id。

#### 场景:store 角色必须有 store_id

- **WHEN** 创建一个 `store_owner` 账号但未指定 store_id
- **THEN** 创建被拒绝

#### 场景:phone 唯一

- **WHEN** 用已存在的 phone 再创建一个 admin 账号
- **THEN** 被唯一约束阻止

### Requirement: 手机号+密码登录

系统 SHALL 提供 `POST /api/v1/admin/auth/login`:校验手机号+密码后签发 JWT(claims 含 role 与 store_id),返回 `{ token, role, store_id? }`。密码错误或账号不存在 SHALL 返回统一的鉴权失败错误,且 MUST NOT 区分「账号不存在」与「密码错误」以免枚举。

#### 场景:正确凭证登录成功

- **WHEN** 用正确手机号+密码登录
- **THEN** 返回 token 及该账号的 role 与 store_id(若有)

#### 场景:错误密码登录失败

- **WHEN** 用错误密码登录
- **THEN** 返回鉴权失败,不签发 token,且错误信息不暴露账号是否存在

### Requirement: 密码安全

密码 SHALL 用 argon2id 哈希存储,明文 MUST NOT 落库或出现在日志中。系统 SHALL 提供修改密码能力(校验旧密码)。

#### 场景:密码以 argon2id 哈希存储

- **WHEN** 创建账号或设置密码
- **THEN** 库中存储的是 argon2id 哈希,而非明文

#### 场景:修改密码需校验旧密码

- **WHEN** 用错误的旧密码请求修改密码
- **THEN** 修改被拒绝

### Requirement: requireRole 中间件

系统 SHALL 提供 `requireRole([...])` 路由层中间件:未登录返回 401 `auth.unauthorized`;已登录但角色不在允许列表返回 403 `auth.forbidden`。权限判断 SHALL 在路由层完成,MUST NOT 散落在业务层。

#### 场景:角色匹配放行

- **WHEN** `super_admin` 访问 `requireRole([super_admin])` 的端点
- **THEN** 放行

#### 场景:角色不符返回 403

- **WHEN** `store_staff` 访问仅允许 `super_admin` 的端点
- **THEN** 返回 403 `auth.forbidden`

#### 场景:未登录返回 401

- **WHEN** 未带 token 访问受 `requireRole` 保护的端点
- **THEN** 返回 401 `auth.unauthorized`

### Requirement: 门店数据级隔离

门店后台数据访问 SHALL 限定在该账号绑定的 `store_id` 内:store 角色查询经 `withStore(ctx, query)` helper 自动注入 `store_id = ctx.user.storeId`,`requireStoreScope` 守卫确保 store 角色携带 store_id。store 角色 MUST NOT 读到或操作其他门店的数据,业务代码 MUST NOT 手写 store_id 过滤。

#### 场景:store 角色只读到本店数据

- **WHEN** `store_owner` 通过 store-admin 端点查询列表数据
- **THEN** 结果只含其绑定 store_id 的数据,不含其他门店

#### 场景:跨店访问被拒

- **WHEN** `store_owner` 尝试访问/操作不属于本店的资源
- **THEN** 返回 403 或空结果,不泄露他店数据

### Requirement: 冻结账号拒绝登录

`status` 非正常(如停用/冻结)的 admin 账号 SHALL 被拒绝登录,不签发 token。

#### 场景:停用账号登录被拒

- **WHEN** 一个被停用的 admin 账号登录
- **THEN** 登录被拒、不签发 token

### Requirement: 引导 super_admin 账号

系统 SHALL 提供引导一个 `super_admin` 账号的方式(seed),使平台首次可登录运营后台。引导密码 MUST NOT 硬编码在源码,SHALL 来自配置/环境。

#### 场景:引导后可登录运营后台

- **WHEN** 执行引导后用引导账号登录
- **THEN** 登录成功并获得 `super_admin` 角色 token

### Requirement: 门店管理员按 UID 查用户

系统 SHALL 提供 `GET /api/v1/store-admin/users/by-uid`(requireRole store 角色):按 UID 调用 uid-system `findUserByUid` 返回用户基础信息(为加顾问做前置)。响应 MUST NOT 含 user.id/openid;UID 不存在返回 404。

#### 场景:店长按 UID 查到用户

- **WHEN** `store_owner` 用存在的 UID 查询
- **THEN** 返回该用户基础信息,不含 user.id/openid

#### 场景:UID 不存在返回 404

- **WHEN** 用不存在的 UID 查询
- **THEN** 返回 404
