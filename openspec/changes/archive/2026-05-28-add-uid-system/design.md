## Context

phase 1 地基（#1-#4）已归档：infra-api（HTTP/ctx/jwt/requireAuth/响应封装/Redis）、infra-wechat（`code2Session`）、infra-db（cuid2/timestamptz/ctx.db/迁移）、infra-queue。本 change 是身份层第一块，三能力咬合落地：uid-system + user-profile + auth-weapp。它是顾问、冻结、订单关联、会员、referral 等的共同前置。

约束：cross-cutting §1（UID 唯一对外、终身不变、跨用户只走 UID、绝不暴露 user.id/openid）；§5（会员状态现算不存，会员字段不在本次）；§13（referral 留到 #31，严禁提前抽象）。用户端无密码，仅微信登录（已锁定决策）。

## Goals / Non-Goals

**Goals:**

- UID 原子生成（年内序列）、唯一/终身/不可变。
- `user` 表（仅身份+资料+状态）+ `/me` + 资料编辑。
- 微信 code 登录 → find-or-create → 签 JWT。
- `findUserByUid` 服务（admin 端点留 #6）。

**Non-Goals:**

- admin 按 UID 查用户的 HTTP 端点（#6）、RBAC。
- referral / 邀请捕获、`invite_code` 列（#31）。
- 会员字段 / `membership_status`（#28、且现算不存）。
- 顾问身份（#9）、用户密码、refresh token。

## Decisions

### D1：UID = EKY + YYYY + 6 位年内自增，跟规则文字（示例视为笔误）

cross-cutting §1 规则文字「EKY + 4 位年份 + 6 位自增」→ `EKY2026000001`（13 位）。示例 `EKY20260418`（8 位）与「6 位」矛盾，**视为笔误**，实现以规则文字为准；建议另提 `update-cross-cutting-uid` 修正示例。序号**按年重置**（年份前缀已区分年份，年内 6 位 ≈ 99.9 万/年新注册额度）。详见 D8 的溢出安全约定。

### D8：6 位是软下限，UID 按不透明变长字符串处理（溢出安全）

容量口径是「**每年新注册** 99.9 万」（按年重置，非总量），对本品类 MVP 到中期几乎不可能触顶。但 UID 终身不变，触顶时绝不能改已发出的 UID，故把「6 位」定为**补零下限而非上限**：年内序号超过 999999 时自然增长为 7 位+（不截断/不复用/不报错）。配套三条让溢出**零迁移、不破坏存量**：
1. `user.uid` 用 **varchar**，不用 `char(13)`——7 位序号直接存。
2. 生成补零到「至少 6 位」，溢出自动延长。
3. UID 校验用宽松正则 `^EKY\d{4}\d{6,}$`（定义在 `packages/shared` 供 #9 等下游复用），不写死 `\d{6}` 或 13 位长度。
**Alternative（已否决）**：现在就上 8 位序号（`EKY202600000001`，15 位）。否决理由：UID 要展示/复制给门店绑顾问，平白变长变丑，换一个大概率用不到的余量；软下限方案兼得「现在短」与「将来不破」。
**触顶后果**：唯一影响是 UID 由 13 位变 14 位+，因按 opaque 变长处理，存量与代码均不受影响。真到单年百万级（v3.0 多城规模）再按需评估号段预分配等优化。

### D2：UID 序号用专用计数表原子 upsert，而非 count(*) 或 Postgres 动态序列

建 `uid_sequence(year PK, last_seq)`，生成时在事务内执行
`INSERT INTO uid_sequence(year, last_seq) VALUES (:y, 1) ON CONFLICT (year) DO UPDATE SET last_seq = uid_sequence.last_seq + 1 RETURNING last_seq`，原子拿到年内序号，拼成 UID。
**Alternative（已否决）**：`count(*) where year=...`（并发竞态、删用户后跳号撞号）；每年建一个 Postgres SEQUENCE（动态 DDL、难迁移）。upsert 计数表简单、原子、可迁移。

### D3：登录用 openid 唯一约束做 find-or-create 并发兜底

`user.openid` 唯一。find-or-create：先按 openid 查；不存在则插入（生成 UID）；并发首登靠唯一约束兜底——捕获唯一冲突后改读已存在记录返回。
**理由**：微信 code 一次性，但同一 openid 可能并发首登（重试/双击），唯一约束 + 冲突重读避免双账号。

### D4：三能力一个 change、三份 spec

按 capability-map 边界拆成 uid-system / user-profile / auth-weapp 三份 spec（与 #1 的 infra-db/log/api 同法），但同一 change 内共同创建——它们强耦合（登录即创建带 UID 的用户）。下游可精确引用具体能力。

### D5：JWT 内容最小化，sub = user.id

token `sub = user.id`（cuid2），由 infra-api jwt 中间件解析填 `ctx.user`。user.id 作为 token subject 是服务端识别手段，不违反 §1（§1 禁止的是在前端展示/URL/响应体暴露 user.id；token 内部 subject 不对前端解析展示）。不放 openid。MVP 不做 refresh token，过期重新 `wx.login`。

### D6：user 表只装本能力字段，其余能力各自 ALTER

本次字段：`id/openid/uid/nickname/avatar/phone/city?/status/created_at/updated_at`。会员字段（#28）、`invite_code`（#31）由各自 change 用 ALTER 迁移加入。`membership_status` 永不落列（§5 现算）。
**理由**：capability 拥有自己的迁移；避免本能力替未来能力建字段（提前抽象）。

### D7：referral 不在本次，注册流程保持「干净」

注册只创建用户，不调 referral、不捕获邀请码。#31 接入时直接修改登录/注册流程加 `referral.grant` 与邀请捕获（§13：重构比抽象便宜）。本次**不**预留任何 referral 接口/空函数。

## Risks / Trade-offs

- **uid_sequence 成为写入热点**（高并发注册同一行 upsert）→ MVP 注册量不高可接受；真成瓶颈再分片（如按年+月）或换号段预分配。
- **跨年临界并发**（年初瞬间）→ upsert 以 `year` 为键天然隔离，跨年只是切到新行，无竞态。
- **phone 采集时机**：本次 user 表有 phone 列但登录不强制取手机号；手机号在下单/入驻等场景按需用 infra-wechat `getPhoneNumber` 获取后写入。phone 日志脱敏（§11）。
- **/me 未来被会员扩展**：#28 会让 /me 或专门接口带上会员状态；本次 /me 只返身份资料，避免提前塞会员字段。
- **示例笔误不修正会误导后续**（如 #9 加顾问按 UID 查）→ design 显式记录 + 建议提 update-cross-cutting change 修正。

## Migration Plan

依赖 #1-#4 已归档。落地顺序：`user` 表 + `uid_sequence` 表迁移 → uid 生成服务（原子 upsert）→ user-profile（/me + 编辑）→ auth-weapp（login：code2Session → find-or-create → 签 JWT）→ `findUserByUid` 服务 → 共享 schema → 测试。两张表为本 change 迁移。无存量数据、无回滚需求。

## Open Questions

- cross-cutting §1 UID 示例笔误（`EKY20260418` → 应为 `EKY2026000001`）——建议另提 `update-cross-cutting-uid` 修正，本 change 已按规则文字实现。
- /me 未来纳入会员状态的接口形态——留给 #28 决定（扩展 /me 还是单独 /membership）。
