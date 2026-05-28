## 1. 配置与 HTTP client

- [x] 1.1 实现微信配置加载（appId/appSecret/mchId/APIv3 key/证书序列号等，从 env），缺必需项启动失败；`.env.example` 同步
- [x] 1.2 实现可注入的 HTTP client（base URL 可配），供所有 wrapper 与测试使用（design D2）

## 2. access_token 管理

- [x] 2.1 实现 access_token 拉取 + Redis 缓存（TTL 留 buffer），复用 #1 的 `ioredis` 客户端
- [x] 2.2 实现并发刷新防击穿锁（Redis `SET NX EX`，并发只拉一次）（design D1）

## 3. 登录与手机号 wrapper

- [x] 3.1 实现 `code2Session(code) → { openid, sessionKey, unionid? }`（封装 jscode2session），错误码集中映射，不签 JWT、不碰 user 表
- [x] 3.2 实现 `getPhoneNumber(code) → phone`（封装手机号接口），手机号日志脱敏

## 4. 订阅消息发送框架

- [x] 4.1 实现 `templates.ts` 集中模板注册表结构（`{ event, templateId, buildData }`，event 联合类型，本次为空/占位）
- [x] 4.2 实现 `sendSubscribeMessage(...)` wrapper（调微信发送接口）
- [x] 4.3 注册 `notify:wechat-subscribe` 队列 + worker 处理器（复用 #2 调度 API，外部 API 类重试 5 次）
- [x] 4.4 实现 `notify.send(event, user, data)` 服务：5min 去重（`notify:dedup:<event>:<user>` `SET NX EX 300`）→ 未命中入队、命中跳过；未注册模板报错

## 5. 微信支付

- [x] 5.1 实现 JSAPI 统一下单 wrapper（构造请求 + APIv3 签名，返回小程序拉起支付参数）
- [x] 5.2 实现支付回调验签（平台证书 RSA）+ 解密（AES-256-GCM/APIv3 key）工具，输出结构化支付结果；不建接收路由
- [x] 5.3 实现订单查询 wrapper（按商户订单号查支付状态）
- [x] 5.4 实现微信平台证书缓存 + 定时拉取，验签按证书序列号选证书

## 6. 共享 schema

- [x] 6.1 在 `packages/shared/src/wechat` 定义订阅消息 payload 与支付回调结构的 Zod schema（前后端/队列共用）

## 7. 测试基础设施

- [x] 7.1 实现 fake 微信 HTTP（本地 server / undici MockAgent），可构造登录/手机号/订阅消息/支付各接口的响应与错误码（design D2）

## 8. 测试用例

- [x] 8.1 access_token 测试：缓存命中不重复拉取、并发刷新只拉一次
- [x] 8.2 `code2Session` 测试：有效 code 返回 openid、微信错误码抛错不伪造
- [x] 8.3 `getPhoneNumber` 测试：返回手机号、日志中手机号脱敏
- [x] 8.4 订阅消息测试：触发后入队 `notify:wechat-subscribe`、worker 处理调用发送、未注册模板被拒
- [x] 8.5 去重测试：同事件同接收者 5min 内只发一次
- [x] 8.6 支付下单测试：返回拉起支付所需参数与正确签名
- [x] 8.7 支付回调测试：合法回调验签通过并解密、被篡改/错误 key 验签失败被拒
- [x] 8.8 订单查询测试：返回支付状态
