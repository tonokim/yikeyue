# infra-log Specification

## Purpose
TBD - created by archiving change add-infra-foundation. Update Purpose after archive.
## Requirements
### Requirement: Pino 作为唯一日志库

系统 SHALL 使用 Pino 作为唯一日志库，业务与框架代码 MUST NOT 使用 `console.log` / `console.error` 等。CI 的 lint 规则 SHALL 拦截 `console.*` 调用。日志输出 SHALL 按 `NODE_ENV` 切换：生产输出 JSON 行，本地输出 pino-pretty。

#### 场景：lint 拦截 console 调用

- **WHEN** 代码中出现 `console.log(...)`
- **THEN** lint 报错，CI 构建失败

#### 场景：按环境切换输出格式

- **WHEN** `NODE_ENV=production` 启动服务
- **THEN** 日志以结构化 JSON 行输出（而非 pretty 格式）

### Requirement: 每条日志携带必备字段

每条日志记录 SHALL 至少包含 `request_id`、`level`、`time`、`msg` 四个字段。按场景追加上下文字段：HTTP 类追加 `method`/`path`/`status`/`latency_ms`（可含 `user_id`/`uid`）；Job 类追加 `queue`/`job_id`/`attempt`/`latency_ms`；Event 类追加 `exchange`/`routing_key`/`event_id`。

#### 场景：HTTP 请求日志包含上下文

- **WHEN** 一个 HTTP 请求处理完成并记录访问日志
- **THEN** 该日志包含 `request_id`、`method`、`path`、`status`、`latency_ms` 字段

### Requirement: request_id 经 child logger 绑定

系统 SHALL 在每个请求/job 起点用 Pino child logger 绑定 `request_id`，下游代码通过 `ctx.log` 记录日志，MUST NOT 自行拼接 `request_id`。同一请求内所有日志 SHALL 携带相同 `request_id`。

#### 场景：同一请求日志共享 request_id

- **WHEN** 一个请求在处理过程中产生多条日志
- **THEN** 这些日志的 `request_id` 字段值完全相同

### Requirement: 敏感字段强制脱敏

日志 SHALL 配置 redact 规则，自动脱敏以下字段路径，使其不以明文出现：`req.headers.authorization`、`req.body.password`、`req.body.id_card_no`、`*.phone`、`*.openid`、`*.access_token`。

#### 场景：authorization 头被脱敏

- **WHEN** 记录一条包含 `req.headers.authorization` 的日志
- **THEN** 输出中该字段值被替换为脱敏标记，原始 token 不出现

#### 场景：手机号被脱敏

- **WHEN** 记录的对象任意层级包含 `phone` 字段
- **THEN** 输出中该字段值被脱敏

### Requirement: 日志级别约定

系统 SHALL 遵循统一级别约定：`fatal`（进程将退出）、`error`（业务/系统异常，触发告警）、`warn`（值得注意但不影响功能）、`info`（业务关键路径，默认级别）、`debug`（开发态，生产关闭）。系统 MUST NOT 在 `info` 级别记录请求/响应全量 body。

#### 场景：info 级别不记录全量 body

- **WHEN** 在默认 `info` 级别处理一个带 body 的请求
- **THEN** 访问日志不包含请求/响应的完整 body 内容

