# AI 摘要功能设计方案

## 1. 功能概述

为笔记自动生成 AI 摘要，提升搜索效率和内容预览体验。

### 核心特性
- 与知识库索引集成，复用 Chunk 变化检测
- 动态摘要长度（根据原文长度调整）
- 段落式摘要 + 关键词提取
- 摘要纳入搜索范围
- Hover 预览（显示摘要 + 标签）

---

## 2. 触发条件

### 2.1 基本条件
```
触发摘要生成 = 知识库已启用 AND 字数 > 500 AND (新笔记 OR Chunk变化率 > 30%)
```

| 条件 | 值 | 说明 |
|-----|-----|------|
| 知识库开关 | enabled | 摘要功能由知识库开关控制 |
| 最小字数 | 500 字 | 低于此值不生成摘要 |
| 变化阈值 | 30% | Chunk 变化超过 30% 才重新生成 |

### 2.2 触发时机
- 编辑器失焦时触发向量索引
- 向量索引完成后，根据 Chunk 变化率决定是否更新摘要
- 摘要生成异步执行，不阻塞索引流程

### 2.3 变化检测算法（基于 Chunk）

复用知识库的 `diffChunks` 函数，基于 Chunk 级别的 hash 对比：

```typescript
// indexing-service.ts
const result = diffChunks(oldChunks, newChunks)
// result = { toAdd, toDelete, unchanged }

// 计算变化率
const totalOldChunks = oldChunks.length
const totalNewChunks = newChunks.length
const changedChunks = result.toAdd.length + result.toDelete.length
const changeRatio = changedChunks / Math.max(totalOldChunks, totalNewChunks, 1)

// 变化率 > 30% 触发摘要更新
if (isNewNote || changeRatio > 0.3) {
  generateSummary(noteId)
}
```

**优点**：
- 零额外存储：复用现有的 Chunk 数据
- 零额外计算：diffChunks 在索引流程中已经执行
- 粒度合适：Chunk 级别的变化检测比字符级更有意义

---

## 3. 摘要生成

### 3.1 动态长度策略

```typescript
function getTargetSummaryLength(contentLength: number): number {
  if (contentLength <= 800) {
    return Math.round(contentLength * 0.25)   // 25%, 约 125-200 字
  }
  if (contentLength <= 2000) {
    return Math.round(contentLength * 0.20)   // 20%, 约 160-400 字
  }
  if (contentLength <= 5000) {
    return Math.round(contentLength * 0.15)   // 15%, 约 300-750 字
  }
  // 超长内容，上限 500 字
  return Math.min(Math.round(contentLength * 0.10), 500)
}
```

### 3.2 超长内容处理

| 内容长度 | 处理方式 |
|---------|---------|
| ≤ 3000 字 | 发送全文 |
| > 3000 字 | 提取大纲 + 前 2000 字 |

### 3.3 Prompt 设计

**普通内容 (≤ 3000 字)**：
```
请为以下笔记生成摘要和关键词。

要求：
1. 摘要约 {targetLength} 字，用一段话概括主要内容
2. 提取 3-5 个关键词，用逗号分隔

格式：
摘要：{摘要内容}
关键词：{关键词1}, {关键词2}, {关键词3}

笔记内容：
{content}
```

**超长内容 (> 3000 字)**：
```
请根据以下笔记的大纲和开头部分生成摘要和关键词。

要求：
1. 摘要约 {targetLength} 字，用一段话概括主要内容
2. 提取 3-5 个关键词，用逗号分隔

格式：
摘要：{摘要内容}
关键词：{关键词1}, {关键词2}, {关键词3}

## 大纲结构
{outline}

## 开头内容
{first2000chars}
```

---

## 4. 数据存储

### 4.1 数据库字段

```sql
-- notes 表
ai_summary TEXT DEFAULT NULL           -- AI 生成的摘要
summary_content_hash TEXT DEFAULT NULL -- 生成摘要时的内容 hash

-- note_tags 表
source TEXT DEFAULT 'user'             -- 'user' | 'ai'
```

### 4.2 关键词存储（复用 Tag 系统）

AI 提取的关键词存储为 Tag，通过 `source='ai'` 区分：

```typescript
function updateAITags(noteId: string, tagNames: string[]): void {
  db.transaction(() => {
    // 删除旧的 AI 标签
    db.prepare("DELETE FROM note_tags WHERE note_id = ? AND source = 'ai'").run(noteId)
    // 添加新的 AI 标签
    for (const name of tagNames) {
      addAITagToNote(noteId, name.trim())
    }
  })()
}
```

---

## 5. 架构设计

### 5.1 流程图

```
笔记失焦
    ↓
App.tsx: triggerIndexCheck(noteId)
    ↓
IndexingService.checkAndIndex()
    ↓
知识库未启用? → 跳过（摘要也不触发）
    ↓
内容无变化（hash 相同）? → 跳过
    ↓
indexNoteIncremental()
    ↓
diffChunks() 计算变化
    ↓
计算 changeRatio
    ↓
changeRatio > 30%? → generateSummary(noteId)
```

### 5.2 关键文件

| 文件 | 职责 |
|-----|------|
| `src/main/embedding/indexing-service.ts` | 触发摘要（基于 Chunk 变化率） |
| `src/main/summary-service.ts` | 摘要生成逻辑 |
| `src/main/database.ts` | 数据存储 |

---

## 6. 错误处理

### 6.1 降级策略

| 错误场景 | 处理方式 |
|---------|---------|
| 知识库未启用 | 不触发摘要生成 |
| Sanqian 未连接 | 静默跳过，不阻塞用户 |
| AI 调用超时 (2 分钟) | 放弃本次生成，保留旧摘要 |
| AI 返回格式错误 | 尝试解析，失败则使用原始响应 |

### 6.2 并发控制

使用 `processingNotes: Set<string>` 防止同一笔记的重复请求。

---

## 7. UI 展示

### 7.1 Hover 预览

笔记列表 hover 1.5 秒后显示预览弹窗：
- 显示 AI 摘要（可滚动，max-height: 120px）
- 显示标签（用户标签灰色，AI 标签主题色）
- 弹窗位于笔记项右侧

### 7.2 搜索集成

AI 摘要纳入搜索范围：

```sql
SELECT ... FROM notes
WHERE deleted_at IS NULL
  AND (
    title LIKE ?
    OR content LIKE ?
    OR ai_summary LIKE ?
  )
```

---

## 8. 配置参数

| 参数 | 值 | 位置 |
|-----|-----|------|
| `MIN_CONTENT_LENGTH` | 500 | summary-service.ts |
| `MAX_FULL_CONTENT_LENGTH` | 3000 | summary-service.ts |
| `EXCERPT_LENGTH` | 2000 | summary-service.ts |
| `MAX_SUMMARY_LENGTH` | 500 | summary-service.ts |
| `AI_TIMEOUT` | 120000 (2分钟) | summary-service.ts |
| `SUMMARY_CHANGE_THRESHOLD` | 0.3 (30%) | indexing-service.ts |
