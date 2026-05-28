# Yikeyue 后端基础设施

这是 Yikeyue 后端应用的全新单体仓库基础配置，使用 `pnpm` workspace 组织项目。

## 架构

- **`apps/server`**：基于 Hono HTTP 框架的服务端，集成 Drizzle ORM、Pino 日志和 Redis 中间件。
- **`packages/shared`**：共享的 Zod schema、通用类型、分页辅助函数和金额分工具。

---

## 快速开始

### 前置要求

- Node.js >= 20.0.0（已在 `.nvmrc` 中指定）
- pnpm >= 10
- Docker 和 Docker Compose（用于本地 PostgreSQL 与 Redis 数据库）

### 安装依赖

```bash
pnpm install
```

### 数据库与 Redis 设置

启动本地数据库和 Redis 容器依赖：

```bash
docker compose up -d
```

执行数据库迁移：

```bash
pnpm --filter @yikey/server db:migrate
```

### 本地运行

```bash
# 以监听模式运行服务端应用
pnpm dev:server

# 以监听模式运行 Worker 进程
pnpm dev:worker
```

---

## 测试与质量控制

### 运行测试

项目使用 Vitest 和 Testcontainers 进行集成测试。每个测试文件都会使用独立的 PostgreSQL schema 和 Redis 前缀运行。

```bash
# 运行完整测试套件
pnpm test

# 运行测试并校验代码覆盖率阈值
pnpm test:coverage
```

### 覆盖率阈值

当前配置并强制执行以下覆盖率阈值：
- **语句（Statements）**：>= 80%
- **行（Lines）**：>= 80%
- **分支（Branches）**：>= 70%
- **函数（Functions）**：>= 80%

覆盖率报告会排除仅用于开发的配置文件（`vitest.config.ts`、`drizzle.config.ts`）、数据库种子/迁移文件以及共享包。

### Lint 与类型检查

```bash
# 运行 ESLint 校验
pnpm lint

# 对所有包运行 TypeScript 编译检查
pnpm typecheck
```

---

## Git 规范

为保持提交历史清晰，项目约定如下：

### 分支命名

- **功能**：`feat/<short-description>` 或 `feature/<short-description>`（例如 `feat/add-infra-foundation`）
- **缺陷修复**：`fix/<short-description>` 或 `bugfix/<short-description>`（例如 `fix/redis-lockup`）
- **文档**：`docs/<short-description>`（例如 `docs/update-readme`）
- **重构**：`refactor/<short-description>`（例如 `refactor/harness-cleanup`）
- **杂项/CI**：`chore/<short-description>`（例如 `chore/ci-workflow`）

### 提交信息

项目遵循 **Conventional Commits** 规范：

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

#### 类型：
- `feat`：新增功能
- `fix`：缺陷修复
- `docs`：仅文档变更
- `style`：不影响代码含义的变更（空白、格式等）
- `refactor`：既不修复缺陷也不新增功能的代码变更
- `perf`：提升性能的代码变更
- `test`：补充缺失测试或修正已有测试
- `chore`：构建流程、辅助工具或库的变更（例如 CI/CD）

#### 示例：
```
feat(infra): initialize hono server and pg database connection pool
fix(middleware): resolve redis idempotency cache connection timeout
test(integration): add test suite for rate limiting middleware
```

---

## Queue Worker 部署与运行

Yikeyue 的队列与 Worker 架构基于 BullMQ 和 Redis 实现。

### 本地开发运行
- 启动 HTTP Server：`pnpm dev:server`
- 启动 Worker 进程（独立进程，不监听 HTTP 端口）：`pnpm dev:worker`

### 生产容器部署
HTTP 服务端与 Worker 进程使用**相同的 Docker 镜像**（即同一份编译产物），但在部署容器时需配置不同的启动命令（Entrypoint/Command）：

1. **HTTP Server 容器**：
   - 启动命令：`node dist/index.js`
   - 需对外暴露 HTTP 端口（默认 3000）
2. **Worker 容器**：
   - 启动命令：`node dist/worker.js`
   - **不需要**暴露任何外部网络端口，只负责连接 PostgreSQL 和 Redis 处理后台任务
   - 支持 `SIGTERM` 和 `SIGINT` 信号优雅关闭，在接收到信号后最多等待 30 秒完成在途任务后安全退出。

参考 [docker-compose.yml](file:///Users/yuzhangjun/work/dora/yikeyue/docker-compose.yml) 中的 `server` 与 `worker` 服务配置模板。
