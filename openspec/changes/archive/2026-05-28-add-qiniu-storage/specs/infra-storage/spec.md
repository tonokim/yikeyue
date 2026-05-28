## ADDED Requirements

### Requirement: 七牛配置与两 bucket 分工

系统 SHALL 从环境变量加载七牛配置（accessKey/secretKey、CDN 域名、region）与两个 bucket：`yikey-private`（资质材料等，私有读）与 `yikey-public`（作品/评价图/门店照/轮播图等，公开读）。所有图片 SHALL 走七牛云 Kodo，MUST NOT 落自己服务器或经服务器中转。

#### 场景：缺失必需配置时启动失败

- **WHEN** 启动服务但缺少必需的七牛配置项
- **THEN** 启动阶段报错并指明缺失项

### Requirement: scoped upload token 签发

系统签发的 upload token SHALL 限定 scope（`bucket:key` 前缀）、文件大小上限、mimeType 白名单、短 TTL（≤ 5 分钟）。系统 MUST NOT 签发「任意 key」的开放 token。

#### 场景：token 限定到具体 key 前缀

- **WHEN** 为某次上传签发 token
- **THEN** 该 token 仅能上传到指定 `bucket:key` 前缀，超出 scope、超大小或不在 mime 白名单的上传被七牛拒绝

#### 场景：token 短期过期

- **WHEN** token 签发超过其 TTL（≤ 5 分钟）后再使用
- **THEN** 该 token 失效，无法继续上传

### Requirement: 上传 token endpoint 与上传策略注册表

系统 SHALL 提供 `/upload/token` endpoint：客户端传 capability + 实体上下文 + mimeType/ext，服务端按**上传策略注册表**（capability → bucket、允许 mime、大小上限）校验后生成 key、签发 scoped token，并返回 `{ token, key, upload_host }`。未在注册表登记的 capability SHALL 被拒绝。

#### 场景：合法请求返回 token 与 key

- **WHEN** 客户端为已注册 capability 请求上传 token 且 mime 合法
- **THEN** 返回该次上传的 `token`、`key` 与上传域名

#### 场景：未注册 capability 被拒绝

- **WHEN** 为未在策略注册表登记的 capability 请求 token
- **THEN** 请求被拒绝，不签发 token

### Requirement: key 命名规则

上传 key SHALL 遵循 `<capability>/<entity_id>/<yyyymm>/<cuid2>.<ext>` 格式，便于按业务线统计与清理。

#### 场景：生成符合规则的 key

- **WHEN** 为某 capability + 实体生成上传 key
- **THEN** key 形如 `review/ord_xxx/202605/img_yyy.jpg`

### Requirement: 私有签名 URL 与公开 CDN URL

私有 bucket 文件访问 SHALL 通过短 TTL 签名 URL（`privateDownloadUrl(key)`），MUST NOT 直连或公开。公开 bucket 文件 SHALL 通过七牛 CDN 域名直出。

#### 场景：私有文件走短期签名 URL

- **WHEN** 请求一个私有 bucket 文件的访问地址
- **THEN** 返回一个短 TTL 的签名 URL，过期后无法访问

#### 场景：公开文件走 CDN 直出

- **WHEN** 请求一个公开 bucket 文件的访问地址
- **THEN** 返回七牛 CDN 域名直出地址

### Requirement: 上传意图记录与绑定确认

`/upload/token` 签发时 SHALL 写一条上传意图记录（状态 `pending`，含 key、capability、过期时间）。业务写入该 key 时 SHALL 调用 `confirmUpload(key)` 将记录置为 `confirmed`。

#### 场景：签发 token 产生 pending 记录

- **WHEN** `/upload/token` 成功签发一个 token
- **THEN** 产生一条状态为 `pending` 的上传意图记录

#### 场景：确认绑定置为 confirmed

- **WHEN** 业务写入 key 后调用 `confirmUpload(key)`
- **THEN** 对应记录状态变为 `confirmed`

### Requirement: 孤儿文件清理

系统 SHALL 提供 `storage:orphan-cleanup` 每日 repeatable job：删除状态仍为 `pending` 且超过 24 小时的上传意图记录对应的七牛文件与记录本身。`confirmed` 记录 MUST NOT 被清理。

#### 场景：清理超时未确认的孤儿文件

- **WHEN** 清理 job 运行且存在 pending 超过 24h 的上传意图
- **THEN** 删除其七牛文件与意图记录

#### 场景：已确认文件不被清理

- **WHEN** 清理 job 运行且存在 `confirmed` 记录
- **THEN** 这些文件与记录保留不动

### Requirement: 外部七牛 API 可注入以支持测试

token 签发、私有 URL 签名、key 命名 SHALL 为本地纯函数、可直接测试；七牛管理类调用（删除、stat）SHALL 依赖可注入的 client，使测试指向可控的 fake，而无需调用真实七牛。

#### 场景：清理逻辑用 fake client 测试

- **WHEN** 测试注入 fake 七牛 client 并运行清理逻辑
- **THEN** 清理按 fake 的响应执行删除，不触达真实七牛
