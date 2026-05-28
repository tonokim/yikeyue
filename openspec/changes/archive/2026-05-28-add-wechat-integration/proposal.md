## Why

易可约的用户身份、通知、会员付费三条线都依赖微信能力：小程序登录（`code → openid`）、手机号获取、订阅消息（MVP 唯一用户通知渠道）、微信支付（会员 ¥9.9/年）。本 change 把这些**微信 SDK 调用统一封装**到 `apps/server/src/wechat`，给上层 capability 一组干净、可测、带 access_token 缓存与重试的接口，避免每个业务各自拼微信 API。它依赖 `infra-api`（#1，HTTP/ctx/Redis/测试基线）与 `infra-queue`（#2，订阅消息走 BullMQ）。落地 [cross-cutting-rules.md §8](../../cross-cutting-rules.md)（通知）与 §11/§12 的相关约定。

## What Changes

- 新增 `apps/server/src/wechat` 模块：集中微信配置加载（appId/appSecret/mchId/APIv3 key 等，从 env 读）。
- **access_token 管理**：拉取 + Redis 缓存（按过期时间设 TTL 留 buffer）+ 防击穿锁（复用 #1 的 `ioredis` 客户端），下游调用透明取用。
- **登录 SDK wrapper**：`code2Session(code) → { openid, sessionKey, unionid? }`（封装 `jscode2session`）。**仅 wrapper，不含登录端点与 JWT 签发**（留给 auth-weapp/#5）。
- **手机号 SDK wrapper**：`getPhoneNumber(code) → phone`（封装小程序手机号接口）。
- **订阅消息**：`sendSubscribeMessage(...)` wrapper + `notify:wechat-subscribe` BullMQ 队列与处理器（在 worker 进程跑）+ **5 分钟去重**（Redis `notify:dedup:<event>:<user>` TTL 300）+ 外部 API 类重试（5 次）；`templates.ts` 集中模板注册表（**本次结构为空/占位，具体模板 ID 与触发点由各业务 capability 注册**）。
- **微信支付**：JSAPI 统一下单 wrapper、支付回调**验签 + 解密**工具、订单查询 wrapper（APIv3）。**不做退款**（留 v2.0 online-payment）。
- **外部 API 测试约定**：微信是真实第三方 HTTP API，无法 testcontainer；SDK wrapper 接收**可注入的 HTTP client / base URL**，测试指向可控的 fake HTTP，验证请求构造与响应解析、验签、access_token 缓存与去重逻辑。

> 本 change **实现**而非**修改**横切规则（§8 通知、§11/§12），无需 ⚠️ 横切规则变更标注。

## Capabilities

### New Capabilities

- `infra-wechat`: 微信配置与 access_token 管理、登录/手机号 SDK wrapper、订阅消息发送（队列 + 去重 + 重试 + 模板注册表）、微信支付（下单 + 回调验签/解密 + 查单）、外部 API 的可注入 HTTP 测试约定。

### Modified Capabilities

（无。`infra-queue`（#2）已提供调度 API 与 worker 进程，本 change 只是注册 `notify:wechat-subscribe` 队列去使用它，不修改其 spec；不涉及其他既有 spec。）

## Impact

- **新增代码**：`apps/server/src/wechat/{config,access-token,login,phone,subscribe,templates,pay,http-client}`、`notify:wechat-subscribe` 队列处理器、`packages/shared/src/wechat`（订阅消息 payload / 支付回调 schema）、`apps/server/tests/integration/wechat`（含 fake 微信 HTTP）。
- **新增配置**：`.env` 增加微信小程序与微信支付相关密钥项（`.env.example` 同步）。
- **依赖**：微信 HTTP 调用（`undici`/`fetch` 可注入 client）；微信支付 APIv3 加解密/验签（Node `crypto` 或维护良好的 wechatpay 库）。
- **横切契约落地**：cross-cutting §8（订阅消息唯一通知渠道、模板集中、5min 去重）从此 change 起生效；后续 capability 发通知必须走本 change 的 notify 服务与模板注册表，不得直接调微信 API。
- **下游解锁**：`add-uid-system`/auth-weapp（#5，用 `code2Session` 签 JWT）、`add-consultant-binding`（#9，添加顾问通知）、`add-membership-trial`/`add-membership-payment`（#28/#29，到期提醒 + ¥9.9 支付）、`add-store-application-review`（#33，入驻审核通知）、`add-order-*`（预约相关通知）。

## Non-goals

- **不做登录端点与 JWT 签发**：`code2Session` 只返回 openid；「find-or-create user + 签 JWT」是 auth-weapp/uid-system（#5）的事（需 user 表）。
- **不注册具体订阅消息模板**：模板 ID、data 构造、触发点由各业务 capability 在 `templates.ts` 注册。本次只建发送框架 + 队列 + 去重 + 空注册表。
- **不做支付退款 / 业务订单支付**：MVP 仅会员 ¥9.9 购买走支付；退款、在线/到店付款是 v2.0 online-payment。
- **不做支付回调业务路由**：本次只提供回调**验签/解密工具**；接收回调的 endpoint + 更新会员订单的业务处理在 `add-membership-payment`（#29）。
- **不在 job 内 publish 事件**：订阅消息发送 job 内若需触发其他副作用，直接函数调用（cross-cutting §13）。
- **不引入短信/其他通知渠道**：MVP 唯一通知渠道是微信订阅消息。
