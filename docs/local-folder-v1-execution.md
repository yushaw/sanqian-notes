# 本地文件夹笔记本 V1 工程执行方案（长期主义）

## 1. 目标

在不破坏现有笔记能力的前提下，引入“本地文件夹笔记本”能力，并为后续 V2（同步、跨端、插件）保留演进空间。

- 不做一次性分支逻辑堆叠
- 不把“本地文件系统”直接耦合进现有 Note CRUD
- 先抽象数据源，再挂接 UI/搜索/编辑

### 当前进度（2026-02-25）

1. PR-1：已完成（类型与数据库迁移、挂载表、source_type）
2. PR-2：已完成（左栏入口、挂载/解除挂载语义、错误码提示）
3. PR-3：已完成（三级树、过滤规则、选中文件夹递归展示文件）
4. PR-4：已完成
   - 已完成：本地文件打开与自动保存、`Cmd+S` 显式保存、创建文件/文件夹、重命名（含冲突提示）、删除到系统废纸篓、删除前挂载影响分析提示、删除后受影响挂载转 `missing`
5. PR-5：已基本完成
   - 已完成：文件监听事件（watch + renderer 自动刷新）、保存冲突检测（`mtime + size`）、冲突处理弹窗（重载/覆盖/另存副本）、权限失效恢复（重新选择文件夹并恢复挂载）、关键单元测试（重命名/冲突/默认扩展名）、watch 错误状态映射与去抖调度测试（`permission_required/missing`）、监听链路回归测试（递归 watch 降级、真实文件系统变更触发）、恢复流程 E2E-ish 回归测试（missing -> relink -> active、权限波动 -> permission_required -> active）
6. PR-6：已完成
   - 已完成：本地笔记本内全文搜索（文件内容）、目录子树范围过滤、搜索结果稳定排序、父子挂载 canonical 去重、`search_notes` 工具接入本地搜索、`get_note/get_note_outline` 支持 local 资源 ID、SDK `contexts.notes` 支持 local 资源列举与引用、`SearchScopeResolver` 入口映射落地（`global_search/notebook_search/folder_search`）并接入主进程搜索入口、UI 级全局搜索入口（internal + local 统一结果展现）、`runUnifiedSearch` 路由抽象与回归单测（全局/笔记本/local 降级分支）、搜索结果跳转语义回归测试（local 结果解析到 notebook/path）、全局结果稳定性回归测试（重复查询顺序一致）

---

## 2. 长期主义技术原则

1. **Source-first 架构**
   - 所有笔记本都归入统一 `NotebookSource` 抽象（internal / local-folder）。
   - 上层 UI 不直接依赖 DB 或 FS。

2. **读写路径显式区分**
   - internal：DB 持久化。
   - local-folder：文件系统持久化。
   - 不允许隐藏式 fallback，避免数据写错位置。

3. **能力复用而非复制**
   - 编辑器、搜索入口、i18n、确认弹窗复用。
   - 仅在“数据访问层”分叉。

4. **可回滚迁移**
   - 每次 schema 变更必须可重建或安全降级。
   - 挂载信息与内容索引分离，防止损坏主数据。

5. **先稳定、再扩展**
   - V1 优先把“挂载、浏览、编辑、删除、搜索”闭环做稳。
   - 复杂能力（sync/plugin）按单独模块扩展。

---

## 3. 分层设计

### 3.1 Domain 层（新增）

1. `NotebookSource`（数据源）
   - `id`
   - `type: 'internal' | 'local-folder'`
   - `name`
   - `status`

2. `NotebookTreeNode`（树节点）
   - `id`
   - `name`
   - `kind: 'folder' | 'file'`
   - `depth`
   - `parentId`
   - `sourceId`

3. `TextDocumentRef`（文档引用）
   - `sourceType`
   - `path` 或 `noteId`
   - `encoding`
   - `lineEnding`

4. `LocalDocumentId`（本地文档稳定标识）
   - 规则：`{notebookId}:{normalizedRelativePath}`
   - 用途：目录列表选择、索引主键、冲突与缓存关联
   - 重命名/移动视为“旧 ID 删除 + 新 ID 建立”

5. `FolderNoteListingRule`（目录列表规则）
   - 选中文件夹时，列出该目录子树下所有笔记
   - 递归深度受“最多三级目录”约束

### 3.2 Infra 层（新增）

