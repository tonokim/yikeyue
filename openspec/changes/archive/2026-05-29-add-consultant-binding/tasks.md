## 1. 数据库迁移

- [x] 1.1 在 `apps/server/src/db/schema` 定义 `tag` 表(name、type、sort_order、enabled、时间),`(type, name)` 唯一
- [x] 1.2 定义 `consultant` 表(user_id FK、store_id FK、name、avatar、experience_years、level、rating default 0、status default active、auto_confirm default false、时间),`(user_id, store_id)` 唯一
- [x] 1.3 定义 `consultant_tag` 关联表(consultant_id FK、tag_id FK,联合主键)
- [x] 1.4 生成并提交三张表迁移,验证空库可幂等应用

## 2. tag-library

- [x] 2.1 实现 tag service(create/update/排序/启停/按 type 列表),同 (type,name) 唯一校验(含 DB 唯一约束兜底 → `tag.name_exists`)
- [x] 2.2 实现运营标签端点 `/api/v1/admin/tags`(requireRole super_admin)
- [x] 2.3 实现顾问标签校验 helper:tag 存在 + enabled + type=consultant,否则 `consultant.invalid_tag`;停用标签不级联删除存量关联

## 3. consultant service

- [x] 3.1 实现按 UID 添加:`findUserByUid(uid)` 解析(不存在 → `consultant.user_not_found`)、(user_id,store_id) 唯一(重复 → `consultant.already_bound`)、建 consultant + 绑定标签（design D3）
- [x] 3.2 实现信息编辑/列表(按 status 筛)/详情,单条操作校验 store_id 归属本店防 IDOR（design D4）
- [x] 3.3 实现软解绑:置 status=left,保留记录（design D5）
- [x] 3.4 响应只暴露 UID + 顾问资料,不含 user.id/openid

## 4. 微信通知

- [x] 4.1 在 `infra-wechat/templates.ts` 注册 `consultant.bound`、`consultant.unbound`(模板 ID 来自 env)
- [x] 4.2 添加成功后 `notify.send('consultant.bound', { user }, data)`、软解绑后 `consultant.unbound`,经 notify 服务入队（design D7）

## 5. 端点

- [x] 5.1 实现 `/api/v1/store-admin/consultants`(requireRole store_owner + withStore):add(按 UID)/list/get/update/remove(软解绑)
- [x] 5.2 实现 `/api/v1/weapp/consultants/me`(requireAuth):返回本人 consultant 记录(含门店、status),非顾问返回空

## 6. 共享 schema

- [x] 6.1 在 `packages/shared/src/tag` 定义标签 CRUD 请求/响应 Zod schema
- [x] 6.2 在 `packages/shared/src/consultant` 定义加顾问(含 uid)、编辑、列表/详情、本人身份响应 Zod schema(边界 snake/camel 显式 transform,响应不含 user.id/openid)

## 7. 测试用例

- [x] 7.1 标签库测试:运营按 type CRUD/排序/启停、非运营 403、(type,name) 唯一、停用保留存量关联
- [x] 7.2 加顾问测试:有效 UID 添加成功(响应不含 user.id/openid)、UID 不存在 404、同店重复 409、可在多店各加一条
- [x] 7.3 标签校验测试:绑定 enabled+type=consultant 标签成功、停用/不存在/type=review 标签 → `consultant.invalid_tag`
- [x] 7.4 信息管理测试:店长改/列/详情本店顾问成功、操作他店顾问被拒(IDOR)、非 store 角色 403
- [x] 7.5 软解绑测试:移除置 status=left、记录保留
- [x] 7.6 通知测试:添加后 `consultant.bound` 入队(fake 微信 HTTP 断言入队 + 事件)、解绑后 `consultant.unbound` 入队
- [x] 7.7 auto_confirm 测试:新顾问默认 false、本能力无修改端点
- [x] 7.8 本人身份测试:顾问用户返回其 consultant 记录、非顾问返回空
- [x] 7.9 契约测试:顾问与标签响应通过 `packages/shared` schema 反向校验,断言无 user.id/openid
