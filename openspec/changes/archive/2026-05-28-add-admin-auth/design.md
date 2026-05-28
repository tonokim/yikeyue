## Context

#1-#4 地基、#5 身份(weapp 登录 + UID + user 表)已归档。本 change 建后台账号体系:门店后台与运营后台共用同一后端、同一 `admin_user` 表,角色区分权限。它落地 cross-cutting §9(RBAC + 门店数据隔离),并补上 #5 推迟的「店长按 UID 查用户」端点。

约束:§9 角色 super_admin/store_owner/store_staff(+ consultant 仅小程序内)、requireRole 在路由层、门店数据自动按 store_id 隔离不手写;project.md 后台用手机号+密码+JWT。前端骨架未脚手架(#1 spine-only),故 Web 登录页不在本次。

## Goals / Non-Goals

**Goals:**

- admin_user 表 + 角色 + 手机号密码登录(argon2id)+ JWT(role/storeId)。
- requireRole 中间件。
- 门店数据隔离(store-scope helper)。
- 引导 super_admin;店长按 UID 查用户端点。

**Non-Goals:**

- Web 登录页(前端骨架未就位)、运营全量用户管理(#40)、consultant 角色发放(#9)、找回密码/短信、RLS。

## Decisions

### D1:weapp 与 admin 共用 jwt 中间件,token 用 claims 区分主体与角色

infra-api 的 jwt 中间件只验签 + 填 `ctx.user`。weapp token(#5)`sub = user.id`、无 role;admin token `sub = admin_user.id` + `role` + `store_id?`。`ctx.user` 形状容纳 role/storeId(可空),不修改 infra-api spec。requireAuth 判「是否登录」,requireRole 判 `ctx.user.role`。token 含一个主体类型标识(如 `typ: 'admin'|'weapp'`)防止 weapp token 命中 admin 端点。
**理由**:单后端单验签栈,避免两套 JWT;角色信息进 token 省一次 DB 查。

### D2:密码用 argon2id

argon2id 是 OWASP 首选,抗 GPU/ASIC 更强。参数取 OWASP 推荐档(memory/iterations/parallelism)。
**Alternative(已否决)**:bcrypt——够用但抗硬件破解略弱;既然是新建,直接上 argon2id。
**代价**:argon2 含 native 编译,CI/镜像需可编译;testcontainers 不受影响(纯应用层)。

### D3:数据隔离用应用层 store-scope helper,不用 RLS

提供 `withStore(ctx, query)`:对 store 角色,在查询条件上自动 `and(eq(table.storeId, ctx.user.storeId))`;`requireStoreScope` 守卫确保 store 角色带 storeId(缺失即配置错误,拒绝)。所有 store-admin 数据访问经此 helper。
**Alternative(已否决)**:Postgres RLS(session 变量 + 策略)。否决理由:RLS 与 #1 的「每用例 BEGIN/ROLLBACK + ctx.db 注入」事务隔离纠缠复杂,且每张表写策略维护成本高;应用层 helper 简单、显式、可单测。
**代价**:依赖开发者用 helper 而非裸查询——用约定 + 集成测试(跨店访问断言为空/403)兜底;评审守则:store-admin handler 不得直接 `db.select(table)` 绕过 helper。

### D4:门店后台与运营后台共用一个 login 端点

`POST /api/v1/admin/auth/login` 返回 `{ token, role, store_id? }`;前端(store-admin app vs admin app)按 role 各自路由。每个具体端点用 requireRole 精确控制。
**Alternative(已否决)**:store-admin / admin 各自 login 端点。否决理由:同一 admin_user 表 + 同一校验逻辑,拆两个端点是重复;role 已足够区分。

### D5:防账号枚举——登录失败统一错误

「账号不存在」与「密码错误」返回同一个鉴权失败错误与同样的响应时间特征(argon2 验证对不存在账号也走一次 dummy 校验),避免枚举手机号。

### D6:引导 super_admin 来自配置,不硬编码

seed 从 env/配置读引导账号手机号+初始密码(argon2id 哈希后写入),源码无明文。门店账号则在 #33 审核通过时由本能力的「创建账号 + 下发初始密码」逻辑产生。

### D7:按 UID 查用户端点归 auth-admin(RBAC 化暴露),不改 uid-system

端点复用 uid-system 的 `findUserByUid` 服务,叠加 store 角色 RBAC。requirement 写在 auth-admin spec(它是「谁能查 + 端点」),不修改已归档的 uid-system spec。
**理由**:#5 已把「服务」放 uid-system、把「端点」推到本次;端点本质是 RBAC 化暴露,属 auth-admin。

## Risks / Trade-offs

- **开发者绕过 withStore 直接裸查 → 越权读他店数据** → 约定 + 集成测试强制(每个 store-admin 列表端点配「他店数据不可见」用例);评审守则。
- **argon2 native 编译**(CI/Alpine 镜像可能缺编译链) → 镜像装编译依赖或用预编译;验证 CI 通过。
- **role/storeId 进 token 后变更不即时生效**(改了角色/换店,旧 token 仍有效到过期) → token 设合理过期;敏感变更(停用/换店)可加服务端校验或缩短有效期(MVP 先靠过期)。
- **weapp token 误用于 admin 端点**(反之亦然) → token `typ` 标识 + requireRole 双重拦截。
- **引导账号初始密码泄露** → 引导后强制/提示改密;初始密码来自配置不入库明文。

## Migration Plan

依赖 #1-#5 已归档。落地顺序:`admin_user` 表迁移 → argon2id 密码工具 → login 端点(签 role/storeId token)→ requireRole 中间件 → withStore/requireStoreScope 隔离 helper → 修改密码 → 引导 super_admin seed → 店长按 UID 查用户端点 → 共享 schema → 测试。`admin_user` 为本 change 迁移。无存量数据、无回滚需求。

## Open Questions

- 找回密码/短信验证码的方案与时机——本次只做改密 + 运营重置,短信找回后续评估。
- token 有效期与敏感变更(停用/换店)的即时失效策略——MVP 先靠较短有效期,必要时加服务端校验(如 token 版本号/黑名单)。
