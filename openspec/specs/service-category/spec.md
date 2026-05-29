# service-category Specification

## Purpose
TBD - created by archiving change add-store-crud. Update Purpose after archive.
## Requirements
### Requirement: 全局服务分类

系统 SHALL 建立 `service_category` 表(name、sort_order、enabled、时间),为**一级分类**(如理发/美容/按摩)。系统 MUST NOT 支持多级分类(MVP 仅一级)。

#### 场景:分类为一级

- **WHEN** 创建一个服务分类
- **THEN** 它是一级分类,无父分类字段

### Requirement: 运营服务分类 CRUD

系统 SHALL 提供运营(requireRole super_admin)的分类管理:创建、编辑、排序(sort_order)、启用/停用(enabled)、列表。

#### 场景:运营新建分类

- **WHEN** super_admin 创建「理发」分类
- **THEN** 分类被创建并可被门店引用

#### 场景:非运营无权管理分类

- **WHEN** store_owner 调用分类管理端点
- **THEN** 返回 403 `auth.forbidden`

### Requirement: 停用分类不影响已引用门店

停用(enabled=false)一个分类 SHALL NOT 删除已引用它的门店关联,仅在新建/筛选场景中不再作为可选项展示。

#### 场景:停用分类保留存量关联

- **WHEN** 停用一个已被门店引用的分类
- **THEN** 已有 `store_category` 关联保留,但该分类不再作为新选项展示

### Requirement: 门店分类关联

系统 SHALL 通过 `store_category` 关联表表达门店提供的服务分类(多对多),关联 SHALL 引用存在的 `service_category`。

#### 场景:门店关联到合法分类

- **WHEN** 门店声明它提供「理发」「美容」
- **THEN** 在 `store_category` 建立到对应分类的关联

#### 场景:关联不存在的分类被拒

- **WHEN** 门店关联到一个不存在的分类 id
- **THEN** 被拒绝,不建立关联

