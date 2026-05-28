## ADDED Requirements

### Requirement: Drizzle 作为唯一 ORM 与迁移工具

系统 SHALL 使用 Drizzle 作为唯一的 ORM、查询构造器与迁移工具，schema 定义即 single source of truth。复杂查询 MUST 使用 Drizzle 的 `sql` 模板编写原生 SQL，禁止引入 Kysely 或第二套查询库。

#### 场景：通过 drizzle-kit 生成迁移

- **WHEN** 开发者修改 `apps/server/src/db/schema` 后运行迁移生成命令
- **THEN** 在迁移目录产出对应的 SQL 迁移文件，且该文件可被迁移命令应用到空数据库而不报错

#### 场景：复杂查询用 sql 模板

- **WHEN** 需要多表聚合等无法用 Drizzle 链式 API 表达的查询
- **THEN** 使用 Drizzle 的 `sql` 模板编写，而非引入额外查询库

### Requirement: 主键统一使用 cuid2 字符串

所有表主键字段名 SHALL 为 `id`，类型为字符串，值由 cuid2 生成；外键 SHALL 命名为 `<entity>_id`。系统 MUST NOT 使用自增整型主键对外暴露。

#### 场景：插入记录自动生成 cuid2 主键

- **WHEN** 插入一条新记录且未显式指定 `id`
- **THEN** 记录获得一个 cuid2 格式的字符串 `id`，且全局唯一

### Requirement: 金额以整数分存储

所有金额 SHALL 以整数「分」存储，字段以 `_cents` 后缀命名（如 `price_cents`、`amount_cents`），列类型为整型，并配套 `currency` 字段（MVP 固定 `"CNY"`）。系统 MUST NOT 使用浮点或 `float`/`double` 表示金额。`infra-db` SHALL 提供金额列的 column helper 以统一该约定。

#### 场景：金额读写不丢精度

- **WHEN** 写入一个 `*_cents` 金额字段（如 `990` 表示 ¥9.90）后再读出
- **THEN** 读出值与写入值精确相等，不发生浮点误差

#### 场景：金额列为整型

- **WHEN** 通过 column helper 定义一个金额字段
- **THEN** 该列在数据库中为整型，而非浮点/数值类型

### Requirement: 时间统一以 UTC 存储

所有时间字段 SHALL 使用 `timestamptz` 类型并以 UTC 存储，字段名以 `_at` 后缀结尾。每日时段类字段（营业时间、班次）SHALL 使用 `time` 类型（不含日期、不含时区），按门店所在时区（MVP 统一 `Asia/Shanghai`）解释；本地日期字段 SHALL 以 `_local` 后缀标识。

#### 场景：读写时间字段保持 UTC

- **WHEN** 写入一个 `_at` 时间字段后再读出
- **THEN** 读出值与写入的 UTC 时刻一致，不发生时区偏移

### Requirement: db 句柄经请求上下文注入

数据库访问 SHALL 通过请求上下文上的 `ctx.db` 句柄进行，而非在业务模块里 import 全局单例。该设计 MUST 允许测试为单个请求绑定一个独立事务，从而实现用例级回滚隔离。

#### 场景：业务代码通过 ctx.db 访问数据库

- **WHEN** 业务 service 需要读写数据库
- **THEN** 它使用传入的 `ctx.db` 句柄，而非直接 import 一个进程级全局 db 实例

#### 场景：测试为请求注入独立事务句柄

- **WHEN** 集成测试发起一个请求并注入一个事务作用域的 db 句柄
- **THEN** 该请求的所有数据库操作都在该事务内执行，测试结束回滚后数据不残留

### Requirement: 集成测试使用真实 PostgreSQL 且按文件隔离

集成测试 SHALL 使用 testcontainers 启动真实 PostgreSQL（不 mock 数据库），每个测试文件 MUST 使用独立 schema（`beforeAll` 建 schema 跑迁移、`afterAll` drop），每个测试函数 SHALL 在独立事务中运行并在结束时 `ROLLBACK`（显式测试提交的用例除外）。

#### 场景：每文件独立 schema

- **WHEN** 两个测试文件并行运行
- **THEN** 它们各自在独立 schema 中操作，互不可见对方写入的数据

#### 场景：用例结束自动回滚

- **WHEN** 一个测试用例在事务内插入数据后结束
- **THEN** 事务被回滚，下一个用例看不到上一个用例写入的数据
