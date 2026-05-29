## 1. 数据库迁移

- [x] 1.1 在 `apps/server/src/db/schema` 定义 `service` 表(store_id FK、category_id FK service_category、name、price_cents 整型、currency、duration_minutes 整型 notNull、status default active、sort_order、时间)
- [x] 1.2 生成并提交 `service` 迁移,验证空库可幂等应用

## 2. service service

- [x] 2.1 实现 create/update:价格校验(price_cents 非负整数)、时长校验(duration_minutes 正整数必填)
- [x] 2.2 实现分类双重校验:category_id 是启用的全局 service_category(否则 `service.invalid_category`)且属于该门店 store_category(否则 `service.category_not_in_store`)（design D3）
- [x] 2.3 实现 get/list(本店)/setStatus(active/inactive)/delete,单条操作显式校验 store_id 归属本店防 IDOR（design D4）

## 3. 门店后台端点

- [x] 3.1 实现 `/api/v1/store-admin/services`(requireRole store_owner + withStore):create/list/get/update/setStatus/delete,均限本店

## 4. 读取端点

- [x] 4.1 实现 `/api/v1/weapp/stores/:storeId/services`:仅 online 门店返回 active 服务,非 online/不存在 → 404/空（design D5）
- [x] 4.2 实现 `/api/v1/admin/stores/:storeId/services`(requireRole super_admin):返回指定门店全部服务(含 inactive)

## 5. 共享 schema

- [x] 5.1 在 `packages/shared/src/service` 定义服务项目 CRUD 请求/响应的 Zod schema(价格 price_cents 整型、时长必填,边界 snake/camel 显式 transform)

## 6. 测试用例

- [x] 6.1 价格测试:price_cents 整数分读写不丢精度、非整数/负数 → 400
- [x] 6.2 时长测试:缺失/非正 duration_minutes → 400、合法必填通过
- [x] 6.3 分类约束测试:非门店声明分类 → `service.category_not_in_store`、不存在/停用分类 → `service.invalid_category`、合法分类通过
- [x] 6.4 门店 CRUD 测试:店长建/改/列/删本店服务成功、改或删他店服务被拒(IDOR)、非 store 角色 403
- [x] 6.5 上下架测试:inactive 服务对用户端不可见、门店后台仍可见
- [x] 6.6 用户端读取测试:online 门店只返 active、offline/draft 门店服务不可见(404/空)
- [x] 6.7 运营读取测试:super_admin 查到指定门店全部服务(含 inactive)
- [x] 6.8 契约测试:服务项目响应通过 `packages/shared` schema 反向校验,断言金额为整数分字段
