## 1. 配置与 client

- [x] 1.1 实现七牛配置加载（accessKey/secretKey、`yikey-private`/`yikey-public`、CDN 域名、region，从 env），缺必需项启动失败；`.env.example` 同步
- [x] 1.2 实现可注入的七牛管理 client（删除/stat，base URL 与凭证可配），供清理与测试使用（design D3）

## 2. token / key / URL（本地纯函数）

- [x] 2.1 实现 key 命名 helper：`<capability>/<entity_id>/<yyyymm>/<cuid2>.<ext>`
- [x] 2.2 实现 scoped upload token 签发（本地 HMAC）：scope（bucket:key 前缀）+ fsizeLimit + mimeLimit + ≤5min deadline（design D2）
- [x] 2.3 实现私有签名 URL（`privateDownloadUrl(key)`，短 TTL）与公开 CDN URL 生成

## 3. 上传策略与 endpoint

- [x] 3.1 实现上传策略注册表结构（`{ capability, bucket, allowedMime[], maxSizeBytes }`，capability 联合类型，本次空 + 一个 demo 策略）（design D4）
- [x] 3.2 实现 `/upload/token` endpoint：按策略校验 mime/大小 → 决定 bucket（资质私有/其余公开）→ 生成 key + 签 token → 写 pending 意图记录 → 返回 `{ token, key, upload_host }`；未注册 capability 拒绝

## 4. upload 意图表与迁移

- [x] 4.1 在 `apps/server/src/db/schema` 定义 `upload` 表（status `pending`/`confirmed`、key、capability、entity_id 可空、expires_at、时间字段）
- [x] 4.2 生成并提交 `upload` 表迁移，验证空库可幂等应用

## 5. 绑定确认

- [x] 5.1 实现 `confirmUpload(key)`：将对应 pending 意图记录置为 `confirmed`（供各业务写 endpoint 调用）

## 6. 孤儿清理

- [x] 6.1 注册 `storage:orphan-cleanup` 每日 repeatable job（复用 #2 调度 API）：查 pending 超 24h 的意图记录 → 调七牛 client 删文件 + 删记录；`confirmed` 不动

## 7. 共享 schema

- [x] 7.1 在 `packages/shared/src/upload` 定义 `/upload/token` 请求/响应的 Zod schema（前后端共用）

## 8. 测试基础设施

- [x] 8.1 实现 fake 七牛 client（可构造删除/stat 响应），供清理与管理类调用测试（design D3）

## 9. 测试用例

- [x] 9.1 token 签发单测：scope/大小/mime/deadline 正确，超 scope/超大小/非白名单 mime 的 policy 体现限制
- [x] 9.2 key 命名单测：生成符合 `<capability>/<entity_id>/<yyyymm>/<cuid2>.<ext>`
- [x] 9.3 URL 单测：私有签名 URL 短 TTL 过期失效、公开走 CDN 直出
- [x] 9.4 `/upload/token` 集成测试：合法请求返回 token+key 且产生 pending 记录、未注册 capability 拒绝
- [x] 9.5 `confirmUpload` 集成测试：调用后记录变 confirmed
- [x] 9.6 孤儿清理集成测试：pending 超 24h 被删（七牛 + 记录）、confirmed 不被清理（用 fake client + fake timers 推进）
- [x] 9.7 demo 策略闭环测试：请求 demo 策略 token → 直传（对 fake）→ confirm 闭环
