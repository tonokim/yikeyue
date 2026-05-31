## 1. 数据库迁移

- [x] 1.1 在 `apps/server/src/db/schema` 定义 `consultant_service` 关联表:`consultant_id`(FK consultant)、`service_id`(FK service)、`created_at`,**联合主键 `(consultant_id, service_id)`**(design D1)
- [x] 1.2 为 `consultant_service.service_id` 单列建二级索引 `idx_consultant_service_service_id`(design D8)
- [x] 1.3 生成并提交单张表迁移,验证空库可幂等应用

## 2. service-binding service 核心

- [x] 2.1 实现「本店一致性与 IDOR 防护」校验: 校验 consultant + service 归属本店, 不一致抛 404 (design D2)
- [x] 2.2 实现「顾问可绑校验」:consultant 存在 + 属本店 + `status != 'left'`;不存在/他店 → `consultant_service.consultant_not_found`、left → `consultant_service.consultant_left`(design D3)
- [x] 2.3 实现「服务可绑校验」:service 存在 + 属本店 + `status = 'active'`;不存在/他店 → `consultant_service.service_not_found`、inactive → `consultant_service.service_inactive`(design D3)
- [x] 2.4 实现替换式 diff 算法 `replaceServices(consultantId, serviceIds)`:在单一事务内读现状 → 计算 toAdd/toDelete → bulk insert/delete → 返回最终集合(design D3)
- [x] 2.5 实现单条解绑 `unbind(consultantId, serviceId)`:校验两端归属本店后硬删该行,不存在亦返回成功(幂等,design D3)
- [x] 2.6 实现四个读查询函数(design D5):
  - [x] 2.6.1 `listServicesByConsultantForStoreAdmin(consultantId)`:含 inactive,返 service 基础字段
  - [x] 2.6.2 `listConsultantsByServiceForStoreAdmin(serviceId)`:仅 consultant.status=active,返 id/name/avatar/level,**不含 user.id/openid**
  - [x] 2.6.3 `listConsultantsByServiceForWeapp(storeId, serviceId)`:链路过滤(store online + service active + 服务归属该店 + 顾问 active)
  - [x] 2.6.4 `listServicesByConsultantForWeapp(consultantId)`:链路过滤(顾问 active + 顾问门店 online + service active)

## 3. store-admin 路由

- [x] 3.1 实现 `PUT /api/v1/store-admin/consultants/:consultantId/services`(requireRole store_owner + withStore):入参 `{ service_ids: string[] }`,调用 2.4 替换式 diff,返回最终集合
- [x] 3.2 实现 `DELETE /api/v1/store-admin/consultants/:consultantId/services/:serviceId`(requireRole store_owner + withStore):调用 2.5 单条解绑,响应 204
- [x] 3.3 实现 `GET /api/v1/store-admin/consultants/:consultantId/services`(requireRole store_owner + withStore):调用 2.6.1,返回顾问绑定的服务列表(含 inactive)
- [x] 3.4 实现 `GET /api/v1/store-admin/services/:serviceId/consultants`(requireRole store_owner + withStore):调用 2.6.2,返回 active 顾问列表

## 4. weapp 路由

- [x] 4.1 实现 `GET /api/v1/weapp/stores/:storeId/services/:serviceId/consultants`:调用 2.6.3,前置链路任一不满足返回 404 / 空,**不泄露存在性**(design D5)
- [x] 4.2 实现 `GET /api/v1/weapp/consultants/:consultantId/services`:调用 2.6.4,前置链路任一不满足返回 404 / 空(design D5)

## 5. 共享 Zod schema

- [x] 5.1 在 `packages/shared/src/consultant-service` 定义请求 schema:`replaceServicesRequest`(service_ids 数组)、路径参数
- [x] 5.2 定义响应 schema:`serviceListItem`(店长端含 inactive 字段)、`consultantListItem`(不含 user.id/openid)、`weappServiceListItem`(无 status 字段,仅展示)、`weappConsultantListItem`
- [x] 5.3 在 schema 边界做 snake_case ↔ camelCase 显式 transform

## 6. 错误码注册

- [x] 6.1 在错误码注册表中追加 `consultant_service.consultant_left`(409)、`consultant_service.service_inactive`(409)、`consultant_service.consultant_not_found`(404)、`consultant_service.service_not_found`(404)(design D7)

## 7. 集成测试 - 写入路径

- [x] 7.1 PUT 替换式编辑:[A,B,C] → [A,C,D] 增删差集,响应返回最终集合
- [x] 7.2 PUT 空集合清空全部绑定
- [x] 7.3 PUT 跨店 service_id 整体拒绝(`consultant_service.service_not_found`),事务回滚关联无变化
- [x] 7.4 PUT 含 inactive service 整体拒绝(`consultant_service.service_inactive`),事务回滚
- [x] 7.5 PUT 对 left 顾问拒绝(`consultant_service.consultant_left`)
- [x] 7.6 PUT 跨门店绑定拒绝并返回 404 (`consultant_service.service_not_found` 或 `consultant_service.consultant_not_found`, 顾问 A 店 + 服务 B 店)
- [x] 7.7 DELETE 单条解绑成功(204)
- [x] 7.8 DELETE 不存在的关联幂等(204,关联表无变化)
- [x] 7.9 DELETE 他店顾问 / 他店服务 id 被拒(404 ,不泄露存在性)
- [x] 7.10 联合主键去重:重复 insert 同对 (consultant_id, service_id) 不报错且无重复行
- [x] 7.11 软解绑顾问后存量关联保留(不级联)
- [x] 7.12 服务下架后存量关联保留(不级联);服务再次上架后绑定自动生效

## 8. 集成测试 - 读取路径

- [x] 8.1 store-admin GET 顾问→服务:返回含 inactive 的全部绑定
- [x] 8.2 store-admin GET 服务→顾问:仅 active 顾问、响应不含 user.id/openid
- [x] 8.3 store-admin 跨店读取被拒(404,不泄露)
- [x] 8.4 weapp GET 服务→顾问:online 门店 + active 服务 → 返回 active 顾问
- [x] 8.5 weapp GET 服务→顾问:门店 offline → 404 / 空;服务 inactive → 404 / 空;服务不属该店 → 404
- [x] 8.6 weapp GET 顾问→服务:active 顾问 + online 门店 → 返回 active 服务列表
- [x] 8.7 weapp GET 顾问→服务:顾问 left / 门店非 online → 404 / 空;存量 inactive 服务被过滤

## 9. 鉴权 / RBAC 测试

- [x] 9.1 store-admin 所有端点:非 store_owner 角色 403
- [x] 9.2 store-admin 所有端点:无 withStore 上下文(未挂店)403 / 401
- [x] 9.3 weapp 端点:无需登录(公开接口),按线路过滤可见性

## 10. 契约测试

- [x] 10.1 store-admin 与 weapp 全部响应通过 `packages/shared` Zod schema 反向校验
- [x] 10.2 断言 store-admin 与 weapp 任何顾问列表响应均**不含** `user_id` / `openid` 字段
- [x] 10.3 断言错误响应 `error.code` 均以 `consultant_service.` 前缀

## 11. 文档收尾

- [x] 11.1 在变更目录补 `README` / 注释引用 design D1-D8 决策号供后续 reviewer 快速定位
