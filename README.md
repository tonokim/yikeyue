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
