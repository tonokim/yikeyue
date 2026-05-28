## 1. 数据库迁移

- [x] 1.1 在 `apps/server/src/db/schema` 定义 `admin_user` 表(id、phone 唯一、password_hash、role、store_id?、name、status、时间);约束 store 角色必须有 store_id、super_admin 不带 store_id
- [x] 1.2 生成并提交 `admin_user` 迁移,验证空库可幂等应用

## 2. 密码安全

- [x] 2.1 引入 `argon2` 依赖,实现 argon2id 哈希/校验工具(OWASP 推荐参数)
- [x] 2.2 实现修改密码(校验旧密码),明文不入库/不入日志

## 3. 登录与 token

- [x] 3.1 实现 `POST /api/v1/admin/auth/login`:校验手机号+密码 → 签 JWT(claims 含 typ=admin、role、store_id)→ 返回 `{ token, role, store_id? }`
- [x] 3.2 登录失败统一错误 + 对不存在账号走 dummy 校验防枚举(design D5);冻结/停用账号拒登

## 4. RBAC 中间件

- [x] 4.1 实现 `requireRole([...])`:未登录 401 `auth.unauthorized`、角色不符 403 `auth.forbidden`;校验 token typ 防 weapp token 误用(design D1)

## 5. 门店数据隔离

- [x] 5.1 实现 `requireStoreScope` 守卫:确保 store 角色携带 store_id,缺失即拒
- [x] 5.2 实现 `withStore(ctx, query)` helper:对 store 角色自动注入 `store_id = ctx.user.storeId`(design D3)

## 6. 引导账号与查用户端点

- [x] 6.1 实现引导 super_admin 的 seed(手机号+初始密码来自配置,argon2id 哈希入库,源码无明文)
- [x] 6.2 实现 `GET /api/v1/store-admin/users/by-uid`(requireRole store 角色):复用 uid-system `findUserByUid`,不含 user.id/openid,UID 不存在 404(design D7)

## 7. 共享 schema

- [x] 7.1 在 `packages/shared/src/admin` 定义登录请求/响应、改密、按 UID 查用户响应的 Zod schema(边界 snake/camel 显式 transform)

## 8. 测试用例

- [x] 8.1 登录集成测试:正确凭证签 token(含 role/storeId)、错误密码失败且不暴露账号是否存在、冻结账号拒登
- [x] 8.2 密码单测:argon2id 哈希非明文、改密校验旧密码
- [x] 8.3 requireRole 集成测试:角色匹配放行、角色不符 403、未登录 401、weapp token 访问 admin 端点被拒
- [x] 8.4 数据隔离集成测试:store_owner 只读到本店数据、跨店访问被拒(他店数据不可见)、store 角色缺 store_id 被 requireStoreScope 拒
- [x] 8.5 引导账号测试:seed 后引导账号可登录并得 super_admin token
- [x] 8.6 按 UID 查用户集成测试:店长查到基础信息不含 user.id/openid、UID 不存在 404、非 store 角色无权
- [x] 8.7 契约测试:登录与查用户响应通过 `packages/shared` schema 反向校验
