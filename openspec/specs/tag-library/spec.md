# tag-library Specification

## Purpose
TBD - created by archiving change add-consultant-binding. Update Purpose after archive.
## Requirements
### Requirement: 全局标签库与用途区分

系统 SHALL 建立 `tag` 表(name、`type`、sort_order、enabled、时间),`type` 区分用途:`consultant`(顾问标签,如「不推销」「擅长某风格」)与 `review`(评价标签,如「技术好」「准时」)。同一 `(type, name)` SHALL 唯一。

#### 场景:不同 type 同名互不冲突

- **WHEN** 创建一个 `type=consultant` 的「准时」与一个 `type=review` 的「准时」
- **THEN** 两者可共存(type 维度区分)

### Requirement: 运营标签库 CRUD

系统 SHALL 提供运营(requireRole super_admin,`/api/v1/admin/tags`)对标签的创建、编辑、排序、启用/停用、按 type 列表。非运营 SHALL 返回 403。

#### 场景:运营按 type 管理标签

- **WHEN** super_admin 创建/列出 `type=consultant` 的标签
- **THEN** 操作成功,列表按 type 过滤

#### 场景:非运营无权管理标签

- **WHEN** store_owner 调用标签管理端点
- **THEN** 返回 403 `auth.forbidden`

### Requirement: 停用标签保留存量关联

停用(enabled=false)一个标签 SHALL NOT 删除已有的实体关联(如 consultant_tag),仅在新建/选择场景中不再作为可选项。

#### 场景:停用标签保留存量关联

- **WHEN** 停用一个已被顾问引用的标签
- **THEN** 已有 consultant_tag 关联保留,但该标签不再作为新选项展示

### Requirement: 顾问标签关联与校验

系统 SHALL 通过 `consultant_tag` 关联表(consultant_id, tag_id)表达顾问标签(多对多)。绑定的标签 MUST 存在、enabled 且 `type = consultant`,否则 SHALL 返回 400 `consultant.invalid_tag`。

#### 场景:绑定合法顾问标签

- **WHEN** 给顾问绑定若干 enabled 且 type=consultant 的标签
- **THEN** 在 consultant_tag 建立关联

#### 场景:绑定非法标签被拒

- **WHEN** 给顾问绑定一个停用、不存在或 type=review 的标签
- **THEN** 返回 400 `consultant.invalid_tag`,不建立关联
