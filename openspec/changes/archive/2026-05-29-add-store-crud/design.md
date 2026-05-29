## Context

#1-#6 已归档:地基、身份(weapp/UID/user)、后台账号(auth-admin:requireRole/withStore/store 数据隔离)、对象存储(infra-storage)。本 change 建第一个核心业务实体 `store`,并补计划缺失的 `service-category`。门店的营业时间与预约规则是 phase 5 slot-engine(cross-cutting §3)和 #18 爽约阈值(§4)的权威数据源,所以字段形态要现在定准。

约束:§3 预约规则字段(granularity/maxAdvance/minAdvance/cancelDeadline)、§4 no_show_threshold(默认 3)、§9 RBAC + 门店数据隔离、§7 门店照片走七牛公开 bucket。

## Goals / Non-Goals

**Goals:**

- store 表(信息/照片/营业时间/预约规则/爽约阈值/状态)+ 迁移。
- 运营 CRUD + 上下线;门店自管本店(信息/补充/规则/照片/分类)。
- service-category 表 + 运营 CRUD;store_category 关联。
- 门店照片接 infra-storage;预约规则校验;门店可见性规则。

**Non-Goals:**

- service-item(#8)、顾问/确认设置(#9/#11)、标签库、门店公告(P2)、看板(#34)、用户端列表/距离排序(phase 7)。

## Decisions

### D1:营业时间用结构化 time 字段,不用 PRD ER 的字符串

PRD §9 ER `business_hours` 是字符串「09:00-21:00」,但 slot-engine 需要结构化 `[openAt, closeAt]`。故建 `open_at`/`close_at`(`time` 类型,按 `Asia/Shanghai` 解释,cross-cutting §6)。MVP 单一每日营业时间(非按星期),按星期的可约性由排班(phase 5)表达。
**Alternative(已否决)**:字符串 business_hours。否决理由:slot-engine 要解析、易错;结构化字段从源头规范。

### D2:预约规则字段落在 store 上,带默认值,本次只建不算

granularity_min/max_advance_days/min_advance_min/cancel_deadline_min/no_show_threshold 作为 store 列,带 cross-cutting §3/§4 的默认值(30/7/30/60/3)。本 change 提供「设置/校验」,实际「按规则算时段」是 slot-engine(#15)、「按阈值挡」是 #18。
**理由**:capability 拥有自己的字段;让 #15/#18 直接读 store 而非另建配置表。

### D3:#7 内置 service-category 作为独立 capability(补计划缺口)

capability-map/propose-list 无服务分类 change,但 store/service-item/用户端筛选都依赖它,且 PRD §7.2.6 是 P0。故在 #7 内新建 `service-category`(独立 spec),与 `store` 同 change 落地。一级分类,运营 CRUD。
**Alternative(已否决)**:store 用 free-form 分类字符串。否决理由:破坏数据完整性、首页/筛选难做受控选项;独立受控词表更干净。
**关联**:`store_category` 多对多 join 表(非 store 上的数组列),便于「按分类筛门店」的 FK 整型 join 与索引(phase 7 #20 用)。

### D4:store 状态机 draft → online/offline/frozen,仅运营可改

`draft`(新建未上线)、`online`(用户可见可约)、`offline`(暂时下线)、`frozen`(运营封禁)。门店自管只改信息/规则,**不改 status**(PRD §7.2.2 上下线归运营)。用户端查询只返 `online`。
**理由**:可见性单点收敛在 store status,避免每个用户端查询各自判断。

### D5:同一 store service,两个 namespace 复用

运营端(`/admin/stores`,super_admin,可操作任意门店)与门店端(`/store-admin/store`,store_owner + withStore,仅本店)共用 store service;差异只在 RBAC 与 withStore 注入。门店端编辑字段集是运营端的子集(无 status、无跨店)。
**理由**:避免两套门店读写逻辑;隔离靠 #6 的 withStore 而非重写。

### D6:照片接 infra-storage upload 策略 + confirmUpload

注册 `store` 上传策略(公开 bucket、image mime、大小上限)。门店/运营保存照片提交的是已直传七牛的 key 列表,保存时对新增 key `confirmUpload`,移除的旧 key 可留给孤儿清理或显式删除(MVP 先靠确认 + 孤儿清理)。
**理由**:复用 #4 的 token + 孤儿清理闭环,门店是其首个真实消费者。

## Risks / Trade-offs

- **标签库同样缺失**(顾问/评价标签)→ 本次不顺带做(首个消费者是 #9/#25);在 proposal 显式 flag,建议 #9 补 `tag-library`。
- **门店端绕过 withStore 越权**(同 #6 风险)→ 门店端 store 读写经 withStore + 集成测试「他店不可见」。
- **lat/lng 精度与距离排序**(phase 7 需要)→ 本次只存 lat/lng(float 合法,非金额);距离排序算法在 #20,可能需 PostGIS 或 haversine,留 #20 决定,本次不预设索引方案。
- **max_advance_days 与排班生成窗口耦合**(PRD §6.2.4「设 14 天则生成 14 天」)→ store.max_advance_days 是单一权威值,排班生成(phase 5)读它;本次给上限校验(如 ≤ 30)防滥设。
- **删除分类**:不提供硬删除(停用即可),避免悬空 store_category;若必须删,先校验无引用。

## Migration Plan

依赖 #1-#6 已归档。落地顺序:`service_category` 表 → `store` 表 → `store_category` 关联表(三张迁移)→ service-category 运营 CRUD → store service(建/改/列/详情/上下线)→ 运营端点 → 门店自管端点(withStore)→ 注册 store 上传策略 + 照片 confirmUpload → 预约规则校验 → 可见性过滤 → 共享 schema → 测试。三张表为本 change 迁移。无存量数据、无回滚需求。

## Open Questions

- `tag-library`(标签库)落地位置——建议随 #9(顾问标签首个消费者)补,与本次 service-category 同法。
- 距离排序的实现(PostGIS vs haversine + 索引)——留 phase 7 #20。
- 门店照片移除时是否立即删七牛——MVP 先靠孤儿清理;高频改图再加显式删除。
