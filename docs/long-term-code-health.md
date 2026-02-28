# Long-term Code Health Checklist

> Created: 2026-02-27
> Purpose: 基于全量未提交代码 review 整理的长期健康问题清单，逐项核实并解决。
> Status legend: [ ] 待核实 | [x] 已核实属实 | [~] 已核实不属实/可忽略 | [!] 已修复

---

## P0 -- 架构性问题

这些问题如果不解决，会随着功能迭代持续恶化，修复成本随时间指数上升。

### 0.1 God File 拆分

当前多个核心文件远超可维护极限，每次改动需要理解数千行上下文，新功能叠加只会更差。

- [!] **App.tsx**: 5,819 -> **1,115 行** (大量逻辑提取到独立 hooks: useNoteNavigation, useNoteCRUD, useEditorUpdateQueue, useLocalFolderState, useNotebookManagement 等)。当前行数合理。(2026-02-27)
  - 残余: 18 个 useState、24 个 hooks 调用集中在单函数体。可考虑 Zustand 但非必要 -- 当前 hooks 拆分已消除大部分状态管理复杂度，引入 Zustand 的收益不明显。
  - [!] useLocalFolderState.ts (2,268 行): 提取 useLocalFolderSearch hook (112 行)，封装本地文件夹搜索逻辑。useLocalFolderState 减至 2,206 行。内部 ConflictResolution/AutoDraft 域与 11+ 共享 ref 紧耦合，提取收益不大。(2026-02-28)
  - 文件: `src/renderer/src/App.tsx`, `src/renderer/src/hooks/useLocalFolderSearch.ts`

- [!] **database.ts (5,595 行)**: 已拆分为 `src/main/database/` 目录 19 个模块文件，barrel re-export 保持外部零改动。(2026-02-27)
  - 文件: `src/main/database/` (原 `src/main/database.ts`)

- [!] **index.ts**: 4,541 -> **1,260 行**。Phase 1 提取 6 组业务逻辑模块 (`note-synthesis.ts`, `user-context.ts`, `local-folder-tree-cache.ts`, `local-notebook-index/`, `local-folder-watcher/`, `app/`)；Phase 2 提取 11 个 IPC handler 模块到 `ipc/` (共 2,363 行)。残余 1,260 行为纯 app lifecycle 编排。(2026-02-27)
  - 文件: `src/main/index.ts`, `src/main/ipc/`, `src/main/note-synthesis.ts` 等