1. `InternalNotebookRepository`
2. `LocalFolderRepository`
3. `FolderScanner`（深度/过滤规则）
4. `FolderWatcher`（增量更新）
5. `TextCodecService`（编码检测/保存）
6. `AtomicFileWriter`（临时文件 + fsync + rename）
7. `TrashService`（文件/目录移入系统废纸篓）

### 3.3 Application 层（新增）

1. `NotebookSourceService`
   - 获取笔记本列表（合并 internal + local）
   - 新增本地挂载
   - 解除挂载
   - 挂载判重（同 canonical 路径拒绝，父子路径允许）
   - 删除影响分析（识别是否命中其他挂载根路径）

2. `LocalTreeService`
   - 扫描目录并构建三级树
   - 提供当前目录节点视图
   - 提供“按目录子树聚合笔记列表”能力

3. `LocalDocumentService`
   - 读取文本
   - 保存文本
   - 冲突检测

4. `UnifiedSearchService`
   - 路由到 internal 索引与 local 索引
   - 汇总结果并标注来源
   - 全局去重后稳定排序（`score DESC`，同分按 `canonical_path ASC`）

5. `SearchScopeResolver`
   - 统一维护 `searchEntryId -> scope` 映射
   - 拒绝未注册入口直接搜索

说明：internal 目录树能力在 V1.5+ 补齐，V1 仅交付 local-folder 目录树能力。

---

## 4. 实施顺序（建议按 PR 批次）

### PR-1：类型与数据库迁移（不改 UI）

1. 冻结 schema 路线（单一路径，不再保留二选一）：
   - `notebooks` 增加 `source_type TEXT NOT NULL DEFAULT 'internal'`
   - 新增 `local_folder_mounts`（`notebook_id PK FK`、`root_path`、`canonical_root_path UNIQUE`、`status`、`created_at`、`updated_at`）
   - 约束：`FOREIGN KEY(notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE`
2. 新增 shared type：`NotebookSourceType`、`NotebookStatus`
3. 新增 IPC：`localFolder.mount / unmount / list`
4. 增加迁移与回滚兼容测试（老库升级、新库初始化）

验收：不影响现有笔记本读写。

### PR-2：左栏入口与挂载流程

1. “笔记本 +”改为菜单：
   - 新建笔记本
   - 添加本地文件夹
2. 目录选择与授权
3. 挂载前做 canonical 路径判重（同路径拒绝、父子路径允许）
4. canonical 生成失败（`realpath` 失败）时中止挂载并提示
   - 错误码：`LOCAL_MOUNT_PATH_PERMISSION_DENIED` / `LOCAL_MOUNT_PATH_UNREACHABLE` / `LOCAL_MOUNT_PATH_NOT_FOUND`
5. 挂载后展示在左栏
6. 删除本地笔记本改为“解除挂载”文案与行为

验收：可挂载、可解除挂载、不删磁盘。

### PR-3：三级目录树与文件浏览

1. 中栏支持 local-folder 树结构展示
2. 仅显示三级（根=1）
3. 过滤规则：扩展名、隐藏项、symlink
4. 目录与文件节点排序（文件夹优先 + 名称）
5. 选中文件夹时，笔记列表展示该目录子树下所有笔记
6. 第 3 级目录下禁止新建子文件夹（防止不可见内容）

验收：第 4 级及以下内容不可见。

### PR-4：本地文件编辑闭环

1. 打开 `.md/.txt`
2. 自动保存 + `Cmd+S`
3. 新建文件/文件夹（i18n 默认命名）
4. 重命名与重名冲突提示
5. 删除文件/目录到废纸篓（递归 + 二次确认）
6. 删除前执行“挂载影响分析”，命中其他挂载时展示影响提示并再次确认
7. 保存链路强制走 `AtomicFileWriter`，保证写盘原子性
8. 删除确认后受影响挂载在一次刷新周期内标记为 `missing` 并提示

验收：文件操作可完整落盘。

### PR-5：监听、冲突、权限恢复

1. 文件变更监听
2. 保存冲突检测（`mtime + size + content hash(可选)`）
3. 冲突弹窗：重载 / 覆盖 / 另存
4. 权限失效时状态提示与重新授权

验收：外部改动可被安全处理。

### PR-6：全文搜索接入

