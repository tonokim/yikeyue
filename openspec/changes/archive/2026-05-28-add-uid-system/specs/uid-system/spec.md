## ADDED Requirements

### Requirement: UID 格式

用户 UID SHALL 为 `EKY` + 4 位注册年份 + 年内自增序号（如 `EKY2026000001`）。序号 SHALL 按注册年份独立计数（每年从 `1` 起），左侧补零至**至少** 6 位。当某年序号超过 `999999` 时，序号 SHALL 自然增长为 7 位及以上（MUST NOT 截断、MUST NOT 复用历史序号、MUST NOT 报错），即 6 位是补零下限而非容量上限。

#### 场景：生成符合格式的 UID

- **WHEN** 某用户于 2026 年注册并生成 UID
- **THEN** UID 形如 `EKY2026` + 至少 6 位补零序号（如 `EKY2026000001`）

#### 场景：跨年序号重置

- **WHEN** 进入新的一年后生成第一个 UID
- **THEN** 该年序号从 `1`（补零为 `000001`）起，年份前缀随之变化

#### 场景：年内序号溢出 6 位自然延长

- **WHEN** 某年新注册数超过 999999
- **THEN** 第 1000000 个用户的序号为 7 位（UID 相应变长），生成不报错、不复用历史序号

### Requirement: UID 按不透明变长字符串处理

系统 SHALL 把 UID 当作不透明的变长字符串：`user.uid` 列 SHALL 为变长类型（varchar），MUST NOT 假定固定长度（如固定 13 位）或固定序号位数。任何对 UID 的校验 SHALL 使用宽松规则（如 `^EKY\d{4}\d{6,}$`），以兼容未来 7 位及以上序号；该校验规则 SHALL 定义在 `packages/shared` 供各端复用。

#### 场景：7 位序号 UID 通过校验

- **WHEN** 校验一个年内序号为 7 位的 UID（`EKY` + 年份 + 7 位）
- **THEN** 校验通过，不因长度超过 13 位而被拒

#### 场景：变长 UID 正常存储

- **WHEN** 存储一个长度超过 13 位的 UID
- **THEN** 正常存储，不被列长度截断

### Requirement: UID 唯一、终身、不可变

UID SHALL 在 `user` 记录创建时生成，全局唯一、终身不变、不可编辑。系统 MUST NOT 提供任何修改 UID 的接口。

#### 场景：UID 创建后不可修改

- **WHEN** 尝试修改一个已存在用户的 UID
- **THEN** 系统不提供该能力，UID 保持创建时的值

#### 场景：UID 全局唯一

- **WHEN** 生成两个用户的 UID
- **THEN** 两者 UID 不相同

### Requirement: UID 原子生成（并发安全）

UID 序号 SHALL 通过原子的年内计数机制生成，并发创建用户时 MUST NOT 产生重复或跳号冲突导致的重复 UID。

#### 场景：并发创建不产生重复 UID

- **WHEN** 同一年内并发创建多个用户
- **THEN** 每个用户获得唯一且连续的年内序号，无重复 UID

### Requirement: UID 是唯一对外用户标识

UID SHALL 是唯一对外暴露的用户标识。系统 MUST NOT 在前端展示、URL、接口请求/响应体中暴露 user.id（cuid2）或 openid。所有跨用户操作（如门店加顾问、运营冻结、查询订单关联用户）SHALL 通过 UID 进行，MUST NOT 通过 user.id。

#### 场景：响应不暴露 user.id 与 openid

- **WHEN** 任意对外接口返回用户相关信息
- **THEN** 响应中出现 UID，但不出现 user.id（cuid2）或 openid

### Requirement: 按 UID 查询用户服务

系统 SHALL 提供 `findUserByUid(uid)` 查询服务，按 UID 返回用户基础信息（不含 openid）。UID 不存在时 SHALL 返回明确的「未找到」结果。

#### 场景：按 UID 查到用户

- **WHEN** 用一个存在的 UID 调用 `findUserByUid`
- **THEN** 返回该用户的基础信息，且不含 openid

#### 场景：UID 不存在

- **WHEN** 用一个不存在的 UID 调用 `findUserByUid`
- **THEN** 返回明确的「未找到」结果，而非抛未处理异常
