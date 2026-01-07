# Agent Block 设计文档

> 状态：设计确定，可开始实现
> 创建时间：2025-01-07
> 更新时间：2026-01-07
> 相关文档：[sanqian/docs/meta-agent-design.md](../../sanqian/docs/meta-agent-design.md)

## 1. 概述

### 1.1 背景

Notes 不仅仅是记录工具，更是个人信息和任务中心。用户可以随时给任意 block 附加 AI agent 能力，分配给 agent 执行任务，产物可能是：
- 完成一个动作（如发邮件、创建日历事件）
- 生成一份报告
- 产出一个 artifact（可视化、交互组件等）

### 1.2 核心设计理念

**两种模式，统一体验：**

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  模式 1：单 block 附加（轻量）                                  │
│  ─────────────────────────────                                  │
│  • 给任意现有 block 附加 agent 能力                             │
│  • 左侧图标 + 右侧状态（hover 显示）                            │
│  • 结果通过弹窗展示，分开存储                                   │
│  • 不改变文档结构                                               │
│                                                                 │
│  模式 2：独立 Agent Block（多 block 引用）                      │
│  ───────────────────────────────────                            │
│  • 创建独立的 agent block                                       │
│  • 引用多个 blocks（支持非连续多选）                            │
│  • 作为文档的一部分存储                                         │
│  • Phase 2 支持                                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 与 AI Actions 的关系

Agent Block 和 AI Actions 是**两个独立的功能**：

| 方面 | AI Actions | Agent Block |
|------|------------|-------------|
| 定位 | 快捷文本操作 | 复杂任务执行 |
| 能力 | 固定操作（润色、翻译、总结） | 可调用 tools、skills，由 agent 执行 |
| 执行者 | 简单 LLM 调用 | 元 Agent 编排 |

两者**存储模式类似**（结果分开存储，不直接写入 note），但这只是实现上的巧合，不意味着功能上的继承关系。

### 1.4 与 sanqian 的关系

```
sanqian-notes (前端)              sanqian (后端)
     │                                │
     │  Agent Block                   │  元 Agent (Orchestrator)
     │  - UI 展示（图标/弹窗）        │  - 创建/调用/监督 agent
     │  - 用户交互                    │  - 任务执行
     │  - 结果渲染                    │  - 能力编排
     │                                │
     └────── 独立执行通道 ────────────┘
             (WebSocket/API)
```

---

## 2. 模式 1：单 Block 附加

### 2.1 UI 设计

**核心原则**：简约，不干扰阅读

```
┌─────────────────────────────────────────────────────────────────┐
│ 默认状态（无 agent 任务）                                       │
│                                                                 │
│      帮我调研 React 19 的新特性                                 │
│      │                                                         │
│      └─ 普通 block，无任何附加显示                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 附加 agent 后 - 默认状态（半透明）                              │
│                                                                 │
│ [🤖] 帮我调研 React 19 的新特性              Researcher · 32s ✓ │
│   │                                                         │   │
│   │                                                         │   │
│   └─ 左侧图标：半透明                    右侧信息：半透明 ──┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Hover 状态（不透明）                                            │
│                                                                 │
│ [🤖] 帮我调研 React 19 的新特性              Researcher · 32s ✓ │
│   │                                                         │   │
│   │                                                         │   │
│   └─ 左侧图标：不透明                    右侧信息：不透明 ──┘   │
│      点击打开弹窗                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**状态图标变化**：

| 状态 | 左侧图标 | 右侧信息 |
|------|----------|----------|
| 未执行 | 🤖 | `Agent名称` |
| 执行中 | 🔄 | `Agent名称 · 执行中...` |
| 已完成 | ✅ | `Agent名称 · 32s ✓` |
| 失败 | ❌ | `Agent名称 · 失败` |

### 2.2 弹窗设计

点击图标打开弹窗（类似 AI Actions 弹窗）：

```
┌────────────────────────────────────────────────────────────────┐
│ 🤖 Agent 任务                                          [✕]    │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│ 📝 输入内容:                                                   │
│ ┌────────────────────────────────────────────────────────────┐│
│ │ 帮我调研 React 19 的新特性                                 ││
│ └────────────────────────────────────────────────────────────┘│
│                                                                │
│ 💬 补充说明:                                                   │
│ ┌────────────────────────────────────────────────────────────┐│
│ │ 整理成表格格式，重点关注性能改进                           ││
│ └────────────────────────────────────────────────────────────┘│
│                                                                │
│ ⚙️ Agent: [自动选择 ▼]                                         │
│                                                                │
│                                         [取消] [▶️ 执行]       │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**执行中 & 结果展示**（参考现有 AI Actions / sanqian-chat）：

