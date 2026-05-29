## Context

#1-#7 已归档:地基、身份、后台账号(auth-admin:requireRole/withStore)、对象存储、门店(store + service_category + store_category)。本 change 建 `service-item`——门店下的服务项目。它是预约流程起点(用户先选服务),且 `duration_minutes` 是 slot-engine(#15)计算占用格子的权威输入。

约束:infra-db 金额整数分(`*_cents` 整型,禁止浮点)、cross-cutting §9 RBAC + 门店数据隔离(withStore)、§3 slot-engine 需确定服务时长。复用 #7 的 store_category 受控分类。

## Goals / Non-Goals

**Goals:**

- service 表(store_id/category_id/name/price_cents/currency/duration_minutes/status/sort)+ 迁移。
- 门店后台 CRUD(本店隔离)、上下架。
- 分类约束:category_id 是全局有效分类且属于本店 store_category。
- 价格整数分、时长必填。
- 用户端读 active 服务、运营读全部。

**Non-Goals:**

- 顾问↔服务绑定(#10)、下单/价格快照(#16)、服务图片、多级分类/套餐、服务分析、引擎兜底时长。

## Decisions

### D1:价格用 price_cents 整型,推翻 PRD ER 的 float

PRD §9 ER `service.price float` 与 project.md / infra-db「金额整数分」冲突,以后者为准:`price_cents` 整型 + `currency`。复用 infra-db 的金额 column helper(若已提供)或等价整型列。校验 price_cents 为非负整数。
**理由**:浮点金额是明确反模式;#8 是金额字段在业务表首次落地,必须立规矩,否则 #29 会员、未来支付会跟着 PRD 用 float。

### D2:duration_minutes 必填且为正,不靠引擎兜底

PRD「时长可选」理解为「用户选哪个服务项目」,而非「时长可空」。slot-engine 必须有确定时长算连续格子,故 duration 在服务项目层必填。
**Alternative(已否决)**:可空 + 引擎用 granularity 兜底。否决理由:把权威值分散到引擎、易错;源头必填最干净(已与用户确认)。

### D3:分类双重约束——全局有效 + 属于本店 store_category

category_id 既要是启用的全局 `service_category`,又要在该门店 `store_category` 已声明集合内。两层校验:先查全局启用,再查 store_category 关联。
**理由**:保证「门店只声明了理发,就不能建按摩服务项」的数据一致性,贴合 #7 受控词表的意图。
**代价**:门店改服务分类前要先在门店资料里声明该分类(store_category)。可接受——符合产品逻辑(先声明经营品类,再上架对应服务)。

### D4:数据隔离复用 withStore,本店服务查询自动按 store_id

store-admin 的服务 CRUD 经 withStore 注入 `store_id = ctx.user.storeId`;按 id 操作单条时额外校验该服务的 store_id 属本店(防 IDOR:改他店服务的 id)。
**理由**:cross-cutting §9;且服务表有独立 id,必须显式校验归属,不能只靠 withStore 的列表过滤。

### D5:三个读取面分别开

- store-admin:本店全部(含 inactive),管理用。
- weapp:`/weapp/stores/:storeId/services`,仅 online 门店的 active 服务(预约/详情用)。
- admin(super_admin):指定门店全部,运营查看用。
用户端读取 MUST 校验门店 online(复用 #7 可见性),避免泄露未上线门店的服务。

### D6:删除 vs 下架

提供 `status` 上下架(软)与 delete(硬)。本次无下游引用(consultant-service-binding #10、order #16 尚未建),delete 直接允许。**待 #10/#16 落地后**,删除被引用服务需改为「禁止硬删/级联校验」——在那时的 change 处理,本次不提前抽象。
**理由**:cross-cutting §13 不提前抽象;但在 design 显式记录这个未来约束,避免遗漏。

## Risks / Trade-offs

- **删除被引用服务的未来风险** → 本次无引用方,允许删;在 #10/#16 引入引用时,由那些 change 加「软删/禁删/级联」约束。design 已记录,proposal Non-goal 已划清。
- **IDOR(改他店服务 id)** → 单条操作显式校验 service.store_id == ctx.user.storeId(D4),集成测试覆盖「改他店服务被拒」。
- **category_not_in_store 与门店改分类的时序** → 门店若移除某分类但仍有该分类的服务项,存量服务项不自动失效(本次不级联);新增/改服务项时才校验。可接受,后续可加门店改分类时的提示。
- **price_cents helper 是否存在** → 若 infra-db 未导出通用金额 helper,用整型列 + shared 校验等价实现;不阻塞。

## Migration Plan

依赖 #1-#7 已归档。落地顺序:`service` 表迁移(FK store/service_category)→ service service(create/update/get/list/setStatus/delete,含价格/时长校验 + 分类双重约束 + 本店归属校验)→ store-admin CRUD 端点(withStore)→ weapp 读取端点(online + active)→ admin 读取端点 → 共享 schema → 测试。`service` 为本 change 迁移。无存量数据、无回滚需求。

## Open Questions

- 删除被引用服务的策略——留给 #10(consultant binding)/#16(order)落地时定。
- 服务项目是否需要图片——MVP 不做,后续按产品需要评估。
