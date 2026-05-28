## Context

#1 已建 HTTP/ctx/Pino/普通 `ioredis` 客户端/测试基线，#2 已建 BullMQ 调度 API、worker 进程与队列测试 harness。本 change 在其上封装微信能力，是身份（#5）、通知（多处）、会员付费（#28/#29）、入驻审核（#33）的共同依赖。

约束：cross-cutting §8（微信订阅消息是 MVP 唯一用户通知渠道、模板集中 `templates.ts`、5min 去重）、§11（`*.openid`/`*.access_token` redact）、§12（`notify:wechat-subscribe` 走 BullMQ、外部 API 类重试 5 次、job 内副作用直接调函数不发事件）。微信支付仅服务会员 ¥9.9 购买。

## Goals / Non-Goals

**Goals:**

- 一组干净、可测的微信 SDK wrapper：登录、手机号、订阅消息、支付。
- access_token 统一缓存 + 防击穿。
- 订阅消息发送框架：队列 + 去重 + 重试 + 集中模板注册表（本次空）。
- 微信支付：下单 + 回调验签/解密 + 查单（无退款、无业务路由）。
- 外部微信 API 的可控测试方式（注入 HTTP）。

**Non-Goals:**

- 登录端点 + JWT 签发（auth-weapp/#5）。
- 具体订阅消息模板与触发点（各业务 capability）。
- 退款 / 业务订单支付（v2.0）。
- 支付回调业务路由（membership-payment/#29）。

## Decisions

### D1：access_token 缓存 + 防击穿锁，复用 #1 的 ioredis

token 存 Redis（`wechat:access_token`），TTL = 微信返回 expires_in 减 buffer（如 300s）。刷新时用 Redis 锁（`SET NX EX`）保证并发只有一次拉取，其余短暂等待后读缓存。复用 #1 的普通 `ioredis` 客户端（非 BullMQ 连接）。
**Alternative（已否决）**：进程内内存缓存。否决理由：server 与 worker 是两个进程、生产多实例，内存缓存会各自拉取、易触发微信频率限制。

### D2：外部微信 API 通过注入 HTTP client 测试，而非 testcontainer

cross-cutting §14「不 mock 外部依赖」指的是**可容器化的基础设施**（PG/Redis/RabbitMQ），不包括微信这类第三方 SaaS——它无法 testcontainer，也不应在 CI 打真实微信。故所有 wrapper 依赖一个**可注入的 HTTP client（base URL 可配）**；测试启一个 fake HTTP（本地 server / undici MockAgent）返回构造好的微信响应，覆盖：请求参数正确、响应/错误码解析、access_token 缓存命中与防击穿、支付验签、去重。
**理由**：保证微信逻辑可测且 CI 稳定，同时不违背「PG/Redis 用真容器」的精神。

### D3：notify:wechat-subscribe 队列归 infra-wechat，业务只调 notify 服务

队列与处理器属本能力（处理器在 worker 进程跑，复用 #2 调度 API）。业务 capability 调 `notify.send(event, user, data)`：先查 5min 去重（`notify:dedup:<event>:<user>` `SET NX EX 300`），未命中则 `enqueue` 到 `notify:wechat-subscribe`；命中则跳过。处理器从 `templates.ts` 取模板 ID + 构造 data，调微信发送，按外部 API 类重试 5 次，最终失败进死信（#2 死信扫描覆盖）。
**理由**：把「是否发、发什么模板、去重、重试」收敛到一处，业务方零散调微信是 §8 明确反对的。

### D4：templates.ts 类型安全的集中注册表（本次空）

每个模板登记为 `{ event, templateId, buildData(ctx) }`，event 为联合类型。本次注册表为空/占位，业务 capability 新增自己的条目。发送时若 event 未注册则报错（spec：未注册模板被拒绝）。
**理由**：cross-cutting §8 要求模板集中管理；类型化避免发错模板/漏 data 字段。

### D5：微信支付走 APIv3，本次只做下单/验签解密/查单

- 统一下单（JSAPI）：构造请求 + APIv3 签名，返回小程序拉起支付参数。
- 回调：提供**验签（微信平台证书 RSA）+ 解密（AES-256-GCM，APIv3 key）**工具，输出结构化支付结果；**不**提供接收回调的 endpoint（#29 建路由并调本工具）。
- 查单：按商户订单号查支付状态，供回调丢失兜底。
- 加解密用 Node `crypto` 或维护良好的 wechatpay 库；平台证书需缓存与轮换（最小实现：定时拉取 + 缓存）。
**Alternative（已否决）**：做完整支付（含退款/分账）。否决理由：MVP 只有 ¥9.9 会员购买，退款属 v2.0。

### D6：登录/手机号仅 wrapper，不碰 user 表与 JWT

`code2Session` 返回 openid 即止；`getPhoneNumber` 返回 phone 即止。find-or-create user、签 JWT 是 auth-weapp/#5 的职责（需 user 表）。
**理由**：与 #1/#2 spine-only 一致，避免 #3 产出依赖 user 表的半成品。

## Risks / Trade-offs

- **fake HTTP 与真实微信行为漂移**（字段/错误码不一致）→ 以微信官方文档构造 fake 响应，wrapper 对错误码集中映射；上线前用真凭证做一次手动联调（非 CI）。
- **微信支付加解密易错**（验签/解密细节多）→ 优先用维护良好的库；验签解密写足单测（合法/被篡改/错误 key）。
- **access_token 频率限制**（微信限制拉取频次）→ D1 缓存 + 防击穿；多实例共享 Redis 缓存。
- **平台证书轮换**（微信平台证书会更新）→ 证书缓存 + 定时拉取；验签时按证书序列号选证书。
- **去重误伤**（同一事件确实需要 5min 内发两次，极少）→ 去重 key 含 event 维度，必要时业务侧用不同 event 名区分。

## Migration Plan

依赖 #1、#2 已落地。落地顺序：配置加载 → 可注入 HTTP client → access_token 缓存/防击穿 → 登录/手机号 wrapper → 订阅消息（队列处理器 + notify 服务 + 去重 + templates 注册表）→ 微信支付（下单 + 验签解密 + 查单 + 证书缓存）→ fake 微信 HTTP 测试 harness + 各 wrapper 测试。生产新增微信相关 env；worker 进程开始跑 `notify:wechat-subscribe`。无存量数据、无回滚需求。

## Open Questions

- 微信支付平台证书的轮换策略细节（定时拉取频率、序列号映射）——本次最小实现，量大后再优化。
- 上线前真实微信凭证的联调与提审流程——非本 change 代码范围，但需在 phase 7 末尾并行启动（提审 1-3 天）。
