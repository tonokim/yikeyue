## Why

门店后台与运营后台需要账号体系:手机号+密码登录、基于角色的权限控制(RBAC),以及门店后台「只能看到自己门店数据」的数据级隔离。本 change 落地 [cross-cutting-rules.md §9](../../cross-cutting-rules.md)(RBAC),建立 `auth-admin` 能力,并补上 #5 推迟到这里的「门店管理员按 UID 查用户」端点(此时 RBAC 已就位)。它依赖已归档的 `infra-api`(jwt/requireAuth/error/响应封装)、`infra-db`(表/迁移)与 `uid-system`(`findUserByUid`)。

## What Changes

- 新增 `admin_user` 表(id、phone 唯一、password_hash、role、store_id?、name、status、时间)+ 迁移。角色:`super_admin`(运营)、`store_owner`(店长)、`store_staff`(门店员工);store 角色 MUST 绑定 `store_id`。
- **手机号+密码登录** `POST /api/v1/admin/auth/login`:argon2id 校验密码 → 签发 JWT(claims 含 role 与 store_id)→ 返回 `{ token, role, store_id? }`。冻结账号拒登。
- **密码安全**:argon2id 哈希,明文 MUST NOT 落库/入日志;提供修改密码;seed 一个引导 `super_admin`。
- **`requireRole([...])` 中间件**(cross-cutting §9):路由层鉴权,未登录 401 `auth.unauthorized`,角色不符 403 `auth.forbidden`。
- **门店数据隔离**:`withStore(ctx, query)` 查询 helper,store-admin 查询经它自动注入 `store_id = ctx.user.storeId`;`requireStoreScope` 守卫确保 store 角色带 store_id;跨店访问被拒。
- **门店管理员按 UID 查用户** `GET /api/v1/store-admin/users/by-uid`(requireRole store 角色):复用 uid-system `findUserByUid`,返回用户基础信息(为 #9 加顾问做前置),满足 phase-2 验收。

> 本 change **实现**而非**修改**横切规则(§9 RBAC),无需 ⚠️ 横切规则变更标注。

## Capabilities

### New Capabilities

- `auth-admin`: 后台账号体系(admin_user 表 + 角色)、手机号+密码登录与 JWT、argon2id 密码安全、`requireRole` 中间件、门店数据级隔离(store-scope helper)、引导 super_admin、门店管理员按 UID 查用户端点。

### Modified Capabilities

(无。复用 `infra-api`/`infra-db`/`uid-system`,不修改其 spec;按 UID 查用户端点作为 auth-admin 的 RBAC 化暴露,不改 uid-system spec。)

## Impact

- **新增代码**:`apps/server/src/auth/auth-admin`(login/password/requireRole/store-scope)、`/admin/auth/login`、`/store-admin/users/by-uid` 路由、`apps/server/src/db/schema` 增 `admin_user` 表、seed 增引导 super_admin、`packages/shared/src/admin`(schema)、`apps/server/tests/{integration,contract}/admin`。
- **新增迁移**:`admin_user` 表。
- **依赖**:`argon2`(含 native 编译)。
- **横切契约落地**:cross-cutting §9(requireRole 在路由层、门店数据自动按 store_id 隔离)从此 change 起生效;后续所有 store-admin/admin 端点必须用 `requireRole` + store 查询走 `withStore`,不得在业务层手写权限/手写 store_id 过滤。
- **下游解锁**:`add-store-crud`(#7,运营建门店,super_admin)、`add-service-item`/`add-consultant-binding` 等所有门店后台能力(store 角色 + 数据隔离)、`add-store-application-review`(#33,审核通过时创建 store_owner 账号)、`add-admin-user-mgmt`(#40,运营全量用户管理)。

## Non-goals

- **不做 Web 登录页**:store-admin/admin 前端骨架尚未脚手架(#1 spine-only 决策),登录页随前端骨架 change 落地;本次只做后端 auth-admin。⚠️ 对 propose-list #6「Web 登录页」的有意推迟。
- **不做运营全量用户管理列表**:`add-admin-user-mgmt`(#40,phase 12)。本次只出 store 角色按 UID 查单个用户。
- **不做门店账号自动开通流程**:入驻审核通过时创建 store_owner 账号在 `add-store-application-review`(#33),本次只提供「创建账号 + 发初始密码」所需的密码/账号能力供其调用。
- **不做 consultant 角色发放**:consultant 是小程序内身份,由 `add-consultant-binding`(#9)/工作台(#27)处理;本次 `requireRole` 支持该角色名,但 admin_user 只含 3 个后台角色。
- **不做找回密码/短信验证码**:MVP 初始密码由审核通过下发、忘记密码先由运营重置;短信找回留后续。
- **不做 RLS**:数据隔离用应用层 `withStore` helper,不引入 Postgres Row-Level Security(避免与 #1 的每用例事务隔离纠缠)。
