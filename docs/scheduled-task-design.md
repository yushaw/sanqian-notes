# 定时任务系统设计方案

> 此功能将在 sanqian 侧单独项目实现，sanqian-notes 作为调用方集成。

## 一、整体架构

```
┌──────────────┐                        ┌──────────────┐
│ sanqian-notes│                        │   sanqian    │
│              │                        │              │
│  Agent Block │───(1) 注册任务 ───────▶│  Scheduler   │
│  配置定时    │      POST /api/...     │              │
│              │                        │  ┌────────┐  │
│              │                        │  │定时触发│  │
│              │                        │  └───┬────┘  │
│              │                        │      ▼       │
│              │                        │  ┌────────┐  │
│              │                        │  │执行Agent│  │
│              │                        │  └───┬────┘  │
│              │                        │      ▼       │
│              │◀──(2) 查询结果 ────────│  存储结果   │
│  渲染结果    │      GET /api/...      │              │
└──────────────┘                        └──────────────┘
```

- sanqian 作为独立应用常驻运行，负责调度和执行
- sanqian-notes 负责注册任务和获取结果

## 二、调度类型

| 类型 | 说明 | 示例 | 触发方 |
|------|------|------|--------|
| `cron` | 周期性执行 | 每天 08:00 | sanqian APScheduler |
| `once` | 一次性执行 | 2024-01-15 08:00 | sanqian APScheduler |
| `relative` | 相对时间 | 创建后 5 分钟 | notes setTimeout → 调用 execute API |

**relative 类型说明**：
- sanqian 不感知 "打开日记" 事件
- 由 notes 侧监听事件，到时间后调用 `/execute` API
- sanqian 只存储配置，不负责触发

## 三、数据模型

### 3.1 扩展 ScheduledTask 表

```sql
-- 调度类型扩展
ALTER TABLE scheduled_tasks ADD COLUMN schedule_type VARCHAR(20) DEFAULT 'cron';
ALTER TABLE scheduled_tasks ADD COLUMN run_at DATETIME;           -- once 类型用
ALTER TABLE scheduled_tasks ADD COLUMN relative_minutes INTEGER;  -- relative 类型用
ALTER TABLE scheduled_tasks ADD COLUMN relative_anchor VARCHAR(20); -- 'created' | 'note_opened'

-- 来源标识（给 notes 用）
ALTER TABLE scheduled_tasks ADD COLUMN source_app VARCHAR(50);
ALTER TABLE scheduled_tasks ADD COLUMN source_note_id VARCHAR(50);
ALTER TABLE scheduled_tasks ADD COLUMN source_block_id VARCHAR(50);

-- 执行结果
ALTER TABLE scheduled_tasks ADD COLUMN last_result TEXT;
ALTER TABLE scheduled_tasks ADD COLUMN last_error TEXT;

-- 索引
CREATE INDEX idx_scheduled_tasks_source ON scheduled_tasks(source_app, source_block_id);
```

### 3.2 执行历史表（可选）

```sql
CREATE TABLE scheduled_task_runs (
    id VARCHAR PRIMARY KEY,
    task_id VARCHAR NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL,  -- 'pending' | 'running' | 'completed' | 'failed'
    result TEXT,
    error TEXT,
    started_at DATETIME,
    completed_at DATETIME,
    duration_ms INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## 四、API 接口设计

### 4.1 现有接口（保持不变）

```
GET    /api/scheduled-tasks           # 列表
POST   /api/scheduled-tasks           # 创建
GET    /api/scheduled-tasks/{id}      # 获取
PUT    /api/scheduled-tasks/{id}      # 更新
DELETE /api/scheduled-tasks/{id}      # 删除
POST   /api/scheduled-tasks/{id}/enable
POST   /api/scheduled-tasks/{id}/disable
```

### 4.2 新增接口

```
# 按来源查询（notes 用）
GET /api/scheduled-tasks/by-source
    ?source_app=sanqian-notes
    &source_block_id=xxx

# 手动/立即执行（relative 类型用）
POST /api/scheduled-tasks/{id}/execute
    Response: { run_id, status }

# 查询执行结果
GET /api/scheduled-tasks/{id}/result
    Response: { last_result, last_error, last_run_at }

# 查询执行历史
GET /api/scheduled-tasks/{id}/runs
    Response: [{ id, status, result, started_at, completed_at }]
```

### 4.3 创建接口请求体

```typescript
interface CreateScheduledTaskRequest {
  name: string

  // 调度配置（三选一）
  schedule_type: 'cron' | 'once' | 'relative'
  cron_expression?: string      // cron 类型必填
  run_at?: string               // once 类型必填，ISO 时间
  relative_minutes?: number     // relative 类型必填
  relative_anchor?: string      // relative 类型可选，默认 'created'

  // 执行配置
  input: {
    agent_id: string
    prompt: string
    output_format?: string
  }

