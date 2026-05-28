## Why

平台所有图片（用户作品、评价图、门店环境照、轮播图、入驻资质材料）都走七牛云 Kodo，不落自己服务器。这要求一套统一的存储地基：scoped upload token 签发、私有/公开两 bucket、CDN/签名 URL、key 命名规则、以及上传后未绑定的孤儿文件清理。本 change 把 [cross-cutting-rules.md §7](../../cross-cutting-rules.md)（文件上传）落成可运行代码，让后续 capability 只需「注册自己的上传策略 + 拿 token + 绑定 key」。它依赖 `infra-api`（#1，HTTP/ctx/db/Redis/测试基线）与 `infra-queue`（#2，孤儿清理走 BullMQ）。

## What Changes

- 新增 `apps/server/src/storage` 模块：七牛配置加载（accessKey/secretKey、`yikey-private`/`yikey-public` 两 bucket、CDN 域名、region，从 env 读）。
- **scoped upload token 签发**：token 必带 scope（`bucket:key` 前缀）+ 文件大小上限 + mimeType 白名单 + 短 TTL（≤ 5 分钟），**禁止**签发「任意 key」开放 token。token 为本地 HMAC 签名，不需调七牛 API。
- **`/upload/token` endpoint**：客户端传「capability + 实体上下文 + mimeType/ext」，服务端按**上传策略注册表**校验（capability → bucket、允许的 mime、大小上限），按命名规则生成 key，写一条 **upload 意图记录（pending）**，返回 `{ token, key, upload_host }`。
- **key 命名 helper**：`<capability>/<entity_id>/<yyyymm>/<cuid2>.<ext>`（如 `review/ord_xxx/202605/img_yyy.jpg`）。
- **URL 生成**：私有 bucket 走 `privateDownloadUrl(key)`（短 TTL 签名 URL，**永不直连**）；公开 bucket 走 CDN 域名直出。
- **confirmUpload(key)**：业务写入 key 时调用，把 upload 意图记录从 pending 置 confirmed（cross-cutting §7「上传后调业务接口确认绑定」）。
- **孤儿文件清理**：`storage:orphan-cleanup` BullMQ 每日 repeatable job，删除 pending 超 24h 的记录对应的七牛文件 + 意图记录。
- **upload 意图表** + 迁移（status `pending`/`confirmed`、key、capability、过期时间等）。
- **外部 API 测试约定**：token 签发 / 私有 URL 签名 / key 命名为本地纯函数，可直接测；七牛管理类调用（删除、stat）依赖**可注入的 client**，测试指向 fake（复用 #3 的注入式外部 API 测试模式）。

> 本 change **实现**而非**修改**横切规则（§7 文件上传、§12 队列），无需 ⚠️ 横切规则变更标注。

## Capabilities

### New Capabilities

- `infra-storage`: 七牛配置、scoped upload token 签发、`/upload/token` endpoint + 上传策略注册表、key 命名规则、私有签名 URL / 公开 CDN URL、`confirmUpload` 绑定确认、upload 意图表、`storage:orphan-cleanup` 孤儿清理 job、外部 API 可注入测试约定。

### Modified Capabilities

（无。复用 `infra-api`/`infra-queue`/`infra-db`，不修改其 spec；不涉及其他既有 spec。）

## Impact

- **新增代码**：`apps/server/src/storage/{config,token,key,url,policy,upload-intent,cleanup,client}`、`/upload/token` 路由、`apps/server/src/db/schema` 增 `upload` 表、`packages/shared/src/upload`（token 请求/响应 schema）、`apps/server/tests/integration/storage`（含 fake 七牛 client）。
- **新增迁移**：`upload` 意图表迁移。
- **新增配置**：`.env` 增加七牛 accessKey/secretKey、两 bucket 名、CDN 域名、region（`.env.example` 同步）。
- **依赖**：七牛 SDK（或本地 HMAC 生成 token + `undici` 调管理 API）。
- **横切契约落地**：cross-cutting §7（两 bucket 分工、scoped token、key 命名、确认绑定、孤儿清理）从此 change 起生效；后续 capability 上传图片必须走本 change 的 token endpoint 与 `confirmUpload`，不得自签开放 token、不得直连私有 bucket。
- **下游解锁**：`add-review-system`（#25，评价图）、`consultant` 作品、`store` 门店照、`add-banner-mgmt`（#39，轮播图）、`add-store-application-form`（#32，资质材料，私有 bucket）。

## Non-goals

- **不做资质图片水印**：本次只做私有 bucket + 短 TTL 签名 URL 满足「限制下载」；水印（PRD §10.2）留 v2.0。
- **不注册具体业务上传策略**：上传策略注册表本次为空/占位 + 一个 demo 策略证明闭环；各 capability 注册自己的 policy（bucket/mime/大小）。⚠️ 与 #2/#3 spine-only 一致。
- **不做业务绑定 endpoint**：`confirmUpload` 由各业务写 endpoint（如 `POST /reviews`）调用，本 change 不建业务路由。
- **不自建文件存储 / 不走自己服务器中转**：一律客户端直传七牛。
- **不在 cleanup job 内 publish 事件**：直接函数调用（cross-cutting §13）。