```
┌────────────────────────────────────────────────────────────────┐
│ 🤖 Agent 任务                              Researcher   [✕]   │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│ 📊 执行过程                                                    │
│ ├─ ✅ 分析任务                                                │
│ ├─ ✅ web_search("React 19 features")                         │
│ ├─ ✅ fetch_web("https://react.dev/...")                      │
│ └─ ✅ 整理内容                                                │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│ 📝 结果                                                        │
│                                                                │
│ | 特性 | 说明 | 用途 |                                        │
│ |------|------|------|                                        │
│ | Actions | 异步操作原语 | 表单提交 |                         │
│ | use() | Promise 读取 | 简化异步 |                           │
│ | ... | ... | ... |                                           │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│ ⏱️ 32s · 1,234 tokens                                          │
│                                                                │
│ [📝 插入到下方] [📋 复制] [🔄 重新执行] [💾 保存 Agent]        │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 2.3 交互流程

**触发方式**：
- ✅ 方式 A：选中 block → 右键菜单 "AI Actions" → "Agent 任务"
- ✅ 方式 C：block 菜单（六个点）→ "Agent 任务"
- Phase 2：快捷键 (Cmd+Shift+A)
- Phase 2：斜杠命令 `/agent` 或 `/task`（创建原生 Agent Block）

**核心原则**：触发即附加（agentTask 属性立即写入 block）

```
1. 触发 Agent 任务
     │
     ▼
2. 立即附加 agentTask 属性（status: idle）
   block 左侧出现 🤖 图标（半透明）
   右侧显示默认 agent
   同时打开弹窗
     │
     ▼
3. 弹窗操作
   ├─ 填写补充说明（可选）
   ├─ 选择 agent（可选，默认自动）
   ├─ 点击执行 → 继续步骤 4
   ├─ 点击移除 → 移除 agentTask 属性，图标消失
   └─ 关闭弹窗 → agentTask 属性保留（status: idle）
     │
     ▼
4. 执行中
   ├─ 图标变为 🔄
   ├─ 右侧显示 "执行中..."
   └─ 弹窗内显示执行步骤
     │
     ▼
5. 执行完成
   ├─ 图标变为 ✅
   ├─ 右侧显示 "32s ✓"
   └─ 弹窗内显示结果
     │
     ▼
6. 结果处理
   ├─ 插入到下方：结果作为新 block 插入
   ├─ 复制：复制到剪贴板
   ├─ 重新执行：覆盖上一次结果
   ├─ 移除：移除 agentTask 属性和记录
   └─ 关闭弹窗：结果保留，可随时点击图标/信息重新打开
```

**点击区域**：左侧图标和右侧信息都可以点击打开弹窗

**多次执行**：每次执行覆盖上一次记录，只保留最新结果

### 2.4 数据结构

**Block 属性扩展**：

```typescript
// 任意 block 都可以有这个属性
interface BlockAttrs {
  // ... 原有属性

  // Agent 任务关联
  agentTask?: {
    taskId: string;           // 关联的任务 ID
    agentId?: string;         // 使用的 agent
    status: 'idle' | 'running' | 'completed' | 'failed';
    completedAt?: string;
    duration?: number;        // 毫秒
  };
}
```

**独立存储的任务数据**（不在 note 中）：

```typescript
interface AgentTaskRecord {
  id: string;

  // 来源
  blockId: string;
  pageId: string;
  notebookId: string;

  // 输入
  input: {
    content: string;          // block 内容
    additionalPrompt?: string; // 补充说明
  };

  // Agent 配置
  agent: {
    mode: 'auto' | 'specified';
    agentId?: string;
    agentName?: string;
  };

  // 执行状态
  execution: {
    status: 'idle' | 'running' | 'completed' | 'failed';
    startedAt?: string;
    completedAt?: string;

    steps?: ExecutionStep[];

    result?: {
      type: 'text' | 'structured' | 'artifact' | 'file' | 'action';
      content: any;
    };

    error?: {
      message: string;
      details?: any;
    };

    meta?: {
      tokensUsed?: number;
      duration?: number;
      model?: string;
    };
  };

