# Notion 导出完整数据结构调研报告

> 最后更新：2025-12-18

## 目录
- [1. 导出选项](#1-导出选项)
- [2. 文件结构](#2-文件结构)
- [3. 内容格式](#3-内容格式)
- [4. 元数据](#4-元数据)
- [5. 特殊内容](#5-特殊内容)
- [6. 附件处理](#6-附件处理)

---

## 1. 导出选项

### 1.1 Markdown & CSV 导出

**特点：**
- 普通页面导出为 `.md` 文件
- 数据库导出为 `.csv` 文件，每个子页面为独立的 Markdown 文件
- Callout 块导出为 HTML（Markdown 无等效格式）
- 导出时可选择包含子页面

**结构示例：**
```
exported-workspace/
├── index.html (导航地图)
├── Page Name 8c14a3b7b53f4b908b0f8db1eaa2fb87.md
├── Database 9b30b13b97a74acda7dd1f152937e173.csv
├── Subfolder abc123def456/
│   ├── Subpage 1 def456ghi789.md
│   └── Subpage 2 ghi789jkl012.md
└── media/ (或独立的资源文件夹)
    ├── image1.png
    └── document.pdf
```

**文件命名规则：**
- 格式：`页面标题 + 空格 + 32位UUID.扩展名`
- 示例：`My Page 8c14a3b7b53f4b908b0f8db1eaa2fb87.md`
- UUID 用于保持内部链接的完整性
- 正则表达式匹配：`r'( \w{32,32}\b)'`

### 1.2 HTML 导出

**特点：**
- 所有页面和数据库都可导出为 HTML
- 支持导出评论（页面级和块级，包括已解决和未解决的）
- 支持导出评论中提到的文件、页面或用户
- 包含 sitemap（index.html）用于导航
- 压缩包包含 HTML 文件和图片

**结构：**
```
exported-workspace.zip
├── index.html (站点地图)
├── Page 1 uuid.html
├── Page 2 uuid.html
├── Subfolder uuid/
│   └── Nested Page uuid.html
└── assets/ 或 media/
    └── images, files
```

### 1.3 PDF 导出（商业版/企业版）

- 整个工作区可导出为 PDF
- 用于法律和合规备份
- 包含嵌套页面和资源文件夹

### 1.4 API JSON 结构

通过 Notion API 获取的数据为 JSON 格式，包含完整的块结构和属性信息。

---

## 2. 文件结构

### 2.1 目录层级

**包含子页面时：**
- 选项："Create folders for subpages"
- 子页面会创建独立文件夹
- 文件夹名包含 32 位 UUID
- 保持 Notion 中的层级结构

**不包含子页面时：**
- 所有文件在同一层级
- 减少路径长度（避免 Windows 路径限制）

### 2.2 路径长度限制

- Windows 系统有路径长度限制（通常为 260 字符）
- 复杂嵌套结构 + UUID 可能超过限制
- 建议使用 7-Zip 等工具解压（支持长路径）

### 2.3 Sitemap（导航地图）

- 文件名：`index.html`
- 包含所有导出页面的本地链接
- 适用于 HTML 和 Markdown 格式

---

## 3. 内容格式

### 3.1 所有 Block 类型（API JSON 格式）

#### 基础文本块

**1. Paragraph（段落）**
```json
{
  "type": "paragraph",
  "paragraph": {
    "rich_text": [{"type": "text", "text": {"content": "Text here"}}],
    "color": "default",
    "children": []
  }
}
```

**2. Headings（标题）**
```json
{
  "type": "heading_2",
  "heading_2": {
    "rich_text": [{"type": "text", "text": {"content": "Heading text"}}],
    "color": "default",
    "is_toggleable": false
  }
}
```
- 支持 `heading_1`, `heading_2`, `heading_3`
- 可设置为可折叠（`is_toggleable`）

**3. Bulleted List Item（无序列表）**
```json
{
  "type": "bulleted_list_item",
  "bulleted_list_item": {
    "rich_text": [{"type": "text", "text": {"content": "Item"}}],
    "color": "default",
    "children": []
  }
}
```

**4. Numbered List Item（有序列表）**
```json
{
  "type": "numbered_list_item",
  "numbered_list_item": {
    "rich_text": [{"type": "text", "text": {"content": "Item"}}],
    "color": "default",
    "children": []
  }
}
```

**5. To Do（待办事项）**
```json
{
  "type": "to_do",
  "to_do": {
    "rich_text": [{"type": "text", "text": {"content": "Task"}}],
    "checked": false,
    "color": "default",
    "children": []
  }
}
```

**6. Toggle（可折叠块）**
```json
{
  "type": "toggle",
  "toggle": {
    "rich_text": [{"type": "text", "text": {"content": "Toggle text"}}],
    "color": "default",
    "children": []
  }
}
```

**7. Callout（提示框）**
```json
{
  "type": "callout",
  "callout": {
    "rich_text": [{"type": "text", "text": {"content": "Callout content"}}],
    "icon": {"emoji": "⭐"},
    "color": "default"
  }
}
```

**8. Quote（引用）**
```json
{
  "type": "quote",
  "quote": {
    "rich_text": [{"type": "text", "text": {"content": "Quote text"}}],
    "color": "default",
    "children": []
  }
}
```

**9. Code（代码块）**
```json
{
  "type": "code",
  "code": {
    "rich_text": [{"type": "text", "text": {"content": "const a = 3"}}],
    "language": "javascript",
    "caption": []
  }
}
```

**10. Divider（分割线）**
```json
{
  "type": "divider",
  "divider": {}
}
```

#### 表格和布局

**11. Table（表格）**
```json
{
  "type": "table",
  "table": {
    "table_width": 2,
    "has_column_header": false,
    "has_row_header": false
  }
}
```

**12. Table Row（表格行）**
```json
{
  "type": "table_row",
  "table_row": {
    "cells": [
      [{"type": "text", "text": {"content": "Column 1"}}],
      [{"type": "text", "text": {"content": "Column 2"}}]
    ]
  }
}
```

**13. Column List & Column（列布局）**
```json
{
  "type": "column_list",
  "column_list": {}
}
```

```json
{
  "type": "column",
  "column": {
    "width_ratio": 0.25
  }
}
```

#### 媒体和嵌入

**14. Image（图片）**
```json
{
  "type": "image",
  "image": {
    "type": "external",
    "external": {"url": "https://example.com/image.png"}
  }
}
```

**15. Video（视频）**
```json
{
  "type": "video",
  "video": {
    "type": "external",
    "external": {"url": "https://example.com/video.mp4"}
  }
}
```

**16. Audio（音频）**
```json
{
  "type": "audio",
  "audio": {
    "type": "external",
    "external": {"url": "https://example.com/audio.mp3"}
  }
}
```

**17. File（文件）**
```json
{
  "type": "file",
  "file": {
    "type": "external",
    "external": {"url": "https://example.com/document.txt"},
    "caption": [],
    "name": "document.txt"
  }
}
```

**18. PDF**
```json
{
  "type": "pdf",
  "pdf": {
    "type": "external",
    "external": {"url": "https://example.com/file.pdf"}
  }
}
```

**19. Embed（嵌入）**
```json
{
  "type": "embed",
  "embed": {
    "url": "https://example.com"
  }
}
```

**20. Bookmark（书签）**
```json
{
  "type": "bookmark",
  "bookmark": {
    "url": "https://example.com",
    "caption": []
  }
}
```

**21. Link Preview（链接预览）**
```json
{
  "type": "link_preview",
  "link_preview": {
    "url": "https://github.com/example/repo/pull/1234"
  }
}
```
- 只读，不能通过 API 创建

#### 高级块

**22. Synced Block（同步块）- 原始**
```json
{
  "type": "synced_block",
  "synced_block": {
    "synced_from": null,
    "children": []
  }
}
```

**23. Synced Block（同步块）- 副本**
```json
{
  "type": "synced_block",
  "synced_block": {
    "synced_from": {
      "type": "block_id",
      "block_id": "original_id"
    }
  }
}
```

**24. Template（模板按钮）**
```json
{
  "type": "template",
  "template": {
    "rich_text": [{"type": "text", "text": {"content": "Template button"}}],
    "children": []
  }
}
```
- 自 2023年3月27日起，API 不再支持创建模板块

#### 导航和组织

**25. Breadcrumb（面包屑）**
```json
{
  "type": "breadcrumb",
  "breadcrumb": {}
}
```

**26. Table of Contents（目录）**
```json
{
  "type": "table_of_contents",
  "table_of_contents": {
    "color": "default"
  }
}
```

#### 数据库块

**27. Child Database（子数据库）**
```json
{
  "type": "child_database",
  "child_database": {
    "title": "My database"
  }
}
```

**28. Child Page（子页面）**
```json
{
  "type": "child_page",
  "child_page": {
    "title": "Page title"
  }
}
```

#### 内联元素

**29. Equation（公式）**
```json
{
  "type": "equation",
  "equation": {
    "expression": "e=mc^2"
  }
}
```

### 3.2 颜色选项

所有支持颜色的块类型可使用以下值：
- `default`
- `blue`, `blue_background`
- `brown`, `brown_background`
- `gray`, `gray_background`
- `green`, `green_background`
- `orange`, `orange_background`
- `pink`, `pink_background`
- `purple`, `purple_background`
- `red`, `red_background`
- `yellow`, `yellow_background`

### 3.3 Rich Text（富文本）格式

#### 基本结构

```json
{
  "type": "text",
  "text": {
    "content": "Some words",
    "link": null
  },
  "annotations": {
    "bold": false,
    "italic": false,
    "strikethrough": false,
    "underline": false,
    "code": false,
    "color": "default"
  },
  "plain_text": "Some words",
  "href": null
}
```

#### Annotations（样式标注）

| 属性 | 类型 | 说明 |
|------|------|------|
| `bold` | boolean | 粗体 |
| `italic` | boolean | 斜体 |
| `strikethrough` | boolean | 删除线 |
| `underline` | boolean | 下划线 |
| `code` | boolean | 行内代码 |
| `color` | string | 颜色（同上述颜色选项） |

#### Link（链接）

```json
{
  "type": "text",
  "text": {
    "content": "inline link",
    "link": {
      "url": "https://developers.notion.com/"
    }
  },
  "href": "https://developers.notion.com/"
}
```

#### Mention（提及）类型

**User Mention（用户）**
```json
{
  "type": "mention",
  "mention": {
    "type": "user",
    "user": {
      "object": "user",
      "id": "b2e19928-b427-4aad-9a9d-fde65479b1d9"
    }
  },
  "plain_text": "@Anonymous"
}
```

**Page Mention（页面）**
```json
{
  "type": "mention",
  "mention": {
    "type": "page",
    "page": {"id": "3c612f56-fdd0-4a30-a4d6-bda7d7426309"}
  },
  "plain_text": "This is a test page",
  "href": "https://www.notion.so/3c612f56fdd04a30a4d6bda7d7426309"
}
```

**Database Mention（数据库）**
```json
{
  "type": "mention",
  "mention": {
    "type": "database",
    "database": {"id": "a1d8501e-1ac1-43e9-a6bd-ea9fe6c8822b"}
  },
  "plain_text": "Database with test things"
}
```

**Date Mention（日期）**
```json
{
  "type": "mention",
  "mention": {
    "type": "date",
    "date": {
      "start": "2022-12-16",
      "end": null
    }
  },
  "plain_text": "2022-12-16"
}
```

**Link Preview Mention（链接预览）**
```json
{
  "type": "mention",
  "mention": {
    "type": "link_preview",
    "link_preview": {
      "url": "https://workspace.slack.com/archives/..."
    }
  },
  "href": "https://workspace.slack.com/archives/..."
}
```

**Template Mention（模板提及）**

日期模板：
```json
{
  "type": "mention",
  "mention": {
    "type": "template_mention",
    "template_mention": {
      "type": "template_mention_date",
      "template_mention_date": "today"
    }
  },
  "plain_text": "@Today"
}
```

用户模板：
```json
{
  "type": "mention",
  "mention": {
    "type": "template_mention",
    "template_mention": {
      "type": "template_mention_user",
      "template_mention_user": "me"
    }
  },
  "plain_text": "@Me"
}
```

#### Equation（公式）

```json
{
  "type": "equation",
  "equation": {
    "expression": "E = mc^2"
  },
  "plain_text": "E = mc^2",
  "href": null
}
```

### 3.4 数据库属性类型

#### 完整属性类型列表（24种）

**1. Checkbox（复选框）**
```json
{
  "id": "BBla",
  "name": "Task complete",
  "type": "checkbox",
  "checkbox": {}
}
```

**2. Rich Text（富文本）**
```json
{
  "id": "NZZ%3B",
  "name": "Project description",
  "type": "rich_text",
  "rich_text": {}
}
```

**3. Number（数字）**
```json
{
  "id": "%7B%5D_P",
  "name": "Price",
  "type": "number",
  "number": {
    "format": "dollar"
  }
}
```

**4. Select（单选）**
```json
{
  "id": "%40Q%5BM",
  "name": "Food group",
  "type": "select",
  "select": {
    "options": [
      {
        "id": "e28f74fc-83a7-4469-8435-27eb18f9f9de",
        "name": "🥦Vegetable",
        "color": "purple"
      }
    ]
  }
}
```

**5. Multi-select（多选）**
```json
{
  "id": "flsb",
  "name": "Store availability",
  "type": "multi_select",
  "multi_select": {
    "options": [
      {
        "id": "5de29601-9c24-4b04-8629-0bca891c5120",
        "name": "Market A",
        "color": "blue"
      }
    ]
  }
}
```

**6. Date（日期）**
```json
{
  "id": "AJP%7D",
  "name": "Task due date",
  "type": "date",
  "date": {}
}
```
- 导入/导出格式：`MM/DD/YYYY` 或 `YYYY-MM-DD`
- 支持结束日期和具体时间

**7. Status（状态）**
```json
{
  "id": "biOx",
  "name": "Status",
  "type": "status",
  "status": {
    "options": [
      {
        "id": "034ece9a-384d-4d1f-97f7-7f685b29ae9b",
        "name": "Not started",
        "color": "default"
      }
    ],
    "groups": [
      {
        "id": "b9d42483-e576-4858-a26f-ed940a5f678f",
        "name": "To-do",
        "color": "gray",
        "option_ids": ["034ece9a-384d-4d1f-97f7-7f685b29ae9b"]
      }
    ]
  }
}
```
- 包含分组（如 "To-do", "In progress", "Complete"）
- 不能通过 API 更新，需在 UI 中修改

**8. URL**
```json
{
  "id": "BZKU",
  "name": "Project URL",
  "type": "url",
  "url": {}
}
```

**9. Email（邮箱）**
```json
{
  "id": "oZbC",
  "name": "Contact email",
  "type": "email",
  "email": {}
}
```

**10. Phone Number（电话）**
```json
{
  "id": "ULHa",
  "name": "Contact phone number",
  "type": "phone_number",
  "phone_number": {}
}
```

**11. Files（文件和媒体）**
```json
{
  "id": "pb%3E%5B",
  "name": "Product image",
  "type": "files",
  "files": {}
}
```

**12. People（人员）**
```json
{
  "id": "FlgQ",
  "name": "Project owner",
  "type": "people",
  "people": {}
}
```

**13. Formula（公式）**
```json
{
  "id": "YU%7C%40",
  "name": "Updated price",
  "type": "formula",
  "formula": {
    "expression": "{{notion:block_property:BtVS:00000000-0000-0000-0000-000000000000:8994905a-074a-415f-9bcf-d1f8b4fa38e4}}/2"
  }
}
```

**14. Relation（关联）**
```json
{
  "id": "~pex",
  "name": "Projects",
  "type": "relation",
  "relation": {
    "data_source_id": "6c4240a9-a3ce-413e-9fd0-8a51a4d0a49b",
    "dual_property": {
      "synced_property_name": "Tasks",
      "synced_property_id": "JU]K"
    }
  }
}
```
- CSV 列不能与 Relation 属性合并

**15. Rollup（汇总）**
```json
{
  "id": "%5E%7Cy%3C",
  "name": "Estimated total project time",
  "type": "rollup",
  "rollup": {
    "rollup_property_name": "Days to complete",
    "relation_property_name": "Tasks",
    "function": "sum"
  }
}
```

**16. Created Time（创建时间）**
```json
{
  "id": "XcAf",
  "name": "Created time",
  "type": "created_time",
  "created_time": {}
}
```

**17. Created By（创建者）**
```json
{
  "id": "%5BJCR",
  "name": "Created by",
  "type": "created_by",
  "created_by": {}
}
```

**18. Last Edited Time（最后编辑时间）**
```json
{
  "id": "jGdo",
  "name": "Last edited time",
  "type": "last_edited_time",
  "last_edited_time": {}
}
```

**19. Last Edited By（最后编辑者）**
```json
{
  "id": "last_edited_by_id",
  "name": "Last edited by",
  "type": "last_edited_by",
  "last_edited_by": {}
}
```

**20. Title（标题）**
```json
{
  "id": "title",
  "name": "Project name",
  "type": "title",
  "title": {}
}
```
- 每个数据库必须有且仅有一个 `title` 属性

**21. Place（地点）**
```json
{
  "id": "Xqz4",
  "name": "Place",
  "type": "place",
  "place": {}
}
```

**22. Unique ID（唯一标识符）**
```json
{
  "id": "task_id",
  "name": "Task ID",
  "type": "unique_id",
  "unique_id": {
    "prefix": "TASK"
  }
}
```

**23. Button（按钮）** - API 不支持

**24. AI Autofill（AI 自动填充）** - 2023 年引入
- 包含自定义提示功能

#### CSV 导出格式

**基本规则：**
- 仅支持完整页面数据库（full-page database）
- 第一行为表头
- 隐藏的属性/列也会被导出
- 混合数据类型的列默认为字符串
- 第一个非富文本的文本列作为主键
- 文件格式：UTF-8

**日期格式：**
- 导入：`MM/DD/YYYY`
- 建议：`YYYY-MM-DD`

**多视图处理：**
- 导出包含所有数据，不受当前视图限制

---

## 4. 元数据

### 4.1 Page Object（页面对象）结构

```json
{
  "object": "page",
  "id": "45ee8d13-687b-47ce-a5ca-6e2e45548c4b",
  "created_time": "2022-03-01T19:05:00.000Z",
  "last_edited_time": "2022-07-06T19:41:00.000Z",
  "created_by": {
    "object": "user",
    "id": "user_id"
  },
  "last_edited_by": {
    "object": "user",
    "id": "user_id"
  },
  "cover": {
    "type": "external",
    "external": {
      "url": "https://website.domain/images/image.png"
    }
  },
  "icon": {
    "type": "emoji",
    "emoji": "😀"
  },
  "parent": {
    "type": "database_id",
    "database_id": "database_id"
  },
  "archived": false,
  "in_trash": false,
  "properties": {
    "title": {
      "id": "title",
      "type": "title",
      "title": [
        {
          "type": "text",
          "text": {
            "content": "Page title"
          }
        }
      ]
    }
  },
  "url": "https://www.notion.so/page-title-...",
  "public_url": null
}
```

### 4.2 核心字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `object` | string | 始终为 `"page"` |
| `id` | UUIDv4 | 页面的唯一标识符 |
| `created_time` | ISO 8601 | 创建时间戳 |
| `last_edited_time` | ISO 8601 | 最后编辑时间戳 |
| `created_by` | Partial User | 创建者信息 |
| `last_edited_by` | Partial User | 最后编辑者信息 |
| `archived` | boolean | 归档状态 |
| `in_trash` | boolean | 是否在回收站 |
| `url` | string | Notion 页面 URL |
| `public_url` | string | 公开发布的 URL（未发布时为 null） |

### 4.3 Icon（图标）类型

**Emoji 图标：**
```json
{
  "icon": {
    "type": "emoji",
    "emoji": "😀"
  }
}
```

**File Upload 图标：**
```json
{
  "icon": {
    "type": "file_upload",
    "file_upload": {
      "id": "43833259-72ae-404e-8441-b6577f3159b4"
    }
  }
}
```

**External 图标：**
```json
{
  "icon": {
    "type": "external",
    "external": {
      "url": "https://example.com/icon.png"
    }
  }
}
```

### 4.4 Cover（封面）类型

**External 封面：**
```json
{
  "cover": {
    "type": "external",
    "external": {
      "url": "https://website.domain/images/image.png"
    }
  }
}
```

**File Upload 封面：**
```json
{
  "cover": {
    "type": "file_upload",
    "file_upload": {
      "id": "file_upload_id"
    }
  }
}
```

### 4.5 Parent（父级）类型

**Database Parent：**
```json
{
  "parent": {
    "type": "database_id",
    "database_id": "database_id"
  }
}
```

**Page Parent：**
```json
{
  "parent": {
    "type": "page_id",
    "page_id": "page_id"
  }
}
```

**Workspace Parent：**
```json
{
  "parent": {
    "type": "workspace",
    "workspace": true
  }
}
```

---

## 5. 特殊内容

### 5.1 Synced Block（同步块）

**原始同步块：**
- `synced_from` 为 `null`
- 包含 `children` 数组
- 作为其他同步块的源

**同步副本：**
- `synced_from` 指向原始块的 `block_id`
- 内容自动同步更新

### 5.2 Template Button（模板按钮）

- 用于快速创建预定义内容
- API 自 2023年3月27日起不再支持创建

### 5.3 Breadcrumb（面包屑）

- 显示当前页面在层级结构中的位置
- 无配置参数

### 5.4 Table of Contents（目录）

- 自动生成页面标题目录
- 支持颜色设置

### 5.5 嵌入内容类型

| 类型 | JSON 属性 | 说明 |
|------|----------|------|
| Embed | `embed.url` | 通用嵌入 |
| Bookmark | `bookmark.url` | 书签链接 |
| Video | `video.type` + URL | 视频（external/file） |
| Audio | `audio.type` + URL | 音频 |
| File | `file.type` + URL | 文件 |
| PDF | `pdf.type` + URL | PDF 文档 |
| Link Preview | `link_preview.url` | GitHub PR 等链接预览（只读） |

### 5.6 评论和讨论

**HTML 导出支持：**
- 页面级评论
- 块级评论
- 已解决和未解决的评论
- 评论中提到的文件、页面、用户

**API 访问：**
- 通过 Comments API 获取
- 不包含在标准 Page/Block 导出中

### 5.7 链接数据库视图

**子数据库：**
- 嵌入在页面中的数据库
- 导出为 CSV（Markdown/CSV 格式）
- 包含所有视图的数据

**链接视图：**
- 引用现有数据库的视图
- 导出时包含在父数据库中

---

## 6. 附件处理

### 6.1 图片导出方式

**External URL：**
```json
{
  "type": "image",
  "image": {
    "type": "external",
    "external": {
      "url": "https://example.com/image.png"
    }
  }
}
```
- 指向外部 URL
- 不占用 Notion 存储空间

**File Upload：**
```json
{
  "type": "image",
  "image": {
    "type": "file",
    "file": {
      "url": "https://prod-files-secure.s3.us-west-2.amazonaws.com/...",
      "expiry_time": "2024-01-01T00:00:00.000Z"
    }
  }
}
```
- Notion 托管的文件
- URL 带有过期时间

**导出存储：**
- HTML/Markdown 导出：图片存储在 `media/` 或 `assets/` 文件夹
- CSV 导出：图片 URL 保留在 CSV 中
- 文件名可能包含 UUID

### 6.2 文件附件导出

**存储位置：**
- `media/` 文件夹（通常）
- 与 HTML/Markdown 文件同级或子级

**文件引用：**
- Markdown：`![image](media/image.png)` 或 `[file](media/document.pdf)`
- HTML：相对路径链接

**保持完整性：**
- 移动导出文件时必须保持 `media` 文件夹相对位置
- 否则链接会失效

### 6.3 外部链接 vs 上传文件

| 类型 | 存储位置 | 导出行为 | 过期 |
|------|----------|----------|------|
| External URL | 外部服务器 | 保留原始 URL | 取决于外部源 |
| File Upload | Notion 服务器 | 下载到 media/ | Notion URL 会过期 |

### 6.4 Media 文件夹结构示例

```
exported-workspace/
├── Page 1 abc123.md
├── Page 2 def456.md
├── Database xyz789.csv
└── media/
    ├── image1_uuid.png
    ├── document_uuid.pdf
    ├── video_uuid.mp4
    └── audio_uuid.mp3
```

或

```
exported-workspace/
├── index.html
├── Page 1 abc123.html
├── Subfolder def456/
│   ├── Subpage ghi789.html
│   └── assets/
│       └── image.png
└── assets/
    ├── main-image.png
    └── document.pdf
```

---

## 7. 实战示例

### 7.1 Markdown 导出示例

**导出文件：`Meeting Notes 8c14a3b7b53f4b908b0f8db1eaa2fb87.md`**

```markdown
# Meeting Notes

**Date:** 2024-01-15

## Attendees

- @John Doe
- @Jane Smith

## Agenda

1. Project updates
2. Budget review
3. Next steps

## Action Items

- [ ] Send follow-up email
- [x] Update project timeline
- [ ] Schedule next meeting

## Resources

![Project diagram](media/diagram_abc123.png)

[Budget spreadsheet](media/budget_def456.xlsx)

> Important: Deadline is next Friday

```callout
⚠️ **Note:** This is a callout block exported as HTML
```

---
**Tags:** #meeting #project-alpha
```

**对应的 media 文件夹：**
```
media/
├── diagram_abc123.png
└── budget_def456.xlsx
```

### 7.2 CSV 导出示例

**文件：`Tasks Database 9b30b13b97a74acda7dd1f152937e173.csv`**

```csv
Name,Status,Assignee,Due Date,Priority,Tags,Completed
"Implement feature A","In Progress","John Doe","01/31/2024","High","development,frontend",FALSE
"Fix bug #123","Done","Jane Smith","01/15/2024","Medium","bugfix",TRUE
"Write documentation","Not Started","","02/15/2024","Low","docs",FALSE
"Code review","In Progress","John Doe","01/20/2024","High","review,backend",FALSE
```

**对应的子页面：**
```
Tasks Database 9b30b13b97a74acda7dd1f152937e173/
├── Implement feature A abc123.md
├── Fix bug #123 def456.md
├── Write documentation ghi789.md
└── Code review jkl012.md
```

### 7.3 API JSON 完整示例

**获取页面内容：**

```json
{
  "object": "page",
  "id": "45ee8d13-687b-47ce-a5ca-6e2e45548c4b",
  "created_time": "2024-01-01T10:00:00.000Z",
  "last_edited_time": "2024-01-15T15:30:00.000Z",
  "created_by": {
    "object": "user",
    "id": "user-uuid"
  },
  "last_edited_by": {
    "object": "user",
    "id": "user-uuid"
  },
  "cover": {
    "type": "external",
    "external": {
      "url": "https://images.unsplash.com/photo-example"
    }
  },
  "icon": {
    "type": "emoji",
    "emoji": "📝"
  },
  "parent": {
    "type": "workspace",
    "workspace": true
  },
  "archived": false,
  "in_trash": false,
  "properties": {
    "title": {
      "id": "title",
      "type": "title",
      "title": [
        {
          "type": "text",
          "text": {
            "content": "Project Documentation",
            "link": null
          },
          "annotations": {
            "bold": false,
            "italic": false,
            "strikethrough": false,
            "underline": false,
            "code": false,
            "color": "default"
          },
          "plain_text": "Project Documentation",
          "href": null
        }
      ]
    }
  },
  "url": "https://www.notion.so/Project-Documentation-...",
  "public_url": null
}
```

**块内容示例：**

```json
{
  "results": [
    {
      "object": "block",
      "id": "block-uuid-1",
      "type": "heading_1",
      "heading_1": {
        "rich_text": [
          {
            "type": "text",
            "text": {
              "content": "Introduction"
            },
            "annotations": {
              "bold": true,
              "italic": false,
              "strikethrough": false,
              "underline": false,
              "code": false,
              "color": "default"
            }
          }
        ],
        "color": "blue",
        "is_toggleable": false
      }
    },
    {
      "object": "block",
      "id": "block-uuid-2",
      "type": "paragraph",
      "paragraph": {
        "rich_text": [
          {
            "type": "text",
            "text": {
              "content": "This project uses "
            }
          },
          {
            "type": "text",
            "text": {
              "content": "Notion API",
              "link": {
                "url": "https://developers.notion.com"
              }
            },
            "annotations": {
              "bold": true,
              "code": false
            }
          },
          {
            "type": "text",
            "text": {
              "content": " to sync data."
            }
          }
        ]
      }
    },
    {
      "object": "block",
      "id": "block-uuid-3",
      "type": "to_do",
      "to_do": {
        "rich_text": [
          {
            "type": "text",
            "text": {
              "content": "Complete API integration"
            }
          }
        ],
        "checked": false,
        "color": "default"
      }
    },
    {
      "object": "block",
      "id": "block-uuid-4",
      "type": "callout",
      "callout": {
        "rich_text": [
          {
            "type": "text",
            "text": {
              "content": "Remember to update the documentation after each release!"
            },
            "annotations": {
              "bold": true
            }
          }
        ],
        "icon": {
          "emoji": "💡"
        },
        "color": "yellow_background"
      }
    },
    {
      "object": "block",
      "id": "block-uuid-5",
      "type": "image",
      "image": {
        "type": "file",
        "file": {
          "url": "https://prod-files-secure.s3.us-west-2.amazonaws.com/...",
          "expiry_time": "2024-01-16T00:00:00.000Z"
        },
        "caption": [
          {
            "type": "text",
            "text": {
              "content": "System Architecture Diagram"
            }
          }
        ]
      }
    },
    {
      "object": "block",
      "id": "block-uuid-6",
      "type": "code",
      "code": {
        "rich_text": [
          {
            "type": "text",
            "text": {
              "content": "const notion = new Client({ auth: process.env.NOTION_TOKEN });\nconst response = await notion.pages.retrieve({ page_id: pageId });"
            }
          }
        ],
        "language": "javascript",
        "caption": []
      }
    }
  ]
}
```

---

## 8. 关键注意事项

### 8.1 导出限制

1. **文件大小限制：**
   - Notion 对导出大小有限制
   - 大型工作区可能需要分批导出

2. **路径长度（Windows）：**
   - UUID 后缀会增加路径长度
   - 使用 7-Zip 等工具处理

3. **不支持的内容：**
   - 某些 AI 块不受 API 支持
   - 返回为 `"unsupported"` 类型

### 8.2 数据完整性

1. **保持文件夹结构：**
   - 移动文件时保持 `media/` 相对路径
   - 避免破坏内部链接

2. **UUID 的作用：**
   - 确保文件名唯一性
   - 维护内部链接映射
   - 可通过脚本清理（但需更新引用）

3. **时效性：**
   - Notion 托管的文件 URL 有过期时间
   - 导出后尽快处理或重新上传

### 8.3 格式兼容性

| 内容类型 | Markdown | HTML | CSV | API JSON |
|---------|----------|------|-----|----------|
| 基础文本 | ✅ | ✅ | ✅ | ✅ |
| Callout | HTML 格式 | ✅ | ❌ | ✅ |
| 颜色 | ❌ | ✅ | ❌ | ✅ |
| 复杂布局 | ⚠️ 部分 | ✅ | ❌ | ✅ |
| 评论 | ❌ | ✅（可选） | ❌ | 单独 API |
| 数据库 | CSV | HTML | ✅ | ✅ |

---

## 9. 参考资源

### 官方文档
- [Notion API - Block Reference](https://developers.notion.com/reference/block)
- [Notion API - Property Object](https://developers.notion.com/reference/property-object)
- [Notion API - Rich Text](https://developers.notion.com/reference/rich-text)
- [Notion API - Page Object](https://developers.notion.com/reference/page)
- [Export your content – Notion Help Center](https://www.notion.com/help/export-your-content)
- [Database properties – Notion Help Center](https://www.notion.com/help/database-properties)

### 社区工具
- [notion2md](https://github.com/echo724/notion2md) - Python CLI 导出工具
- [notion-export-markdown](https://github.com/dwarvesf/notion-export-markdown) - 转换为 Obsidian 格式
- UUID 清理脚本（多种语言实现）

### 相关文章
- [Export Notion Content: PDF, CSV, HTML Guide](https://www.bardeen.ai/answers/how-to-export-notion)
- [How to Export Notion: A Step-by-Step Guide](https://www.thebricks.com/resources/how-to-export-notion-a-step-by-step-guide)
- [Cleaning Up Notion Export Filenames](https://medium.com/@jonowschan/cleaning-up-notion-export-filenames-fbf3ebee4005)

---

**调研完成日期：** 2025-12-18
**调研工具：** Web Search, WebFetch, Notion API Documentation
**文档版本：** 1.0
