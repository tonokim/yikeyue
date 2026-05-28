## 1. 数据库迁移

- [x] 1.1 在 `apps/server/src/db/schema` 定义 `user` 表（id/openid 唯一/uid 唯一且 **varchar 变长不固定长度**/nickname/avatar/phone/city?/status/created_at/updated_at），不含会员/invite_code 字段
- [x] 1.2 定义 `uid_sequence` 计数表（year 主键、last_seq）
- [x] 1.3 生成并提交 `user` + `uid_sequence` 迁移，验证空库可幂等应用

## 2. uid-system

- [x] 2.1 实现 UID 生成：事务内对 `uid_sequence` 原子 upsert 取年内序号，拼 `EKY+YYYY+序号（补零至少 6 位）`；序号超 999999 自然延长为 7 位+，不截断/不复用（design D1/D2/D8）
- [x] 2.2 实现 `findUserByUid(uid)` 服务，返回基础信息（不含 openid），不存在返回明确「未找到」

## 3. user-profile

- [x] 3.1 实现 `GET /api/v1/weapp/me`（requireAuth），返回 UID+资料，不含 user.id/openid
- [x] 3.2 实现资料编辑（昵称/头像），忽略 uid/openid/status 等非允许字段

## 4. auth-weapp

- [x] 4.1 实现 `POST /api/v1/weapp/auth/login`：调 infra-wechat `code2Session` → openid
- [x] 4.2 实现 find-or-create user（首登生成 UID），openid 唯一约束 + 冲突重读做并发兜底（design D3）
- [x] 4.3 冻结用户（status=frozen）拒绝登录
- [x] 4.4 签发 JWT（HS256，sub=user.id，复用 infra-api jwt），返回 access_token + 基础资料

## 5. 共享 schema

- [x] 5.1 在 `packages/shared/src/user` 定义登录请求/响应、`/me` 响应、资料编辑的 Zod schema（边界 snake/camel 显式 transform）
- [x] 5.2 在 `packages/shared` 定义 UID 校验规则（宽松正则 `^EKY\d{4}\d{6,}$`，兼容 7 位+），供 #9 等下游复用（design D8）

## 6. 测试用例

- [x] 6.1 UID 生成单测：格式正确、年内序号补零至少 6 位、跨年重置、并发不产生重复 UID、序号溢出 6 位时自然延长为 7 位且不复用
- [x] 6.9 UID 校验单测：13 位与 14 位（7 位序号）UID 均通过宽松正则，非法格式被拒
- [x] 6.2 `findUserByUid` 集成测试：查到返回基础信息不含 openid、不存在返回未找到
- [x] 6.3 登录集成测试：新 openid 首登建用户+签 token、老 openid 复用账号、无效 code 失败不建用户（用 fake 微信 HTTP）
- [x] 6.4 并发首登测试：同 openid 并发只建一个用户
- [x] 6.5 冻结拒登测试：frozen 用户登录被拒、不签 token
- [x] 6.6 `/me` 集成测试：登录返回 UID+资料不含 user.id/openid、未登录 401
- [x] 6.7 资料编辑测试：改昵称/头像生效、夹带 uid/status 被忽略
- [x] 6.8 契约测试：登录响应与 `/me` 响应通过 `packages/shared` schema 反向校验，断言响应中不出现 user.id/openid