  createdAt: string;
  updatedAt: string;
}
```

---

## 3. 模式 2：独立 Agent Block（Phase 2）

### 3.1 使用场景

当用户需要：
- 引用多个 blocks 作为输入
- 非连续多选 blocks
- 创建一个持久化的任务记录在文档中

### 3.2 UI 设计（待优化）

```
┌─────────────────────────────────────────────────────────────────┐
│ 非连续多选后创建 Agent Block                                    │
│                                                                 │
│ [ ]  React 18 的主要特性...                    ← 被引用         │
│      其他内容...                                                │
│ [ ]  React 19 的新特性...                      ← 被引用         │
│      其他内容...                                                │
│                                                                 │
│ [🤖] Agent Block                               Researcher · ✓   │
│      📎 引用 2 个 block                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 数据结构

```typescript
interface AgentBlock {
  id: string;
  type: 'agent-block';

  // 引用的 blocks
  source: {
    refs: Array<{
      blockId: string;
      mode: 'content' | 'context';
    }>;
    additionalPrompt?: string;
  };

  // Agent 配置
  agent: {
    mode: 'auto' | 'specified';
    agentId?: string;
  };

  // 执行状态
  execution?: ExecutionState;
}
```

### 3.4 与模式 1 的区别

| 方面 | 模式 1（附加） | 模式 2（独立） |
|------|---------------|---------------|
| 触发方式 | 单个 block | 多选 blocks |
| 存储位置 | block 属性 + 独立存储 | 文档中的 block |
| 文档结构 | 不改变 | 新增 block |
| 结果展示 | 弹窗 | 可弹窗或内联 |
| 适用场景 | 轻量任务 | 复杂任务 |

---

## 4. 技术实现

### 4.1 Block 属性扩展（模式 1）

```typescript
// src/renderer/src/extensions/agent-task/index.ts

import { Extension } from '@tiptap/core';

export const AgentTask = Extension.create({
  name: 'agentTask',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'codeBlock', 'blockquote'],
        attributes: {
          agentTask: {
            default: null,
            parseHTML: element => {
              const data = element.getAttribute('data-agent-task');
              return data ? JSON.parse(data) : null;
            },
            renderHTML: attributes => {
              if (!attributes.agentTask) return {};
              return {
                'data-agent-task': JSON.stringify(attributes.agentTask),
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      attachAgentTask: (taskConfig) => ({ commands, state }) => {
        // 给当前选中的 block 附加 agent task
        // ...
      },

      removeAgentTask: () => ({ commands, state }) => {
        // 移除 agent task
        // ...
      },
    };
  },
});
```

### 4.2 左侧图标渲染

```typescript
// src/renderer/src/extensions/agent-task/AgentTaskDecoration.tsx

// 使用 Tiptap Decoration 在 block 左侧渲染图标
// 类似 heading 的 H1-H5 图标逻辑

import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const agentTaskDecorationPlugin = new Plugin({
  key: new PluginKey('agentTaskDecoration'),

  props: {
    decorations(state) {
      const decorations: Decoration[] = [];

      state.doc.descendants((node, pos) => {
        if (node.attrs.agentTask) {
          const { status } = node.attrs.agentTask;

          // 左侧图标
          decorations.push(
            Decoration.widget(pos, () => {
              const icon = document.createElement('span');
              icon.className = 'agent-task-icon';
              icon.setAttribute('data-status', status);
              icon.innerHTML = getStatusIcon(status);
              return icon;
            }, { side: -1 })
          );

          // 右侧信息
          decorations.push(
            Decoration.widget(pos + node.nodeSize, () => {
              const info = document.createElement('span');
              info.className = 'agent-task-info';
              info.innerHTML = getStatusInfo(node.attrs.agentTask);
              return info;
            }, { side: 1 })
          );
        }
      });

      return DecorationSet.create(state.doc, decorations);
    },
  },
});

function getStatusIcon(status: string): string {
  switch (status) {
    case 'idle': return '🤖';
    case 'running': return '🔄';
    case 'completed': return '✅';
    case 'failed': return '❌';
    default: return '🤖';
  }
}
```

### 4.3 弹窗组件