- [!] **sanqian-sdk.ts**: 3,612 -> **sanqian-sdk/** 目录 12 文件 (3,882 行总计)。`state.ts` 打破循环依赖，`helpers/` 子目录按职责拆分 7 个文件。(2026-02-27)
  - [!] `tools.ts` (1,496 行) 进一步拆分为 `tools/` 目录 4 文件: web.ts (55), read.ts (438), mutations.ts (1,039), index.ts (59)。原 tools.ts 改为 8 行 barrel re-export。(2026-02-28)
  - 文件: `src/main/sanqian-sdk/`, `src/main/sanqian-sdk/tools/`

- [!] **Editor.tsx**: 2,926 -> **1,806 行**。提取 `editor/` 目录 6 个模块 (EditorToolbar, editor-doc-utils, 4 个 popup/panel hook)。(2026-02-27)
  - 文件: `src/renderer/src/components/Editor.tsx`, `src/renderer/src/components/editor/`

- [!] **local-folder.ts (1,899 行)**: 已拆分为 `src/main/local-folder/` 目录 7 文件 (errors, path, cache, scan, search, io, index)。(2026-02-27)
  - 文件: `src/main/local-folder/`

#### 0.1.1 当前 >1000 行文件清单 (拆分后残余 + 新增)

按行数降序，标注是否需要处理:

| 文件 | 行数 | 判定 |
|------|------|------|
| i18n/translations.ts | 3,005 | 数据文件 (i18n 字典)，不需拆分 |
| Editor.tsx | 1,654 | 提取 clipboard-serializer, editor-file-insert (2026-02-28) |
| Sidebar.tsx | 1,525 | 偏大，folder tree 渲染重复 (P2.2 已记录) |
| sanqian-sdk/tools.ts | 8 | 已拆分为 tools/ 目录 4 文件 (2026-02-28) |
| embedding/database.ts | 42 | 已拆分为 database-core.ts + database-ops.ts (2026-02-28) |
| note-exporter.ts | 1,390 | 偏大，导出 + transclusion 解析混合 |
| index.ts (main) | 1,271 | 可接受，纯 lifecycle 编排 |
| TypewriterMode.tsx | 1,148 | 提取 clipboard-serializer, editor-file-insert, editor-doc-utils (2026-02-28) |
| App.tsx | 1,115 | 已大幅拆分，见上 |
| database/demo-notes.ts | 1,112 | 数据文件 (demo 内容)，不需拆分 |
| ExportMenu.tsx | 1,107 | 偏大，多个导入 dialog 混在一个组件 |
| semantic-search.ts | 1,031 | 可接受，搜索管道较复杂 |
| EditorContextMenu.tsx | 1,017 | 偏大，可提取 AI action submenu |
| arxiv-parser.ts | 1,007 | 可接受，单一职责 HTML->Tiptap 转换 |
| markdown-to-tiptap.ts | 1,002 | 可接受，格式转换逻辑密集 |

### 0.2 主进程同步 I/O 阻塞 UI

Electron 主进程执行同步文件系统操作会冻结整个应用 UI。

- [!] **`note:getAll` IPC handler**: 已改为 async `getAllNotesForRendererAsync` + `scanAndCacheLocalFolderTreeAsync`。(2026-02-27)
  - 文件: `src/main/index.ts`

- [!] **`localFolder:getTree` IPC handler**: 已改为 async `scanAndCacheLocalFolderTreeAsync`。(2026-02-27)
  - 文件: `src/main/index.ts`

- [!] **`localFolder:saveFile` IPC handler**: 所有 7 个 local-folder IPC 文件操作 handler 改为 async，使用 `fs/promises`。io.ts 新增 7 个 async 函数 (readLocalFolderFileAsync, saveLocalFolderFileAsync, createLocalFolderFileAsync, createLocalFolderAsync, renameLocalFolderEntryAsync, resolveLocalFolderDeleteTargetAsync, resolveLocalFolderFilePathAsync) + atomicWriteUtf8FileAsync。path.ts 新增 resolveExistingDirectoryAsync。sync 版本保留供非 IPC 调用方使用。(2026-02-28)
  - 文件: `src/main/local-folder/io.ts`, `src/main/local-folder/path.ts`, `src/main/ipc/register-local-folder-ipc.ts`

- [!] **`canonicalizeLocalFolderPath`**: 已改为 async `canonicalizeLocalFolderPathAsync`。(2026-02-27)
  - 文件: `src/main/ipc/register-local-folder-ipc.ts`

### 0.3 内存泄漏

- [!] **`localSaveTimerRef` 未清理**: unmount cleanup effect 中添加了 clearTimeout + null 赋值。(2026-02-27)
  - 文件: `src/renderer/src/App.tsx`

---

## P1 -- 数据安全与正确性

这些问题可能导致数据丢失、数据不一致、或在特定条件下引发 bug。

### 1.1 SQL 与数据库安全

- [!] **SQL 字符串插值**: 拆分 db.exec 为 db.exec(CREATE TABLE) + db.prepare(INSERT...SELECT).run(now, now) + db.exec(DROP+RENAME)，消除字符串插值。(2026-02-27)
  - 文件: `src/main/database.ts`

- [!] **Frontmatter migration 全量加载**: 改为 BATCH_SIZE=200 的 LIMIT/OFFSET 分批 + ORDER BY id，避免大量笔记时 OOM。(2026-02-27)
  - 文件: `src/main/database.ts`

- [!] **AI popup refs 重建非事务性**: 将整个 rebuild (DELETE + 所有 batch INSERT) 包裹在单个 db.transaction 中，同时添加 ORDER BY id 确保分页一致性。(2026-02-27)
  - 文件: `src/main/database.ts`

- [!] **LIKE 模式未转义**: 添加 `escapeLikePrefix()` 工具函数和 `LIKE_ESCAPE` SQL 片段常量，修复 5 个函数 12 处使用。(2026-02-27)
  - 文件: `src/main/database.ts`

- [!] **`deleteNotebookFolderEntry` IN 子句无上限**: 添加 CHUNK_SIZE=500 分批 UPDATE，避免超出 SQLite 参数限制。(2026-02-27)
  - 文件: `src/main/database.ts`

- [!] **`rebuildAIPopupRefsForInternalNotes` 分页无 ORDER BY**: 已在 P1.1-c 修复中一并添加 ORDER BY id。(2026-02-27)
  - 文件: `src/main/database.ts`

### 1.2 竞态条件与并发安全

- [!] **`syncPrivateAgents` 竞态**: 1) 错误现在正确抛出而非静默吞掉; 2) 第二个调用者 await 后检查 agentId 是否已填充，失败则重试; 3) syncingPromise 在 finally 中清空; 4) 同时改用 agentMap.get() 替代 hardcoded 数组索引。(2026-02-27)
  - 文件: `src/main/sanqian-sdk.ts`

- [!] **`addNote`/`updateNote` popup ref 替换非原子**: addNote、updateNote、updateNoteSafe 的 INSERT/UPDATE + replaceAIPopupRefsForNote 包裹在 db.transaction() 中，保证原子性。(2026-02-27)
  - 文件: `src/main/database.ts`

### 1.3 静默数据丢失

- [!] **`move_note` metadata 迁移静默失败**: renameEntry 响应中添加 `metadataWarning` 字段，类型定义同步更新。move_note handler 中的 warn 继续保留。(2026-02-27)
  - 文件: `src/main/index.ts`, `src/shared/types.ts`

- [!] **`pendingLegacyAIPopupCloseSpan` 状态泄漏**: 添加 pendingCloseSpanTokenCount 安全计数器，超过 5 个 token 未找到 `</span>` 则自动重置 flag，防止无限吞 text。(2026-02-27)
  - 文件: `src/shared/markdown/inline-parser.ts`

- [!] **`collectLocalNotesForGetAll` 静默吞掉扫描错误**: catch 块中添加了 console.warn 输出 mount notebook_id 和 root_path 便于诊断。(2026-02-27)
  - 文件: `src/main/index.ts`

### 1.4 类型名/节点名迁移兼容性

- [!] **`tableOfContents` -> `tocBlock` 重命名**: 在 tiptap-to-markdown.ts 添加 `case 'tableOfContents':` fall-through 到 `case 'tocBlock'`，兼容旧文档。(2026-02-27)
  - 文件: `src/main/markdown/tiptap-to-markdown.ts`

---

## P2 -- 代码质量与可维护性

这些问题不会直接导致 bug，但会增加理解成本、引入 copy-paste 错误、阻碍后续开发。

### 2.1 错误处理不一致

- [!] **4 种错误返回模式**: 定义统一 `Result<T, E>` 类型在 shared/types.ts。已迁移 notebook folder 操作 (createNotebookFolderEntry, renameNotebookFolderEntry, deleteNotebookFolderEntry) 和 moveNote 使用 Result 类型，字段名从 `reason` 统一为 `error`。IPC 层保持现有 `{ success, errorCode }` 模式。(2026-02-28)
  - `updateNoteSafe`: 保留 3-way `{ status: 'updated' | 'conflict' | 'failed' }` 模式 (CAS 操作的 conflict 是可恢复重试信号，不是 error，二元 Result 无法表达)。`reason` 字段已重命名为 `error` 对齐命名。
  - `resolveNoteNotebookAssignment`: 已使用 `{ ok, error }` 模式，无需修改。
  - 修复 moveNote 测试隐藏 bug: toEqual 断言中 `reason` -> `error` (better-sqlite3 skip 掩盖)。
  - 剩余: 其他 database 函数的 null 返回 (getNoteById 等，影响面大且 null 语义明确，暂不迁移)。
  - 文件: `src/shared/types.ts`, `src/main/database/notebooks.ts`, `src/main/database/note-helpers.ts`, `src/main/database/notes.ts`

- [!] **错误双重包装**: 添加 `ToolError` 类。tools.ts 中 40+ 处 user-facing throw 改为 `throw new ToolError(...)`，8 个外层 catch 添加 `instanceof ToolError` 透传，防止 "Failed to update note: Note not found" 双重前缀。(2026-02-28)
  - 文件: `src/main/sanqian-sdk/helpers/error-mapping.ts`, `src/main/sanqian-sdk/tools.ts`

- [!] **`createNotebookFolderEntry` 静默吞错**: catch 块添加 console.warn 输出 notebook_id 和 folder_path 便于诊断。(2026-02-27)
  - 文件: `src/main/database.ts`

### 2.2 代码重复

- [!] **`reconnectHeldRef` 模式重复 3 处**: 提取 `useReconnectHold()` 共享 hook (acquire/release/auto-cleanup)，替换 useBlockAIGenerate、useAIWriting、AIExplainPopup 三处内联实现。(2026-02-28)
  - 文件: `src/renderer/src/hooks/useReconnectHold.ts` (新), `useBlockAIGenerate.ts`, `useAIWriting.ts`, `AIExplainPopup.tsx`

- [~] **`mapLocalToolErrorCode` 重复 13 次**: 核实发现函数定义 1 次 (error-mapping.ts:49)，13 处调用各传不同 context-specific i18n 消息对象 (notFound/conflict/invalidName 等)。这是正确的参数化使用模式，不是代码重复。(核实: 2026-02-28)
  - 文件: `src/main/sanqian-sdk/tools.ts`, `src/main/sanqian-sdk/helpers/error-mapping.ts`

- [!] **`buildLocalEtag` 对象构造重复 5 次**: 提取 `buildLocalEtagFromFile(file)` helper，4 处调用点替换为一行调用。(2026-02-27)
  - 文件: `src/main/sanqian-sdk.ts`

- [!] **3 层 noteId 解析逻辑重复**: 核实发现已修复 -- note-gateway.ts 导出 `resolveLocalNoteRef()`，indexing-service.ts (line 55) 和 semantic-search.ts (line 881) 均已改为调用该共享函数。(核实: 2026-02-28)
  - 文件: `src/main/note-gateway.ts`, `src/main/embedding/indexing-service.ts`, `src/main/embedding/semantic-search.ts`

- [!] **Sidebar folder tree 渲染重复**: renderLocalFolderTree 与 renderInternalFolderTree 提取为共享 FolderTreeItem memo 组件，id-based callbacks。
  - 文件: `src/renderer/src/components/Sidebar.tsx`

### 2.3 冗余/死代码

- [!] **冗余变量 (copy-paste 遗留)**: 删除 `localIndexId` 改用 `localId`; `nextCanonicalLocalIndexId` 改为 `= nextLocalId` 直接赋值。(2026-02-27)
  - 文件: `src/main/sanqian-sdk.ts`

- [!] **`canTriggerSummary()` 死 stub**: 删除函数定义及 4 处调用，直接内联逻辑。(2026-02-27)
  - 文件: `src/main/embedding/indexing-service.ts`

### 2.4 命名与规范

- [!] **日志前缀不统一**: 统一为 `[SanqianSDK]` 前缀。(2026-02-27)
  - 文件: `src/main/sanqian-sdk.ts`

- [!] **`t` 变量遮蔽 i18n 函数**: `tags?.map((t) => t.name)` 改为 `tags?.map((tag) => tag.name)`。(2026-02-27)
  - 文件: `src/main/sanqian-sdk.ts`

- [!] **`syncPrivateAgents` hardcoded 数组索引**: 已在 P1.2-a 修复中一并改用 `agentMap.get('assistant')` 等按名查找，fallback 到索引。(2026-02-27)
  - 文件: `src/main/sanqian-sdk.ts`

### 2.5 循环依赖与模块耦合

- [~] **`require('./index')` 动态引入**: sanqian-sdk 重构为目录后已消除，不再存在循环依赖。(核实: 2026-02-28)
  - 文件: `src/main/sanqian-sdk/` (原 `src/main/sanqian-sdk.ts`)

### 2.6 渲染性能

- [!] **NoteListItem memo 被内联闭包击溃**: NoteListItem 已包裹 React.memo 但 NoteList 在 .map() 中传入内联箭头函数 (onClick, onContextMenu, onDragStart 等)，导致每次父组件渲染所有 item 都重新渲染。改为 id-based callback 接口: NoteListItem 接受 (noteId, event) 签名，内部 useCallback 绑定; NoteList 端所有 6 个 handler 改为 useCallback(fn, []) + ref 读取可变状态，保证 referential stability。(2026-02-28)
  - 文件: `src/renderer/src/components/NoteListItem.tsx`, `src/renderer/src/components/NoteList.tsx`

- [!] **LocalFolderNoteList file items 无 memo**: 已修复，`LocalFolderFileItem` 已提取为 `memo()` 包裹的独立组件。(核实: 2026-02-28)
  - 文件: `src/renderer/src/components/LocalFolderNoteList.tsx`

- [!] **Sidebar folder tree 节点无 memo**: FolderTreeItem 已 memo 化，同上。
  - 文件: `src/renderer/src/components/Sidebar.tsx`

- [!] **Sidebar notebook 列表项无 memo**: 150+ 行 IIFE 内联渲染，8 个 inline closure，每次 Sidebar 状态变化所有 notebook 项全量重渲染。提取 NotebookRow memo 组件 + id-based callback，drag 回调使用 ref 保持稳定。(2026-02-28)
  - 文件: `src/renderer/src/components/Sidebar.tsx`

- [!] **TabBar SortableTabItem 无 memo**: 4 个 inline closure (onSelect/onClose/onContextMenu/onMiddleClick) 导致拖拽排序时所有 tab 重渲染。包裹 memo + 改为 id-based callback 接口，parent 直接传 stable context 引用。(2026-02-28)
  - 文件: `src/renderer/src/components/TabBar.tsx`

---

## P3 -- 搜索/索引准确性

### 3.1 搜索行为

- [!] **semantic search "recent" 过滤器对 local notes 用 `indexedAt` 而非文件 mtime**: `note_index_status` 表新增 `file_mtime` TEXT 列，索引时从文件读取结果中获取 `mtime_ms` 并转为 ISO string 存入。搜索过滤使用 `status.fileMtime || status.indexedAt` fallback。`buildEmbeddingForNote` 和 error 分支从 existingStatus 继承 fileMtime。(2026-02-28)
  - 文件: `src/main/embedding/types.ts`, `src/main/embedding/database.ts`, `src/main/embedding/indexing-service.ts`, `src/main/embedding/semantic-search.ts`, `src/main/local-notebook-index/sync.ts`, `src/main/ipc/register-local-folder-ipc.ts`

- [!] **`replaceAIPopupRefsForNote` 每次保存都执行**: `collectAIPopupRefsFromContent` 添加快速 `includes('aiPopupMark')` 字符串检查，避免不必要的 JSON.parse + 树遍历。(2026-02-27)
  - 文件: `src/main/database.ts`

- [!] **`collectIndexedLocalNoteIdsByNotebook` O(N * DB_QUERY)**: 添加 `getLocalNoteIdentityUidsByNotebook` 批量查询函数，一次性获取所有 UID 后用 Set.has() 过滤，从 O(N*DB) 降为 O(N)+O(1)。(2026-02-27)
  - 文件: `src/main/index.ts`, `src/main/database.ts`

### 3.2 arXiv 导入

- [!] **`normalizeSectionContent` 代码检测误报率高**: 移除 `/i` flag。Python/Shell 关键字始终为小写，英文句首为大写，case-sensitive 即可区分。
  - 文件: `src/main/import-export/arxiv/arxiv-importer.ts`

- [!] **`parseArxivInput` 可能拒绝带尾部标注的 ID**: 添加 `stripTrailingAnnotation` 函数，正则不匹配时自动去除尾部 `[...]` 或 `(...)` 标注后重试。(2026-02-27)
  - 文件: `src/main/import-export/arxiv/arxiv-fetcher.ts`

---

## P4 -- 健壮性与边界情况

### 4.1 跨平台兼容性

- [!] **Unicode NFC/NFD 未处理**: `normalizeRelativeSlashPath()` 已添加 `toNFC()` 调用 (P8.3)。`normalizeComparablePath()` 和 `normalizeComparablePathForFileSystem()` 已有 `toNFC()`。所有路径比较函数现在统一使用 NFC。(2026-02-28)
  - 文件: `src/main/path-compat.ts`

- [!] **`CASE_SENSITIVITY_CACHE` 无上限**: 添加 CASE_SENSITIVITY_CACHE_MAX_SIZE=256，超限时 clear()。(2026-02-27)
  - 文件: `src/main/path-compat.ts`

### 4.2 缓存管理

- [!] **`localFolderScanCache` 和 `localOverviewSummaryCache` 无大小限制**: 添加 MAX_ENTRIES=64 常量和插入前淘汰最旧条目逻辑。(2026-02-27)
  - 文件: `src/main/sanqian-sdk.ts`

- [!] **`local-folder.ts` 三个模块级 Map 缓存无生命周期清理**: 导出 `clearLocalFolderCaches()` 函数作为清理入口。(2026-02-27)
  - 文件: `src/main/local-folder.ts`

- [~] **`localNotebookIndexSyncSequence` promise 链无限增长**: 核实发现 line 1285 有 `Promise.resolve()` 重置，且 JS GC 会回收已 resolved 的 promise 链。实际无内存泄漏风险。
  - 文件: `src/main/index.ts`

### 4.3 导出

- [!] **`collectDataviewAllSourceNotes` 同步扫描所有 local folder mount**: 新增 `collectDataviewAllSourceNotesAsync()` 使用 `scanLocalFolderMountAsync`。`exportNoteAsPDF` 在调用 `tiptapToHTML` 前异步预填充 `renderContext.dataviewAllSourceNotes`，同步渲染管道不再触发同步文件扫描。同步版本保留作为 fallback。(2026-02-28)
  - 文件: `src/main/export/note-exporter.ts`

- [!] **导出中嵌入/引用笔记无内容缓存**: 添加模块级 `exportNoteCache` (Map<noteId, result>)，`resolveExportNote()` 缓存解析结果，每次导出 (Markdown/PDF) 入口清空、finally 清空。避免同一笔记重复解析。(2026-02-28)
  - 文件: `src/main/export/note-exporter.ts`

- [~] **Frontmatter round-trip 转换为 code block**: 核实发现 leading frontmatter 在 line 115 正确输出为 `---` fences。`yaml-frontmatter` code block 仅用于文档中间的 frontmatter 节点，是设计意图而非 bug。
  - 文件: `src/main/markdown/tiptap-to-markdown.ts`

### 4.4 其他边界情况

- [!] **`getDefaultLocalCreateName` / `getDefaultInternalFolderName` 无 while 循环上限**: while(true) 改为 for 循环 index <= 10000，超限 fallback 到 `${baseName} ${Date.now()}`。(2026-02-27)
  - 文件: `src/renderer/src/App.tsx`

- [!] **`createFallbackDirectoryTreeWatcher` 缺少 `ref()`/`unref()` stub**: 添加 `compositeWatcher.ref = () => compositeWatcher` 和 `.unref` stub。(2026-02-27)
  - 文件: `src/main/local-folder-watch.ts`

- [!] **`Promise.resolve` 包装同步函数**: 移除两处 Promise.resolve() 包装，直接传入同步函数返回值。(2026-02-27)
  - 文件: `src/main/sanqian-sdk.ts`

---

## P5 -- 可访问性 (Accessibility)

### 5.1 Dialog / Modal

- [!] **共享 Dialog 组件 + ARIA 迁移**: 创建 `Dialog.tsx` 共享组件（role="dialog", aria-modal, aria-label, Escape 关闭, focus trapping）。已迁移 4 处简单 dialog: NotebookDeleteDialog, InternalFolderDialogs(3个), LocalFolderDialogs(3个), App.tsx localSaveConflictDialog。剩余的 NotebookModal / Settings / Import-Export dialogs 因布局差异较大（自定义 Escape 逻辑 / 滚动容器 / z-1100）暂不迁移。(2026-02-28)
  - 文件: `src/renderer/src/components/Dialog.tsx` (新建)
  - 已迁移: `NotebookDeleteDialog.tsx`, `InternalFolderDialogs.tsx`, `LocalFolderDialogs.tsx`, `App.tsx`

- [!] **`ImageLightbox` 缺少 ARIA**: 添加 `role="dialog" aria-modal="true" aria-label="Image preview"` 到 lightbox overlay。Focus trapping 留作后续共享 Dialog 组件一并处理。(2026-02-28)
  - 文件: `src/renderer/src/components/ImageLightbox.tsx`

### 5.2 Sidebar

- [!] **Folder tree 缺少 ARIA tree 角色**: FolderTreeItem 添加 role="treeitem" + aria-expanded + aria-selected，子容器 role="group"，树容器 role="tree" aria-label。(2026-02-28)
  - 文件: `src/renderer/src/components/Sidebar.tsx`

- [x] **Notebook 拖拽排序无键盘替代方案**: HTML5 Drag and Drop API 仅支持鼠标操作，纯键盘用户无法重排笔记本。需引入 dnd-kit 或自定义键盘快捷键（如 Alt+上/下箭头），改动范围较大。延后处理。
  - 文件: `src/renderer/src/components/Sidebar.tsx`

### 5.3 其他

- [!] **搜索输入框缺少 `aria-label`**: 添加 `aria-label={t.noteList.searchPlaceholder}`。(2026-02-28)
  - 文件: `src/renderer/src/components/NoteList.tsx`

- [!] **arXiv 验证消息缺少 `aria-live`**: 添加 `aria-live="polite"` 到验证消息容器。(2026-02-28)
  - 文件: `src/renderer/src/components/ExportMenu.tsx`

---

## P6 -- Error Boundary 与容错

- [!] **部分 Error Boundary**: AppContent 顶层和 Sidebar 各包裹 `<ErrorBoundary>`，防止渲染异常白屏。(2026-02-27)
  - 文件: `src/renderer/src/App.tsx`

---

## P7 -- Preload / IPC 类型安全

- [!] **preload 方法返回 `Promise<unknown>`**: 全部替换为具体类型 (Note, Notebook, AIAction, Template, AgentTaskRecord 等)。preload/index.d.ts 现在是 Window.electron 的单一类型来源。(2026-02-27)
  - 文件: `src/preload/index.d.ts`

- [~] **IPC 输入验证缺失**: 核实发现 readFile/saveFile handler 通过调用 readLocalFolderFile/saveLocalFolderFile 进行路径规范化和验证。虽非在 IPC 边界显式检查，但实际有校验。
  - 文件: `src/main/index.ts`

- [!] **`env.d.ts` 三重声明模式**: env.d.ts 删除 ~530 行重复 Window.electron 声明，改用 `/// <reference path>` 引用 preload/index.d.ts。AgentCapability、AgentTaskEvent 移入 shared/types.ts。env.d.ts 仅保留 Vite 引用和 ambient type alias。(2026-02-27)
  - 文件: `src/preload/index.d.ts`, `src/renderer/src/env.d.ts`, `src/shared/types.ts`

---

## P8 -- 安全与依赖 (2026-02-28 增量审查新增)

### 8.1 Electron 安全配置

- [!] **主窗口 WebContentsView 缺少 contextIsolation/nodeIntegration**: 导出窗口已正确设置，但主窗口 WebContentsView 仅有 `sandbox: false`。已添加 `contextIsolation: true, nodeIntegration: false`。(2026-02-28)
  - 文件: `src/main/index.ts`

- [!] **Attachment 协议 symlink 绕过**: `getFullPath()` 仅做字符串级别检查 (`.includes('..')`, `startsWith('/')`)，未调用 `realpathSync()` 解析符号链接。攻击者可通过 symlink 指向 userData 外的敏感目录。已添加 `realpathSync` 校验，文件存在时解析真实路径并验证仍在 userData 下。(2026-02-28)
  - 文件: `src/main/attachment.ts`

### 8.2 进程生命周期

- [!] **will-quit 中 SDK 清理未 await**: `stopSanqianSDK()` 返回 Promise 但在 `will-quit` 中 fire-and-forget，进程可能在 SDK 清理完成前退出。已迁移到 `before-quit` 中用 `preventDefault()` + 2s 超时等待，确保 SDK 资源正确释放。(2026-02-28)
  - 文件: `src/main/index.ts`

### 8.3 路径 Unicode 规范化

- [!] **`normalizeRelativeSlashPath` 缺少 NFC 规范化**: `toNFC()` 已存在但未被 `normalizeRelativeSlashPath()` 调用。该函数被 11 个文件使用，macOS 上 NFD 路径可能导致比较不一致。已添加 `toNFC()` 调用。(2026-02-28)
  - 文件: `src/main/path-compat.ts`

### 8.4 npm 依赖漏洞

- [!] **npm audit 24 个漏洞 (12 moderate + 12 high)**: `npm audit fix` 修复 15 个 (12 moderate + 3 high)。(2026-02-28)
  - 残余: 9 个 high 全在 `electron-builder` 25.x 依赖链 (tar, node-gyp, cacache 等)，需升级到 `electron-builder` 26.8.1 (semver major)，影响打包流程，需单独测试。
  - 文件: `package.json`, `package-lock.json`

### 8.5 待处理项 (已核实属实，暂不修复)

- [!] **KaTeX 未懒加载**: MathView.tsx 改为动态 `import('katex')` + CSS 按需注入，移除 Editor.tsx/TypewriterMode.tsx 静态 CSS import (~293KB 延迟到首次渲染数学公式时)。(2026-02-28)
  - 文件: `src/renderer/src/components/MathView.tsx`, `Editor.tsx`, `TypewriterMode.tsx`

- [!] **Error 双重包装**: 见 P2.1 更新。ToolError 类已添加，40+ 处 user-facing throw 已迁移。(2026-02-28)
  - 文件: `src/main/sanqian-sdk/helpers/error-mapping.ts`, `src/main/sanqian-sdk/tools.ts`

---

## P9 -- Round 3 审查 (2026-02-28)

### 9.1 安全

- [!] **`setWindowOpenHandler` 绕过协议白名单**: IPC 路径 `shell:openExternal` 有 http/https/mailto 白名单 (`register-app-ipc.ts:121-136`)，但 `setWindowOpenHandler` (`index.ts:622-624`) 直接调用 `shell.openExternal(details.url)` 无验证。已添加相同协议白名单。(2026-02-28)
  - 文件: `src/main/index.ts`

- [!] **TransclusionView `tiptapToHtml()` 属性注入**: codeBlock `language` 和 callout `type` 未经 `escapeHtml()` 直接拼入 HTML class 属性。codeBlock language 可通过 Markdown 导入注入任意字符 (CommonMark 允许 info string 含任意非反引号字符)。callout type 受 regex `\w+` 约束安全，但防御性转义。已添加 `escapeHtml()` + `DOMPurify.sanitize()` 纵深防御。(2026-02-28)
  - 文件: `src/renderer/src/components/TransclusionView.tsx`

### 9.2 性能

- [!] **katex + highlight.js 启动时全量加载**: `note-exporter.ts` 静态 import katex (~200KB) 和 highlight.js (~100KB)，通过 `index.ts` → `./export` 导入链在 app 启动时加载，即使用户不导出 PDF。改为模块级 lazy loading + `ensureExportLibs()` 在 `exportNoteAsPDF` 入口调用。(2026-02-28)
  - 文件: `src/main/export/note-exporter.ts`

- [~] **collectWatchDirectories 同步 I/O**: `readdirSync`/`lstatSync` 在 `createFallbackDirectoryTreeWatcher` 中递归扫描。核实仅影响 Linux (macOS/Windows 使用原生 recursive watcher)。改为 async 需重构 syncWatchers 时序，收益不值得。延后。(核实: 2026-02-28)
  - 文件: `src/main/local-folder-watch.ts`

### 9.3 核实为误报的项目

| 报告内容 | 实际情况 |
|---------|---------|
| shell.openExternal 无 URL 验证 | `register-app-ipc.ts:121-136` 已有协议白名单 |
| useAIWriting HTML attribute 注入 | HTML 经 ProseMirror parser 解析，只保留 schema 定义的属性 |
| popupStorage 缓存无限增长 | 已有 MAX_CACHE_SIZE=50 + enforcePopupCacheLimit |
| Database 19 文件 0 测试 | `__tests__/` 下有多个 database-*.test.ts |
| JSON.stringify 每次击键 | Round 2 已加 300ms debounce |

---

## P10 -- Round 4 长期主义审查 (2026-02-28)

> 基于全量代码深度核实的结构性问题清单。聚焦长期可维护性、可扩展性、安全纵深。

### 10.1 架构 -- Local Folder 子系统耦合

Local folder 功能贯穿 36+ 文件，sourceType 分支散布 17+ 处。当前缺少统一抽象层，每个新功能都要问"local folder 怎么处理"。

- [ ] **sourceType 分支散布 17+ 处**: note-gateway.ts (4处), sanqian-sdk/tools/mutations.ts (5处), sanqian-sdk/tools/read.ts (3处), summary-service.ts, context-providers.ts, context-overview-helpers.ts, search-helpers.ts, database/ai-popups.ts。每增加一个 source type 需修改所有分支点。
  - 建议: 引入 `NoteSourceAdapter` 接口 (getNote, saveNote, searchNotes, buildEtag, resolveIfMatch)，internal 和 local-folder 各实现一版，note-gateway 通过 adapter 分派而非 if/else。
  - 影响范围: note-gateway.ts, note-synthesis.ts, sanqian-sdk/tools/*.ts, summary-service.ts
  - 风险: 改动面大，需先有充分测试覆盖

- [ ] **note-synthesis.ts sync/async 函数完整重复**: `collectLocalNotesForGetAll` (lines 125-199) 与 `collectLocalNotesForGetAllAsync` (lines 210-284) 仅差一个 `await`，75 行几乎 1:1 复制。
  - 建议: 统一为 async 版本，或用 adapter 函数消除重复
  - 文件: `src/main/note-synthesis.ts`

- [ ] **register-local-folder-ipc.ts 依赖接口 50+ 方法**: `LocalFolderIpcDeps` 接口包含 50+ 个方法，IPC handler 中混合了 mount 验证、冲突检测、索引调度、watch 初始化等多个关注点。
  - 建议: 按职责拆分为 mount/file/metadata 三个 IPC 模块，每个模块有独立的 deps 接口
  - 文件: `src/main/ipc/register-local-folder-ipc.ts`

### 10.2 架构 -- Renderer 状态管理

App.tsx 作为状态中枢，通过 prop drilling 将状态传递给子组件，组件接口过重。

- [ ] **Sidebar 接收 41 个 props**: 接口定义见 Sidebar.tsx lines 97-139。任何重构都需触碰所有 call site。
  - 建议: 导航状态 (`selectedSmartView`, `selectedNotebookId`, `selectedNoteIds`, `selectedInternalFolderPath`) 提取到 `NavigationContext`，减少 Sidebar props 到 ~20
  - 文件: `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/App.tsx`

- [ ] **useNoteNavigation 接收 44 个输入参数**: 输入参数过多是 hook 职责过重的信号。
  - 建议: 与 NavigationContext 配合，将导航状态从 props 改为 context 消费，输入减至 <15
  - 文件: `src/renderer/src/hooks/useNoteNavigation.ts`

- [ ] **3 个 note 数组分别存储**: `notes` (internal), `allSourceLocalNotes` (local), `globalSmartViewNotes` (smart view cache) 三个数组独立维护，存在不同步风险。
  - 建议: 统一为单一 note store + memoized selectors 按 source/view 过滤
  - 文件: `src/renderer/src/App.tsx` lines 66-71

- [ ] **2 个循环依赖 ref 打破**: `selectSingleNoteRef` (App.tsx line 272 -> useNoteNavigation line 405) 和 `internalFolderDialogsResetRef` (line 155) 需要 useRef 手动赋值打破循环。
  - 建议: 重新组织 hook 层级，将 selectSingleNote 下沉到 useNoteCRUD 不依赖的层级；或改用 event emitter 模式
  - 文件: `src/renderer/src/App.tsx`

- [ ] **全局键盘处理器 ref 掩盖复杂度**: App.tsx lines 647-662 用 8 个 ref 捕获 callback 闭包，lines 667-761 的 useEffect 有 8 个依赖项。
  - 建议: 提取为独立 `useGlobalKeyboardShortcuts` hook，内部管理 ref 和 handler
  - 文件: `src/renderer/src/App.tsx`

### 10.3 IPC 层 -- 错误处理不一致

11 个 IPC handler 文件使用 3 种不同的错误响应模式，30+ 个 handler 无错误处理。

- [ ] **3 种错误响应模式混用**:
  - `{ success: false, errorCode: 'CODE' }` -- LocalFolder, NotebookFolder, LocalFolderSearch (64 处)
  - `{ success: false, error: 'message' }` -- Chat, App, KnowledgeBase (12+ 处)
  - `throw new Error()` -- ImportExport (1 处, `importInline:selectAndParsePdf` line 336)
  - 建议: 统一为 `{ success: false, errorCode }` 模式 + shared/types.ts 中定义 `IpcResponse<T>` 类型
  - 文件: 所有 `src/main/ipc/register-*.ts`

- [ ] **30+ handler 无错误边界**: register-notebook-ipc.ts (5个), register-attachment-ipc.ts (11个), register-ai-ipc.ts 部分 (context:sync 等), register-note-ipc.ts 部分。如果 deps 方法 throw，handler 直接崩溃。
  - 建议: 对无保护 handler 增加 try/catch 包裹。中期引入 `createSafeHandler` 工厂函数统一包裹。
  - 文件: `src/main/ipc/register-notebook-ipc.ts`, `register-attachment-ipc.ts`, `register-ai-ipc.ts`, `register-note-ipc.ts`

- [ ] **Preload 类型与 IPC 实际返回不匹配**: Chat handler 返回 `{ success: false, error: string }` (register-chat-ipc.ts line 96)，但 preload/index.d.ts lines 337-338 类型定义为 `{ success: boolean }` 缺少 error 字段。TypeScript 无法捕获 renderer 对 `.error` 的访问。
  - 建议: 审查所有 IPC handler 返回类型，确保 preload/index.d.ts 完全对齐
  - 文件: `src/preload/index.d.ts`, `src/main/ipc/register-chat-ipc.ts`

- [ ] **note:search 静默返回空数组**: register-note-ipc.ts line 92，scope 解析失败时 `console.warn` + `return []`，renderer 无法区分"无结果"和"出错"。
  - 建议: 返回 `{ success: false, errorCode }` 或在 UI 显示搜索异常提示
  - 文件: `src/main/ipc/register-note-ipc.ts`

### 10.4 测试 -- 关键热路径无覆盖

88 个测试文件，但 renderer hooks 覆盖率 2/22 (9%)，最复杂的 3 个 hook 全部无测试。

- [ ] **useLocalFolderState (2,206 行) 无测试**: 管理 13 个 useState + 20+ useRef + 40+ useCallback + 13+ useEffect。涵盖 mount/文件编辑/保存冲突/watch 刷新/元数据 5-6 个状态域。
  - 测试策略: 优先测试核心流程 -- mount -> scan -> open file -> save -> conflict detection -> resolve。需 mock 23 个 window.electron 方法。
  - 文件: `src/renderer/src/hooks/useLocalFolderState.ts`

- [ ] **useNoteNavigation (1,078 行) 无测试**: 4 个 ref + 5 个 useEffect + 14 个 async 模式 + stale response 拒绝逻辑 (noteSelectionVersionRef)。
  - 测试策略: 测试 note selection -> notebook switch -> smart view switch 三大流程，重点覆盖 stale response 拒绝。
  - 文件: `src/renderer/src/hooks/useNoteNavigation.ts`

- [ ] **useNoteCRUD (851 行) 无测试**: 批量操作有 BULK_NOTE_PATCH_CONCURRENCY=8 并发控制，duplicate note 有复杂正则复制检测。
  - 测试策略: 测试 CRUD + bulk operations + concurrency 边界。`runWithConcurrency()` 可独立测试。
  - 文件: `src/renderer/src/hooks/useNoteCRUD.ts`

- [ ] **setup-renderer.ts 过于精简 (5 行)**: 无集中式 window.electron mock，每个 renderer 测试文件都要手动 mock，导致重复。
  - 建议: 在 setup-renderer.ts 中提供默认 window.electron mock，各测试文件可 override
  - 文件: `src/__mocks__/setup-renderer.ts`

- [ ] **8 处 timing-dependent 测试**: 使用真实 setTimeout (1100ms, 10ms 等) 而非 fake timer，在慢 CI 上可能 flaky。
  - 文件: `database-update-safe.test.ts` (line 232), `concurrency.test.ts`, `local-folder-watch.test.ts` (lines 161-179)

### 10.5 安全纵深

- [ ] **主窗口 sandbox: false**: `index.ts` lines 546-553 主窗口 WebContentsView 设置 `sandbox: false`。即使有 contextIsolation + nodeIntegration: false，禁用 sandbox 削弱了安全模型。如有 XSS 漏洞，攻击面显著增大。
  - 建议: 评估是否可改为 `sandbox: true`。如不可行，记录原因并加强 preload 层输入验证
  - 文件: `src/main/index.ts`

- [ ] **缺少 Content Security Policy**: `src/renderer/index.html` 无 CSP meta tag。CSP 可作为 XSS 的纵深防御层。
  - 建议: 添加 `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: attachment:; font-src 'self'; media-src 'self' attachment:;">`
  - 文件: `src/renderer/index.html`

### 10.6 性能

- [ ] **getAllAttachments() 递归串行扫描**: attachment.ts lines 268-291 用 serial `await scanDir()` 递归扫描附件目录。10,000+ 附件时可能 2-5 秒。
  - 建议: 并行扫描子目录 + 结果缓存 5 分钟
  - 文件: `src/main/attachment.ts`

- [ ] **local-folder/io.ts 保留同步文件操作**: `saveFileAtomically` 使用 `openSync`/`writeFileSync`/`fsyncSync` (lines 92-96)。atomic write 需要 sync 保证数据完整性，但频繁调用会阻塞事件循环。
  - 建议: 评估实际调用频率。若为热路径，考虑 worker thread 或 batch write
  - 文件: `src/main/local-folder/io.ts`

### 10.7 核实为误报/可忽略的项目

| 报告内容 | 核实结果 |
|---------|---------|
| shell.openExternal 主进程路径无验证 | index.ts line 621-632 已有协议白名单 (Round 3 修复) |
| Attachment 协议路径遍历 | getFullPath() 已有 realpathSync() symlink 防御 (Round 2 修复) |
| embedding indexingLocks 无限增长 | noteId 为 string，10K 条目内存 <1MB，实际风险极低 |
| setInterval 未清理 | aiPopupCleanupTimer 在 clearAIPopupCleanupTimers() 中正确清理 |
| Event listener 泄漏 | preload 中 listener 均返回 unsubscribe 函数，清理正确 |
| Local folder watcher Map 泄漏 | unmount 时有对应 cleanup 逻辑 |
| note-gateway.ts 15,851 行 | 实际 515 行，agent 报告数据有误 |
| Semantic search N+1 | 批量操作正确，无 N+1 |

---

## 处理原则

1. 每项先核实是否属实（标记 [x] 或 [~]），避免盲目修复不存在的问题
2. 属实后评估实际影响，决定是否值得修复
3. 修复时遵循最小改动原则，不引入额外复杂度
4. 拆分类任务优先保证行为不变，用测试覆盖后再拆
5. 每完成一项标记 [!] 并简要记录修复方式和日期
