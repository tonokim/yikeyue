## 1. 数据库迁移

- [x] 1.1 定义 `service_category` 表(name/sort_order/enabled/时间)
- [x] 1.2 定义 `store` 表(name/address/lat/lng/phone/photos/open_at/close_at/status/area/seat_count/description/预约规则字段/no_show_threshold/时间),营业时间用 `time` 字段
- [x] 1.3 定义 `store_category` 关联表(store_id/category_id,FK 到 service_category)
- [x] 1.4 生成并提交三张表迁移,验证空库可幂等应用

## 2. service-category

- [x] 2.1 实现 service-category service(建/改/排序/启停/列表)
- [x] 2.2 实现运营分类端点 `/api/v1/admin/service-categories`(requireRole super_admin)
- [x] 2.3 停用分类保留存量 `store_category` 关联(不级联删除)

## 3. store service 与运营端点

- [x] 3.1 实现 store service(create/update/get/list/setStatus),create 应用预约规则默认值(design D2)
- [x] 3.2 实现预约规则校验(granularity∈{15,30,60}、cancel_deadline≤1440、max_advance 上限)
- [x] 3.3 实现运营门店端点 `/api/v1/admin/stores`(requireRole super_admin):建/列(按 status 筛)/详情/编辑(含代配补充信息)
- [x] 3.4 实现上下线 `/api/v1/admin/stores/:id/status`(draft/online/offline/frozen,仅运营)

## 4. 门店自管端点

- [x] 4.1 实现 `/api/v1/store-admin/store`(requireRole store_owner + withStore):查看与编辑本店(基本/补充/营业时间/预约规则/分类),不含 status
- [x] 4.2 门店端绑定/更新所属分类(写 store_category,校验分类存在)

## 5. 照片与存储

- [x] 5.1 注册 `store` 上传策略到 infra-storage(公开 bucket、image mime、大小上限)
- [x] 5.2 门店/运营保存照片时对新 key 调 `confirmUpload`（design D6）

## 6. 可见性

- [x] 6.1 实现门店可见性规则:面向用户的查询只返 `online`(供 phase 7 复用)

## 7. 共享 schema

- [x] 7.1 在 `packages/shared/src/store` 定义门店 CRUD、自管编辑、分类 CRUD、关联的 Zod schema(边界 snake/camel 显式 transform)

## 8. 测试用例

- [x] 8.1 服务分类测试:运营 CRUD/排序/启停、非运营 403、停用保留存量关联
- [x] 8.2 store 迁移/默认值测试:create 带默认预约规则、营业时间存取为 time
- [x] 8.3 运营门店端点测试:建店(draft)、列表按 status 筛、编辑、上下线、非运营 403
- [x] 8.4 门店自管测试:店长改本店信息/预约规则生效、改他店被拒、不能改 status
- [x] 8.5 预约规则校验测试:非法 granularity/超 24h cancel_deadline → 400
- [x] 8.6 照片测试:保存照片 key 被 confirmUpload(不被孤儿清理)
- [x] 8.7 可见性测试:offline/draft/frozen 门店对用户查询不可见、online 可见
- [x] 8.8 分类关联测试:关联合法分类成功、关联不存在分类被拒
- [x] 8.9 契约测试:门店与分类响应通过 `packages/shared` schema 反向校验