```typescript
// src/renderer/src/components/AgentTaskPanel/index.tsx

import React from 'react';
import { useAgentTaskExecution } from './useAgentTaskExecution';

interface AgentTaskPanelProps {
  blockId: string;
  blockContent: string;
  task?: AgentTaskRecord;
  onClose: () => void;
  onInsertResult: (content: string) => void;
}

export function AgentTaskPanel({
  blockId,
  blockContent,
  task,
  onClose,
  onInsertResult,
}: AgentTaskPanelProps) {
  const [additionalPrompt, setAdditionalPrompt] = useState(task?.input.additionalPrompt || '');
  const [agentId, setAgentId] = useState(task?.agent.agentId);

  const {
    execute,
    cancel,
    isExecuting,
    steps,
    result,
    error,
  } = useAgentTaskExecution({
    blockId,
    blockContent,
    additionalPrompt,
    agentId,
  });

  return (
    <Panel onClose={onClose}>
      <PanelHeader>
        <span>🤖 Agent 任务</span>
        {task?.agent.agentName && <AgentBadge>{task.agent.agentName}</AgentBadge>}
      </PanelHeader>

      <PanelBody>
        {/* 输入内容 */}
        <Section title="📝 输入内容">
          <ContentPreview>{blockContent}</ContentPreview>
        </Section>

        {/* 补充说明 */}
        <Section title="💬 补充说明">
          <TextArea
            value={additionalPrompt}
            onChange={setAdditionalPrompt}
            placeholder="可选：添加额外的说明或要求..."
            disabled={isExecuting}
          />
        </Section>

        {/* Agent 选择 */}
        <Section title="⚙️ Agent">
          <AgentSelector
            value={agentId}
            onChange={setAgentId}
            disabled={isExecuting}
          />
        </Section>

        {/* 执行过程 */}
        {steps.length > 0 && (
          <Section title="📊 执行过程">
            <StepsList steps={steps} />
          </Section>
        )}

        {/* 结果 */}
        {result && (
          <Section title="📝 结果">
            <ResultRenderer result={result} />
          </Section>
        )}

        {/* 错误 */}
        {error && (
          <ErrorDisplay error={error} />
        )}
      </PanelBody>

      <PanelFooter>
        {result ? (
          <>
            <Button onClick={() => onInsertResult(result.content)}>📝 插入到下方</Button>
            <Button onClick={() => copyToClipboard(result.content)}>📋 复制</Button>
            <Button onClick={execute}>🔄 重新执行</Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>取消</Button>
            <Button primary onClick={execute} disabled={isExecuting}>
              {isExecuting ? '执行中...' : '▶️ 执行'}
            </Button>
          </>
        )}
      </PanelFooter>
    </Panel>
  );
}
```

### 4.4 样式

```css
/* src/renderer/src/extensions/agent-task/styles.css */

/* 左侧图标 */
.agent-task-icon {
  position: absolute;
  left: -24px;
  opacity: 0.3;
  cursor: pointer;
  transition: opacity 0.2s;
}

/* 右侧信息 */
.agent-task-info {
  position: absolute;
  right: 0;
  opacity: 0.3;
  font-size: 12px;
  color: var(--text-muted);
  transition: opacity 0.2s;
}

/* Hover 状态 */
.ProseMirror [data-agent-task]:hover .agent-task-icon,
.ProseMirror [data-agent-task]:hover .agent-task-info {
  opacity: 1;
}

/* 状态颜色 */
.agent-task-icon[data-status="running"] {
  animation: spin 1s linear infinite;
}

.agent-task-icon[data-status="completed"] {
  color: var(--color-success);
}

.agent-task-icon[data-status="failed"] {
  color: var(--color-error);
}
```

---

## 5. 数据存储

### 5.1 存储位置

```
Note 文档中：
├─ block.attrs.agentTask: { taskId, status, ... }  // 仅关联信息
│
独立存储（IndexedDB / SQLite）：
└─ AgentTaskRecord: { id, input, execution, result, ... }  // 完整数据
```

### 5.2 存储服务

```typescript
// src/renderer/src/services/agentTaskStorage.ts

class AgentTaskStorage {
  // 创建任务记录
  async createTask(task: Omit<AgentTaskRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<string>;

  // 获取任务记录
  async getTask(taskId: string): Promise<AgentTaskRecord | null>;

  // 更新任务状态
  async updateExecution(taskId: string, execution: Partial<ExecutionState>): Promise<void>;

  // 获取 block 的任务（由于覆盖策略，每个 block 最多一条）
  async getTaskByBlock(blockId: string): Promise<AgentTaskRecord | null>;

  // 获取页面的所有任务
  async getTasksByPage(pageId: string): Promise<AgentTaskRecord[]>;

  // 删除任务
  async deleteTask(taskId: string): Promise<void>;
}
```

