## Why

顾问是平台的服务提供者,也是「锁定顾问」核心亮点的主体。门店管理员通过用户 UID 把一个普通用户**添加为本店顾问**(顾问 = 用户的另一个身份,同一 user 表),填写顾问资料并通过微信订阅消息通知本人;之后该用户「我的」页面出现顾问工作台入口。本 change 建立 `consultant` 能力,并顺手补上计划缺失的 `tag-library`(顾问标签的受控词表,评价 #25 复用)。依赖已归档的 `store`、`uid-system`/`user-profile`(按 UID 查用户)、`auth-admin`(requireRole/withStore + 已有的按 UID 查用户端点)、`infra-wechat`(订阅消息 notify)。

## What Changes

- 新增 `consultant` 表 + 迁移:`user_id`(FK user)、`store_id`(FK store)、`name`、`avatar`、`experience_years`、`level`(职级)、`rating`(默认 0,由 #25 评价聚合回填)、`status`(`active`/`inactive`/`left`)、`auto_confirm`(默认 **false**,开关端点留 #11)、时间;**`(user_id, store_id)` 唯一**(同一人可在多店各有一条,同店不重复添加)。
- 新增 `tag` 表 + `consultant_tag` 关联表 + 迁移:全局标签含 `type`(`consultant`/`review`)区分用途、`name`、`sort_order`、`enabled`。
- **按 UID 添加顾问**(requireRole store_owner + withStore,`/api/v1/store-admin/consultants`):传 UID → 经 uid-system `findUserByUid` 解析用户 → 校验未在本店重复添加 → 创建 consultant + 绑定标签 → 通过 `notify.send` 推送微信订阅消息「您已被添加为 XX 门店顾问」。
- **顾问信息编辑/列表/详情**(store_owner,本店):改 name/avatar/experience/level/tags、列表(可按 status 筛)、详情。
- **解绑(移除顾问)**:软处理——置 `status = left`(不硬删,保留历史);移除时通知用户(微信订阅消息)。
- **运营标签库 CRUD**(requireRole super_admin,`/api/v1/admin/tags`):按 type 增删改/排序/启停。
- **用户端「我的顾问身份」**(`/api/v1/weapp/consultants/me`,requireAuth):返回当前登录用户的 consultant 记录(在哪些门店),供「我的」页判断是否展示顾问工作台入口。
- 注册微信订阅消息模板:`consultant.bound`(添加通知)、`consultant.unbound`(移除通知)到 `infra-wechat` 的 `templates.ts`(模板 ID 来自 env 配置)。

> 本 change **实现**而非**修改**横切规则,无需 ⚠️ 标注。按 UID 操作、绝不暴露 user.id/openid 是落地 §1。

## Capabilities

### New Capabilities

- `consultant`: 顾问表(用户的门店内身份)、按 UID 添加(查用户→创建→微信通知)、信息编辑/列表/详情、软解绑、`(user_id, store_id)` 唯一、auto_confirm 字段(默认 false,开关留 #11)、用户端查询本人顾问身份。
- `tag-library`: 全局标签受控词表(按 type 区分 consultant/review 用途)、运营 CRUD、顾问↔标签关联与校验,供 consultant 与 review(#25)引用。

### Modified Capabilities

(无。复用 `store`/`uid-system`/`user-profile`/`auth-admin`/`infra-wechat`;在 `infra-wechat` 的模板注册表中**追加**条目,不修改其 spec。)

## Impact

- **新增代码**:`apps/server/src/consultant/{consultant,tag,router}`、`/store-admin/consultants`、`/weapp/consultants/me`、`/admin/tags` 路由、`apps/server/src/db/schema` 增 `consultant`/`tag`/`consultant_tag` 表、`infra-wechat/templates.ts` 注册 `consultant.bound`/`consultant.unbound`、`packages/shared/src/consultant`、`packages/shared/src/tag`(schema)、`apps/server/tests/{integration,contract}/consultant`。
- **新增迁移**:`consultant`、`tag`、`consultant_tag` 表。
- **横切契约落地**:加顾问只走 UID(§1);通知只走 `notify.send` + 集中模板(§8)。
- **下游解锁**:`add-consultant-service-binding`(#10,顾问↔服务)、`add-auto-confirm-toggle`(#11,开关 auto_confirm)、`add-schedule-cycle`(#13,顾问排班)、`add-slot-engine`(#15,顾问 status/绑定校验)、`add-review-system`(#25,复用 tag-library 的 review 标签 + 回填 rating)、`add-consultant-workbench`(#27)、用户端顾问主页(#22)。

## Non-goals

- **不做顾问↔服务项目绑定**:`consultant-service-binding`(#10)。本次顾问不关联服务项目。
- **不做 auto_confirm 开关端点**:本次只建字段(默认 false);顾问端自改 + 门店端逐个/批量开关是 `add-auto-confirm-toggle`(#11)。
- **不做顾问排班**:`schedule-*`(phase 5)。
- **不做用户端顾问主页/作品/可约时段**:phase 7 #22;本次只做「我的顾问身份」入口判断,不做对外顾问展示页。
- **不做顾问工作台 UI**:#27。
- **不做 rating 计算**:本次 rating 字段默认 0,由 #25 评价聚合回填。
- **不做离职自动转单**:PRD 离职处理(自动转单/通知)涉及订单,订单未建(#16+),本次解绑只置 status=left + 通知,不处理在途订单。
