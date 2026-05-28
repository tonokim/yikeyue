## Context

#1 已建 HTTP/ctx/db/Redis/测试基线，#2 已建 BullMQ 调度与 worker。本 change 封装七牛云 Kodo，是评价图、作品、门店照、轮播图、入驻资质等所有上传场景的共同依赖，也是 phase 1 的收尾（验收含「用七牛 token 直传图片」）。

约束来自 cross-cutting §7：两 bucket（私有资质 / 公开其他）、scoped token（bucket:key 前缀 + 大小 + mime 白名单 + ≤5min TTL）、key 命名 `<capability>/<entity_id>/<yyyymm>/<cuid2>.<ext>`、上传后调业务接口确认绑定、孤儿由定时任务清理；§12：`storage:orphan-cleanup` 走 BullMQ。

## Goals / Non-Goals

**Goals:**

- scoped upload token 签发 + `/upload/token` endpoint + 可扩展上传策略注册表。
- 两 bucket 分工 + 私有签名 URL / 公开 CDN URL。
- key 命名规则 helper。
- upload 意图表 + `confirmUpload` 绑定确认。
- `storage:orphan-cleanup` 孤儿清理 job。
- 七牛外部 API 的可控测试方式。

**Non-Goals:**

- 资质图片水印（v2.0）。
- 具体业务上传策略与业务绑定 endpoint（各 capability）。
- 自建存储 / 服务器中转。

## Decisions

### D1：孤儿检测用 upload 意图表 + 显式 confirmUpload，而非扫 bucket 反查

`/upload/token` 签发即插一条 `upload`（status=pending、key、capability、entity_id?、expires_at）。业务持久化 key 时调 `storage.confirmUpload(key)` 置 confirmed。清理 job 删 pending 超 24h 的（七牛文件 + 行）。
**Alternative（已否决）**：清理 job 扫 bucket 全量 key、逐个反查所有业务表是否引用。否决理由：与每个 capability 的 schema 强耦合、随业务表增多无限膨胀、扫描成本高；意图表把「是否绑定」收敛成一个状态位，与业务 schema 解耦。
**代价**：业务写 key 时必须记得调 `confirmUpload`——用评审守则 + 契约测试约束；漏调最坏结果是文件被误清理（24h 窗口足够）。

### D2：upload token 本地 HMAC 生成，不调七牛 API

七牛 upload token 是用 secretKey 本地 HMAC 签名的 policy（含 scope/deadline/fsizeLimit/mimeLimit），签发不需网络。故 token 签发、私有 URL 签名、key 命名都是**纯函数**，可直接单测，无需 fake。只有删除 / stat 等管理类操作走网络。
**理由**：让最核心、最易错的逻辑（token policy、签名）完全可测且零外部依赖。

### D3：七牛管理类调用走可注入 client，复用 #3 的外部 API 测试模式

删除（清理 job）、stat 等依赖一个可注入的七牛 client（base URL/凭证可配），测试指向 fake。与 #3 微信一致：cross-cutting §14「不 mock 外部依赖」只针对可容器化的 PG/Redis，不含七牛这类第三方 SaaS。

### D4：上传策略注册表，本次空 + 一个 demo 策略

策略登记 `{ capability, bucket, allowedMime[], maxSizeBytes }`，capability 为联合类型。`/upload/token` 按策略校验并决定 bucket（资质 → 私有，其余 → 公开）。本次注册表为空 + 一个 demo 策略（用于 phase 1 闭环验收「token 直传」），业务 capability 各自注册。
**理由**：与 #2 ping 队列、#3 空模板一致；避免提前替业务定 mime/大小。

### D5：bucket 路由由策略的 bucket 字段决定

私有 vs 公开不由调用方自由指定，而由该 capability 的策略固定（资质类策略 bucket=private，其余=public）。防止业务误把资质传到公开 bucket。

## Risks / Trade-offs

- **业务漏调 confirmUpload → 文件被误清理** → 清理只删 pending 超 24h；评审守则要求「写 key 必 confirm」；可加契约测试覆盖典型上传 capability。
- **fake 七牛与真实行为漂移** → token policy 字段按七牛文档构造；上线前用真凭证手动联调一次（非 CI）。
- **私有 URL TTL 取值** → 取较短（如 5-10min）平衡可用性与泄露窗口；运营审核场景够用。
- **upload 表无限增长** → confirmed 记录可保留（用于审计/统计）或定期归档；本次先保留，量大后再加归档 job。
- **entity_id 在签发时可能尚不存在**（先传图再建记录，如评价）→ 意图表 entity_id 允许为空，key 用临时占位或 capability 级前缀；confirm 时回填关联。

## Migration Plan

依赖 #1、#2 已落地。落地顺序：七牛配置 + 可注入 client → key 命名 helper → token 签发（本地 HMAC）→ 上传策略注册表 + `/upload/token` 路由 → 私有/公开 URL 生成 → `upload` 表 + 迁移 → `confirmUpload` → `storage:orphan-cleanup` job → fake 七牛测试 harness + 测试。生产新增七牛 env；worker 进程开始跑 `storage:orphan-cleanup`。`upload` 表为本 change 唯一迁移。

## Open Questions

- 私有 URL 的具体 TTL 与资质水印（PRD §10.2，水印本次不做）——水印留 v2.0，TTL 取值上线前定。
- confirmed upload 记录的归档/保留策略——本次保留，量大后再加归档。