### 5.3 Block 删除时的清理

当 block 被删除时，需要同步删除关联的 AgentTaskRecord：

```typescript
// 监听 block 删除事件
editor.on('update', ({ transaction }) => {
  // 检查是否有带 agentTask 的 block 被删除
  // 如果有，调用 agentTaskStorage.deleteTask(taskId)
});
```

---

## 6. 待讨论问题

### 6.1 UI/UX

- [x] Agent Block 的展示方式 → **左侧图标 + 右侧信息，hover 显示**
- [x] 结果存储位置 → **分开存储，与 AI Actions 模式相同**
- [x] 点击区域 → **左侧图标和右侧信息都可点击打开弹窗**
- [x] 多次执行策略 → **覆盖上一次结果**
- [x] 移除方式 → **弹窗内提供移除按钮**
- [x] 触发方式 → **右键菜单 "AI Actions" + Block 菜单**
- [ ] 弹窗的位置和大小（侧边栏？居中弹窗？）
- [ ] 移动端适配
- [ ] 键盘导航

### 6.2 功能

- [x] Block 删除时的处理 → **立即删除关联的 AgentTaskRecord**
- [x] 是否支持原生创建 → **支持，Phase 2 通过 `/agent` 斜杠命令**
- [ ] 任务历史如何查看？
- [ ] 是否支持批量清理任务记录？
- [ ] 任务记录的过期策略？
- [ ] 是否支持从历史任务恢复/重试？

### 6.3 技术

- [ ] 离线状态的处理
- [ ] 大结果的分页/截断
- [ ] 与现有 AI Actions 代码的复用
- [ ] 任务记录的同步策略（多设备）

### 6.4 与元 Agent 的边界

- [ ] notes 是否需要知道元 agent 的存在，还是只关心最终结果？
- [ ] Agent 保存后如何在 notes 中展示和选择？

---

## 7. 实现计划

### Phase 1: 基础功能（模式 1）
- [ ] Block 属性扩展（agentTask）
- [ ] 左侧图标 + 右侧信息的 Decoration
- [ ] 触发方式：右键菜单 + Block 菜单
- [ ] 基础弹窗 UI（含移除功能）
- [ ] 与 sanqian 的通信
- [ ] 任务记录存储（IndexedDB）
- [ ] Block 删除时的清理逻辑

### Phase 2: 完善交互
- [ ] 执行过程可视化
- [ ] 流式结果显示
- [ ] 结果插入到文档
- [ ] 错误处理和重试
- [ ] 快捷键支持 (Cmd+Shift+A)

### Phase 3: 独立 Agent Block（模式 2）
- [ ] 斜杠命令 `/agent` 创建原生 Agent Block
- [ ] 非连续多选支持
- [ ] 独立 Agent Block 类型
- [ ] 引用多 blocks

### Phase 4: 高级功能
- [ ] auto 模式（接入元 agent）
- [ ] Artifact 结果类型
- [ ] 保存 agent 功能
- [ ] 任务历史管理

---

## 8. 已确认的设计决策

| 决策项 | 结论 |
|--------|------|
| 与 AI Actions 关系 | 独立功能，仅存储模式类似 |
| 触发原则 | 触发即附加（agentTask 属性立即写入） |
| 移除方式 | 弹窗内提供移除按钮 |
| 点击区域 | 左侧图标和右侧信息都可点击 |
| 多次执行 | 覆盖上一次结果 |
| Block 删除 | 立即删除关联的 AgentTaskRecord |
| 原生创建 | 支持，Phase 2 通过斜杠命令 |
| 触发方式 | 右键菜单 "AI Actions" + Block 菜单 |

---

## 9. 参考

- [Notion AI Blocks](https://www.notion.com/help/notion-ai-faqs)
- [Tana AI Command Nodes](https://tana.inc/docs/ai-command-nodes)
- [现有 AI Actions 实现](../src/renderer/src/components/AIActions/)
- [sanqian SDK 设计](./sdk-tools-redesign.md)
- [元 Agent 设计](../../sanqian/docs/meta-agent-design.md)