  // 来源标识
  source_app?: string           // 'sanqian-notes'
  source_note_id?: string
  source_block_id?: string

  timezone?: string             // 默认 'Asia/Shanghai'
}
```

## 五、执行流程

### 5.1 cron/once 类型

```
APScheduler 触发
    ↓
ScheduledTaskExecutor._execute_task(task_id)
    ↓
1. 从数据库获取任务配置
2. 创建 Run 记录 (status=running)
3. 调用 GraphExecutor 执行 Agent
4. 更新 Run 记录 (status=completed/failed, result/error)
5. 更新 Task 的 last_run_at, last_result, last_error
6. （可选）通过 EventBus 发布事件
```

### 5.2 relative 类型

```
notes 侧：
1. Agent Block 创建/日记打开时
2. setTimeout(relative_minutes * 60 * 1000)
3. 到时间后调用 POST /api/scheduled-tasks/{id}/execute

sanqian 侧：
1. 收到 /execute 请求
2. 同步执行（或创建后台任务）
3. 返回 run_id
4. notes 轮询结果或等待响应
```

## 六、sanqian-notes 侧集成

### 6.1 Agent Block 配置扩展

```typescript
interface AgentBlockAttrs {
  // 现有字段...

  // 定时配置
  scheduleType: 'manual' | 'cron' | 'once' | 'relative'
  cronExpression?: string       // "0 8 * * *"
  scheduledAt?: string          // ISO 时间
  relativeMinutes?: number      // 5
  relativeAnchor?: 'created' | 'note_opened'

  // 关联的 sanqian 任务
  scheduledTaskId?: string
}
```

### 6.2 同步任务到 sanqian

```typescript
async function syncScheduledTask(block: AgentBlockAttrs, noteId: string) {
  if (block.scheduleType === 'manual') {
    if (block.scheduledTaskId) {
      await sanqianAPI.deleteScheduledTask(block.scheduledTaskId)
    }
    return
  }

  const payload = {
    name: `Agent Block: ${block.agentName}`,
    schedule_type: block.scheduleType,
    cron_expression: block.cronExpression,
    run_at: block.scheduledAt,
    relative_minutes: block.relativeMinutes,
    input: {
      agent_id: block.agentId,
      prompt: block.additionalPrompt,
      output_format: block.outputFormat,
    },
    source_app: 'sanqian-notes',
    source_note_id: noteId,
    source_block_id: block.blockId,
  }

  if (block.scheduledTaskId) {
    await sanqianAPI.updateScheduledTask(block.scheduledTaskId, payload)
  } else {
    const task = await sanqianAPI.createScheduledTask(payload)
    updateAttributes({ scheduledTaskId: task.id })
  }
}
```

### 6.3 relative 类型触发

```typescript
function onNoteOpened(noteId: string) {
  const tasks = await sanqianAPI.getTasksBySource({
    source_app: 'sanqian-notes',
    source_note_id: noteId,
  })

  for (const task of tasks) {
    if (task.schedule_type === 'relative' && task.relative_anchor === 'note_opened') {
      setTimeout(() => {
        sanqianAPI.executeTask(task.id)
      }, task.relative_minutes * 60 * 1000)
    }
  }
}
```

### 6.4 获取执行结果

```typescript
async function syncTaskResults(noteId: string) {
  const tasks = await sanqianAPI.getTasksBySource({
    source_app: 'sanqian-notes',
    source_note_id: noteId,
  })

  for (const task of tasks) {
    if (task.last_result) {
      updateAgentBlockResult(task.source_block_id, task.last_result)
    }
  }
}
```

## 七、边界情况处理

| 场景 | 处理方式 |
|------|----------|
| Agent Block 被删除 | notes 调用 DELETE /api/scheduled-tasks/{id} |
| 笔记被删除 | notes 批量删除该笔记的所有任务 |
| sanqian 未运行 | notes 显示"调度服务未连接" |
| 执行失败 | 记录 error，notes 显示失败状态，支持重试 |
| 错过的 cron 任务 | APScheduler misfire 策略，默认跳过 |
| relative 任务笔记关闭 | setTimeout 被清理，下次打开重新计时 |

## 八、待定问题

1. **执行结果格式**：直接存 Agent 输出的原始文本？还是结构化 JSON？
2. **结果渲染**：拿到结果后直接插入编辑器，还是让用户确认后插入？
3. **执行历史**：保留每次执行历史还是只保留最近一次？
4. **并发控制**：同一任务正在执行时又触发，跳过还是排队？

## 九、实现计划

### sanqian 侧

1. 数据库迁移（扩展 ScheduledTask 表）
2. 实现 ScheduledTaskExecutor（APScheduler 集成）
3. 在 lifespan 中启动调度器
4. 新增 API 端点

### sanqian-notes 侧

1. Agent Block UI 添加定时配置
2. 调用 sanqian API 同步任务
3. 实现 relative 类型的 setTimeout 触发
4. 获取并渲染执行结果
