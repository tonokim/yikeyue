## Context

#1-#8 已归档:地基、身份(user/UID/weapp 登录)、后台账号(auth-admin:requireRole/withStore + 已有 `/store-admin/users/by-uid`)、对象存储、微信(notify 框架 + 空模板注册表)、门店、服务项目。本 change 建 `consultant`(顾问 = 用户在某门店的身份),并补计划缺失的 `tag-library`(顾问标签受控词表,#25 评价复用)。

约束:cross-cutting §1(加顾问只走 UID、绝不暴露 user.id/openid)、§8(通知走集中模板 + notify 服务)、§9(RBAC + 门店数据隔离 withStore)。PRD §5.1「顾问 = 用户另一身份」、§6.2.3 UID 添加流程 + 微信通知、§5.4.1 auto_confirm。

## Goals / Non-Goals

**Goals:**

- consultant 表(用户的门店内身份,(user_id,store_id) 唯一)+ 迁移。
- 按 UID 添加顾问(查用户→建→微信通知)、信息编辑/列表/详情、软解绑。
- tag-library(按 type 区分 consultant/review)+ 运营 CRUD + 顾问标签关联校验。
- 用户端「我的顾问身份」入口判断。
- 注册 `consultant.bound`/`consultant.unbound` 微信模板。

**Non-Goals:**

- 顾问↔服务绑定(#10)、auto_confirm 开关端点(#11)、排班(phase 5)、用户端顾问主页(#22)、工作台(#27)、rating 计算(#25)、离职转单(订单未建)。

## Decisions

### D1:#9 内置 tag-library 作为独立 capability(补计划缺口)

与 #7 补 service-category 同法:计划无标签库 change,但顾问标签、评价标签、PRD §7.2.6 都依赖它。建 `tag` 表带 `type`(consultant/review)区分用途,运营 CRUD,顾问经 `consultant_tag` 关联。
**Alternative(已否决)**:consultant.tags 存 free-form string[]。否决理由:门店乱填、与评价标签不统一、首页/筛选难做受控选项。
**关联**:`consultant_tag` join 表(非数组列),便于按标签筛顾问(phase 7)与 FK 完整性。

### D2:顾问 = 用户的门店内身份,(user_id, store_id) 唯一,允许多店

同一 user 可在多店各有一条 consultant(兼职现实)。唯一约束 `(user_id, store_id)` 防同店重复添加(重复 → 409 `consultant.already_bound`)。consultant 有自己的 name/avatar(艺名/职业形象),独立于 user 的 nickname/avatar。
**理由**:PRD「顾问 = 用户另一身份」+ 现实兼职;唯一约束兜底并发重复添加。

### D3:按 UID 添加,复用 uid-system findUserByUid,绝不碰 user.id

create 端点收 `uid`,服务内 `findUserByUid(uid)` → user_id;不存在 → 404 `consultant.user_not_found`。响应只暴露 UID + 顾问资料,不含 user.id/openid(§1)。
**注**:#6 已有 `/store-admin/users/by-uid` 供前端「查到再确认添加」;本端点是「确认添加」动作,内部再次按 UID 解析(不信任前端传的 user_id)。

### D4:数据隔离 withStore + 单条 store_id 归属校验(防 IDOR)

store-admin 列表经 withStore 注入 store_id;按 consultant.id 的单条操作额外校验 `consultant.store_id == ctx.user.storeId`(同 #8 服务项目的 IDOR 防护)。
**理由**:consultant 有独立 id,光靠列表过滤挡不住「用他店顾问 id 改数据」。

### D5:软解绑(status=left),不硬删

移除顾问置 `status='left'` 保留记录(未来订单历史、评价归属)。slot-engine(#15)只认 `active`。本次不处理在途订单转单(订单未建)。
**理由**:cross-cutting §不硬删业务实体;§13 不提前抽象转单逻辑。

### D6:auto_confirm 字段在本次建、默认 false,开关端点留 #11

PRD「预约默认需顾问手动确认」→ 默认 false。本能力只建列,不出修改端点(#11 出顾问端自改 + 门店端逐个/批量)。
**理由**:capability 拥有自己的字段;开关是独立能力,避免本次提前做。

### D7:注册微信模板,通知经 notify.send

在 infra-wechat `templates.ts` 追加 `consultant.bound`/`consultant.unbound`(模板 ID 来自 env)。添加/移除后调 `notify.send(event, { user }, data)` 入队(§8 去重 + 外部 API 重试)。
**理由**:§8 模板集中 + 单一通知入口;这是 notify 框架(#3)的首个真实业务消费者。

## Risks / Trade-offs

- **IDOR(改他店顾问 id)** → D4 单条 store_id 校验 + 集成测试「操作他店顾问被拒」。
- **微信模板 ID 未就绪**(需真实小程序提审配置) → 模板 ID 走 env;测试用 fake 微信 HTTP 断言入队 + 模板事件,不依赖真实模板。
- **多店顾问的 rating/状态语义** → rating 按 (user,store) 维度独立(每条 consultant 一份),#25 回填到对应门店的 consultant;不做跨店汇总。
- **停用标签 vs 存量顾问标签** → 停用不级联删 consultant_tag(D1/tag spec);新增/改顾问标签时才校验 enabled+type。
- **解绑后用户「我的」入口** → `/weapp/consultants/me` 默认只返非 left(或返回带 status 由前端过滤);本次返回全部带 status,前端按 active 展示入口。

## Migration Plan

依赖 #1-#8 已归档。落地顺序:`tag` 表 → `consultant` 表 → `consultant_tag` 关联表(三张迁移)→ tag-library service + 运营 CRUD 端点 → consultant service(按 UID 建 + 标签校验 + IDOR 归属 + 软解绑)→ store-admin 顾问端点(withStore)→ `/weapp/consultants/me` → 注册 `consultant.bound`/`consultant.unbound` 模板 + 接 notify.send → 共享 schema → 测试。三张表为本 change 迁移。无存量数据、无回滚需求。

## Open Questions

- 用户端顾问主页对外展示哪些字段(rating/作品/可约)——phase 7 #22 定;本次只做本人身份入口判断。
- 离职(status=left)对在途订单的处理——订单能力(#16+)落地后,由相应 change 处理转单/通知,本次只软置 status。