1. 本地文本纳入全文搜索
2. 按入口路由范围（全局/笔记本/目录子树）
3. 索引排除规则与展示规则一致
4. 通过 `SearchScopeResolver` 冻结入口范围映射并加测试（至少包含 `global_search` / `notebook_search` / `folder_search`）
5. 全局搜索按 canonical 文件路径去重（避免父子挂载重复命中）
6. 去重后按稳定排序键输出（`score DESC`，同分按 `canonical_path ASC`）

验收：本地内容可搜且范围正确。

---

## 5. 模块边界约束（必须遵守）

1. UI 层不得直接访问 `fs`。
2. renderer 只调用 preload 暴露的统一 API。
3. local-folder 逻辑不得污染现有 note 表结构语义（避免“伪 note”）。
4. 编码/换行处理集中在 `TextCodecService`，禁止散落在组件。
5. 删除行为统一通过 `TrashService`，禁止直接 `rm -rf`。
6. 文件写盘统一通过 `AtomicFileWriter`，禁止组件/业务层直接写文件。
7. 搜索范围解析统一走 `SearchScopeResolver`，禁止入口自行拼 scope。
8. 挂载判重统一基于 `canonical_root_path`，禁止使用原始输入路径直接比较。
9. 全局搜索结果去重统一基于 canonical 文件路径，禁止 UI 层自行去重。
10. internal 笔记本删除语义固定为 `notebook_id = NULL`（与现有 FK 约束一致），禁止另起分支行为。
11. `realpath` 失败必须返回标准错误码，不得仅返回通用错误文案。

---

## 6. 测试策略

### 6.1 单元测试

1. 深度限制与过滤规则
2. 编码检测与保存回写
3. 重名冲突与命名生成
4. 冲突检测分支
5. `LocalDocumentId` 规范化与重命名场景
6. `SearchScopeResolver` 入口映射校验
7. 挂载判重（同路径拒绝、父子路径允许）
8. canonical 生成失败分支（`realpath` 失败时中止挂载）
9. `realpath` 失败错误码映射正确（权限/不可达/不存在）

### 6.2 集成测试

1. 挂载 -> 扫描 -> 展示
2. 新建/编辑/保存 -> 磁盘验证
3. 外部修改 -> 冲突弹窗分支
4. 递归删除 -> 废纸篓行为
5. 第 3 级目录创建约束行为
6. 原子写入异常恢复（临时文件清理、目标文件不损坏）
7. 重复挂载同一路径被阻止，父子路径可同时挂载
8. 删除命中其他挂载根路径时，显示影响提示并需再次确认
9. 全局搜索父子挂载场景按 canonical 文件路径去重
10. 全局搜索去重后排序稳定（同查询多次顺序一致）
11. 跨挂载删除后受影响挂载在一次刷新周期内转为 `missing`

### 6.3 回归测试

1. internal 笔记本所有现有能力
2. 导入导出流程
3. 全局搜索与智能视图

---

## 7. 运维与诊断

1. 新增日志域：`local-folder`、`file-watch`、`text-codec`
2. 关键事件记录：
   - mount/unmount
   - scan duration
   - conflict action
   - permission failure
   - canonical resolve failure
   - canonical resolve error code
   - cross-mount delete impact
   - affected mounts status convergence time
   - search dedupe count
3. 提供“重扫当前本地笔记本”调试入口（仅开发模式）

---

## 8. 回滚策略

1. 如果本地模块异常：
   - 可禁用 local-folder 功能开关
   - 不影响 internal 数据使用
2. DB 迁移采用“增量字段/新表”方式，保持向后兼容读取。
3. 所有删除操作先走废纸篓，避免不可逆。

---

## 9. 非功能指标（V1）

1. 首次扫描 1000 文本文件可在可接受时间完成并可见进度。
2. 普通文件保存响应应接近即时（用户无明显卡顿）。
3. 文件监听抖动可控，不出现频繁重复刷新。
4. 崩溃恢复后挂载信息可恢复。
5. 异常中断（崩溃/断电）后目标文件不出现半写状态。

---

## 10. 下一步落地建议

1. 先实现 PR-1 + PR-2，确保“架构边界 + 用户入口”正确。
2. PR-3 到 PR-5 连续推进，优先做稳定性而不是花哨交互。
3. PR-6 搜索接入放在功能闭环稳定后，避免早期索引噪音。
4. internal 目录树能力（`folder_path` 等）作为 V1.5+ 单独 PR 组推进，避免挤占 V1 稳定性目标。

> 结论：这套拆分是“可持续演进”的最小路径。V1 不会把未来 git/云同步做死，也不会把当前代码变成不可维护的双轨分支。
