## ADDED Requirements

### Requirement: 微信配置集中加载

系统 SHALL 从环境变量集中加载微信小程序与微信支付配置（appId、appSecret、mchId、APIv3 key、证书序列号等），MUST NOT 在业务代码里散落硬编码。微信密钥 MUST NOT 出现在日志中。

#### 场景：缺失必需配置时启动失败

- **WHEN** 启动服务但缺少必需的微信配置项
- **THEN** 启动阶段报错并指明缺失项，而非运行期才暴露

### Requirement: access_token 管理与缓存

系统 SHALL 统一管理微信 access_token：拉取后缓存到 Redis，TTL 按其过期时间留 buffer；并发刷新 SHALL 用锁防击穿（同一时刻只有一次拉取）。下游调用 SHALL 透明获取有效 token，MUST NOT 各自拉取。

#### 场景：token 命中缓存不重复拉取

- **WHEN** 缓存中存在未过期的 access_token 且多个调用同时需要它
- **THEN** 直接返回缓存值，不触发对微信的重复拉取

#### 场景：并发刷新只拉取一次

- **WHEN** 缓存失效且多个请求并发需要 token
- **THEN** 仅一次向微信拉取，其余等待复用同一结果

### Requirement: 登录 SDK wrapper

系统 SHALL 提供 `code2Session(code)`，封装微信 `jscode2session`，返回 `{ openid, sessionKey, unionid? }`。该 wrapper MUST NOT 签发 JWT、MUST NOT 读写 user 表（登录业务由 auth capability 负责）。微信返回错误码时 SHALL 抛出可识别的错误。

#### 场景：有效 code 换取 openid

- **WHEN** 用有效 code 调用 `code2Session`
- **THEN** 返回包含 `openid` 的结果

#### 场景：无效 code 抛出错误

- **WHEN** 微信对该 code 返回错误码
- **THEN** wrapper 抛出可识别的错误，不返回伪造的 openid

### Requirement: 手机号 SDK wrapper

系统 SHALL 提供 `getPhoneNumber(code)`，封装微信小程序手机号接口，返回用户手机号。手机号 SHALL 按 cross-cutting §11 在日志中脱敏。

#### 场景：用 code 换取手机号

- **WHEN** 用有效的手机号 code 调用 `getPhoneNumber`
- **THEN** 返回该用户手机号

### Requirement: 订阅消息发送

系统 SHALL 提供订阅消息发送能力：发送动作经 `notify:wechat-subscribe` BullMQ 队列异步执行（重试按外部 API 类，5 次），处理器调用微信发送接口。模板 SHALL 在 `templates.ts` 集中注册（事件 → 模板 ID + data 构造）。业务 capability 发通知 MUST 通过本能力，MUST NOT 直接调微信发送接口。

#### 场景：发送动作入队异步执行

- **WHEN** 业务触发一条订阅消息
- **THEN** 一个 job 进入 `notify:wechat-subscribe` 队列，由 worker 处理并调用微信发送接口

#### 场景：未注册模板被拒绝

- **WHEN** 触发一个未在 `templates.ts` 注册的事件
- **THEN** 发送被拒绝并报错，不向微信发送任意模板

### Requirement: 订阅消息去重

同一事件 + 同一接收者在 5 分钟内 SHALL 去重：系统用 Redis `notify:dedup:<event>:<user>`（TTL 300）判断，已存在则跳过发送。

#### 场景：5 分钟内重复触发只发一次

- **WHEN** 同一事件对同一接收者在 5 分钟内被触发两次
- **THEN** 只发送一次，第二次被去重跳过

### Requirement: 微信支付下单

系统 SHALL 提供 JSAPI 统一下单 wrapper，返回小程序发起支付所需参数。下单 wrapper SHALL 用于会员购买场景。

#### 场景：统一下单返回支付参数

- **WHEN** 以合法订单信息调用统一下单 wrapper
- **THEN** 返回小程序拉起支付所需的参数（如 prepay 相关字段与签名）

### Requirement: 微信支付回调验签与解密

系统 SHALL 提供支付回调的验签 + 解密工具：校验微信签名、解密回调密文为结构化支付结果。验签失败的回调 SHALL 被拒绝。本能力 MUST NOT 包含更新会员订单的业务逻辑（由 membership-payment 负责）。

#### 场景：合法回调验签通过并解密

- **WHEN** 收到签名合法的支付回调密文
- **THEN** 验签通过并解密出结构化支付结果

#### 场景：验签失败被拒绝

- **WHEN** 收到签名非法或被篡改的回调
- **THEN** 验签失败、拒绝处理，不返回成功 ack

### Requirement: 微信支付订单查询

系统 SHALL 提供订单查询 wrapper，按商户订单号向微信查询支付状态，用于回调丢失时的兜底对账。

#### 场景：查询返回支付状态

- **WHEN** 用商户订单号调用查询 wrapper
- **THEN** 返回该订单在微信侧的支付状态

### Requirement: 外部微信 API 可注入以支持测试

微信 SDK wrapper SHALL 接收可注入的 HTTP client / base URL，使测试能指向可控的 fake HTTP，验证请求构造、响应解析、验签与缓存/去重逻辑，而无需调用真实微信。

#### 场景：测试指向 fake 微信 HTTP

- **WHEN** 测试注入一个 fake HTTP client 并调用某 wrapper
- **THEN** wrapper 向 fake 发起请求并正确解析其响应，不触达真实微信
