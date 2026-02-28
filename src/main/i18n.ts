/**
 * Main Process i18n Module
 *
 * Provides internationalization for main process code (SDK, database, etc.)
 * Uses app.getLocale() to detect system language.
 */

import { app } from 'electron'

type Lang = 'zh' | 'en'

/**
 * Get system language, defaults to 'en' for non-Chinese locales
 */
export function getSystemLang(): Lang {
  try {
    const locale = app.getLocale().toLowerCase()
    return locale.startsWith('zh') ? 'zh' : 'en'
  } catch {
    // Fallback for non-Electron environment (e.g., tests)
    return 'en'
  }
}

/**
 * App locale state (can be set by user, defaults to system language)
 */
let appLocale: Lang = getSystemLang()

/**
 * Set app locale (call when user changes language in settings)
 */
export function setAppLocale(locale: Lang): void {
  appLocale = locale
}

/**
 * Get current app locale
 */
export function getAppLocale(): Lang {
  return appLocale
}

/**
 * Main process translations
 */
const translations = {
  zh: {
    // SDK Agent descriptions
    sdk: {
      assistantName: 'Notes Assistant',
      assistantDescription: '帮你管理笔记的智能助手，可以搜索、创建、编辑笔记',
      assistantSystemPrompt: `你是用户的笔记助手，帮助用户管理和查询他们的知识库。

## 能力
**查询类**
- search_notes：搜索笔记（语义+关键词混合搜索），用 notebook_id 参数可限定笔记本范围
- get_note：获取笔记内容（支持单个或批量 ID，单个时可用 heading 参数指定章节）
- get_notebooks：查看所有笔记本及笔记数量

**编辑类**
- create_note：创建新笔记
- update_note：更新笔记，支持三种模式：
  - content：全量替换
  - append/prepend：追加到末尾或开头
  - edit：精确替换（old_string → new_string）
- move_note：移动笔记到其他笔记本
- delete_note：删除笔记（危险操作，必须先获得用户确认）

## 上下文
系统会自动提供当前编辑状态：正在编辑的笔记（标题、ID、所属笔记本）、用户选中的文本、光标所在的章节和段落。

## 问答模式
当用户提问（而非下达操作指令）时：

1. **判断是否检索**
   - 关于用户个人记录、历史笔记 → 先用 search_notes 搜索
   - 通用知识或闲聊 → 可直接回答

2. **检索与回答**
   - 根据搜索结果的 summary 和 preview 判断相关性
   - 需要详情时用 get_note 获取完整内容（可批量获取多个）
   - 基于笔记内容组织回答

3. **标注来源**
   - 若工具结果包含 link，引用笔记时必须使用 markdown 链接格式
   - 格式：[笔记标题](sanqian-notes://note/笔记ID)
   - 若 link 为空（例如 local-folder 资源），使用「笔记本名 · 相对路径」做文本引用，不要编造链接
   - 示例：详见 [项目周报](sanqian-notes://note/abc123) 第二节；或 本地笔记「工作区 · docs/plan.md」

4. **处理边界**
   - 没找到相关笔记 → 诚实告知，可提供通用建议或询问是否创建新笔记

## 示例
- "总结一下" + 有选中文本 → 总结选中内容
- "这篇讲什么" → 用 get_note 获取当前笔记内容
- "放到周报里" → 搜索周报笔记，追加当前内容
- "我之前写过关于 XX 的笔记吗" → search_notes 搜索，汇报结果
- "帮我回顾一下项目进度" → 搜索相关笔记，整理要点

## 原则
- 更新笔记优先用 edit 模式精确替换，避免全量覆盖
- 删除操作必须先询问用户确认
- 回答基于笔记时，明确区分「笔记内容」和「补充说明」
- 不确定时宁可多检索，不要编造笔记中没有的信息
- 引用笔记内容时优先附上链接；若是 local-folder 资源无 link，则使用「笔记本名 · 相对路径」文本引用
- 所有内容使用 Markdown 格式`,
      writingName: 'Writing Assistant',
      writingDescription: '专注于文本处理的写作助手，直接输出处理结果',
      writingSystemPrompt: `你是文本处理助手。用户会发送包含 XML 标签的请求：

- <task>: 处理指令（润色、翻译、总结等）
- <surrounding_context>: 上下文，仅供理解语境，不要处理
- <target>: 待处理的内容

你的工作：
1. 严格按照 <task> 指令处理 <target> 内容
2. 直接输出结果，不要任何解释、前言、标签或代码块
3. 保持原文格式（列表、段落等）
4. 保持原文语言（除非指令要求翻译）`,
      generatorName: 'Generator',
      generatorDescription: '内容生成助手，用于生成图表、公式、代码等结构化内容',
      generatorSystemPrompt: `你是内容生成助手，专门生成结构化内容（图表、公式、代码、查询语句等）。

规则：
- 只输出请求的内容本身，不要包含任何解释、前言或代码块标记
- 如果提供了当前内容，根据用户请求进行修改或优化
- 如果没有当前内容，根据用户描述生成新内容
- 确保输出的内容语法正确、可直接使用`,
      formatterName: 'Formatter',
      formatterDescription: '精炼内容并格式化输出到笔记编辑器',
    },
    // SDK Tool descriptions
    tools: {
      searchNotes: {
        description: '搜索笔记。internal 笔记使用混合搜索（语义 + 关键词），本地文件夹笔记使用关键词全文搜索；可通过 notebook_id 限定范围，local-folder 还支持 folder_relative_path 子树范围。',
        queryDesc: '搜索关键词或自然语言查询',
        notebookIdDesc: '笔记本 ID，仅搜索该笔记本内的笔记；不指定则搜索所有笔记',
        folderPathDesc: '文件夹相对路径（可选，仅 local-folder 笔记本有效），仅搜索该目录及其子目录',
        limitDesc: '返回结果的最大数量，默认 10',
        folderScopeRequiresNotebook: '使用 folder_relative_path 时必须同时指定 notebook_id',
        notebookNotFound: '笔记本不存在',
        folderScopeOnlyForLocalNotebook: 'folder_relative_path 仅支持 local-folder 笔记本',
        error: '搜索笔记失败',
      },
      getNote: {
        description: '获取笔记内容（Markdown 格式）。支持单个 ID 或 ID 数组批量获取。支持 internal 笔记 ID，以及本地笔记稳定 ID（UUID）或兼容 local 资源 ID（local:...）。单个时可指定章节；批量时若某 ID 不存在则该项返回 {id, error}。结果会返回 etag，可用于写工具的 if_match。',
        idDesc: '笔记 ID（internal）或本地笔记稳定 ID（UUID，兼容 local:...），支持单个字符串或 ID 数组',
        headingDesc: '章节标题（可选，仅单个 ID 时有效），如 "## 第一章" 或 "2.3"（会模糊匹配包含该文本的标题）',
        headingMatchDesc: '匹配模式：exact（精确）、contains（包含，默认）、startsWith（前缀）',
        offsetDesc: '起始行号（从 1 开始，可选）',
        limitDesc: '返回行数限制（可选）',
        notFound: '笔记不存在',
        headingNotFound: '章节不存在',
        headingIgnoredInBatch: '注意：批量获取模式下 heading 参数被忽略，如需获取特定章节请逐个查询',
        error: '获取笔记失败',
      },
      getNoteOutline: {
        description: '获取笔记的大纲结构（所有标题列表），支持 internal 笔记 ID 与本地笔记稳定 ID（UUID，兼容 local:...）。',
        idDesc: '笔记 ID（internal）或本地笔记稳定 ID（UUID，兼容 local:...）',
        notFound: '笔记不存在',
        error: '获取大纲失败',
      },
      createNote: {
        description: '创建新笔记。content 使用 Markdown 格式。',
        titleDesc: '笔记标题',
        contentDesc: '笔记内容，使用 Markdown 格式',
        notebookIdDesc: '笔记本 ID（可选），如果不指定则创建在默认笔记本',
        notebookNotFound: '笔记本不存在',
        localNotebookUnsupported: '不支持在 local-folder 笔记本中创建笔记，请直接在本地目录中新建文件',
        localNotebookUnavailable: '本地文件夹笔记本当前不可用，请检查挂载状态',
        localFileAlreadyExists: '已存在同名文件',
        localInvalidName: '文件名无效',
        localAccessDenied: '没有权限访问本地目录',
        localWriteFailed: '写入本地文件失败',
        localConflict: '本地文件发生冲突，请刷新后重试',
        localTooLarge: '文件过大，无法写入',
        localRollbackFailed: '创建失败且回滚本地文件失败，请手动清理已创建文件',
        success: '笔记创建成功',
        error: '创建笔记失败',
      },
      updateNote: {
        description: '更新笔记。支持三种模式：1) content 全量替换；2) append/prepend 追加（可指定位置）；3) edit 精确替换。',
        idDesc: '笔记 ID',
        ifMatchDesc: '可选并发校验标记（revision 或 etag）',
        titleDesc: '新标题（可选）',
        contentDesc: '新内容（Markdown），会替换整个笔记内容',
        appendDesc: '追加的内容（Markdown）。默认追加到末尾，可配合 after 参数指定位置',
        prependDesc: '前置的内容（Markdown）。默认插入到开头，可配合 before 参数指定位置',
        afterDesc: '锚点文本，在此文本所在段落/标题之后插入内容（配合 append 使用）',
        beforeDesc: '锚点文本，在此文本所在段落/标题之前插入内容（配合 prepend 使用）',
        editDesc: '精确替换：{old_string, new_string, replace_all?}',
        notFound: '笔记不存在',
        localReadOnly: '本地文件夹笔记为只读，请在文件系统中编辑',
        invalidIfMatch: 'if_match 参数格式无效',
        ifMatchMismatch: '笔记已被其他变更更新，请刷新后重试',
        conflict: '保存冲突，请刷新后重试',
        localInvalidName: '文件名无效',
        localAccessDenied: '没有权限访问本地目录',
        localWriteFailed: '写入本地文件失败',
        localFileAlreadyExists: '已存在同名文件',
        localTooLarge: '文件过大，无法写入',
        localRollbackFailed: '更新失败且回滚重命名失败，请手动检查文件名',
        success: '笔记更新成功',
        editSuccess: '替换了 {count} 处',
        editNotFound: '未找到匹配内容。',
        editSimilarFound: '找到相似内容',
        editEmptyString: 'old_string 不能为空',
        editMultipleFound: '找到 {count} 处匹配，请使用 replace_all=true 或提供更精确的内容',
        anchorNotFound: '未找到锚点文本',
        afterRequiresAppend: 'after 参数必须与 append 一起使用',
        beforeRequiresPrepend: 'before 参数必须与 prepend 一起使用',
        noChanges: '没有需要更新的内容',
        error: '更新笔记失败',
      },
      deleteNote: {
        description: '删除笔记（移动到回收站）。支持 internal 与 local-folder（本地文件会进入系统回收站）。这是危险操作，必须先获得用户确认。',
        idDesc: '笔记 ID',
        localReadOnly: '本地文件夹笔记为只读，无法删除',
        ifMatchDesc: '可选并发校验标记（revision 或 etag）',
        invalidIfMatch: 'if_match 参数格式无效',
        ifMatchMismatch: '笔记已被其他变更更新，请刷新后重试',
        localAccessDenied: '没有权限访问本地目录',
        localDeleteFailed: '删除本地文件失败',
        notFound: '笔记不存在',
        success: '笔记已移动到回收站',
        error: '删除笔记失败',
      },
      getTags: {
        description: '获取所有标签列表。',
        error: '获取标签失败',
      },
      getNotebooks: {
        description: '获取所有笔记本列表，包含笔记数量，以及 source_type/status/writable 元信息。',
        error: '获取笔记本失败',
      },
      moveNote: {
        description: '移动笔记到其他笔记本。internal 走数据库移动；local-folder 会复制到目标本地笔记本根目录并将源文件移入回收站。',
        idDesc: '笔记 ID',
        notebookIdDesc: '目标笔记本 ID（null 表示移出笔记本）',
        localReadOnly: '本地文件夹笔记为只读，无法移动',
        ifMatchDesc: '可选并发校验标记（revision 或 etag）',
        invalidIfMatch: 'if_match 参数格式无效',
        ifMatchMismatch: '笔记已被其他变更更新，请刷新后重试',
        notFound: '笔记不存在',
        notebookNotFound: '目标笔记本不存在',
        targetNotAllowed: '当前来源与目标笔记本类型组合不支持移动',
        localNotebookUnavailable: '目标本地笔记本当前不可用，请检查挂载状态',
        localFileAlreadyExists: '目标目录下已存在同名文件',
        localInvalidName: '文件名无效',
        localAccessDenied: '没有权限访问本地目录',
        localWriteFailed: '写入目标本地文件失败',
        localConflict: '目标本地文件发生冲突，请刷新后重试',
        localTooLarge: '文件过大，无法移动',
        localDeleteFailed: '移动后清理源文件失败',
        localRollbackFailed: '移动失败且回滚目标文件失败，请手动清理目标文件',
        success: '笔记移动成功',
        error: '移动笔记失败',
      },
      webSearch: {
        description: '搜索网络获取最新信息。当用户询问需要实时数据或你的知识库中没有的信息时使用。',
        queryDesc: '搜索关键词',
      },
      fetchWeb: {
        description: '获取指定网页的内容。用于读取用户提供的链接或需要详细了解某个网页时使用。',
        urlDesc: '要获取的网页 URL',
        promptDesc: '可选的提示，指定需要从网页中提取什么信息',
      },
    },
    // AI Actions (for database builtin actions)
    aiActions: {
      improve: {
        name: '润色改写',
        description: '改善文字表达，修复语法错误',
        prompt: '改善文字表达，修复语法和标点错误，让内容更流畅自然。尽量保留原文措辞，只改动必要的部分。',
      },
      simplify: {
        name: '简化语言',
        description: '去除冗余，让内容更简洁易懂',
        prompt: '用更简单的语言重写，让普通读者也能轻松理解。用短句替代长句，用常见词替代专业术语。',
      },
      expand: {
        name: '扩写详述',
        description: '添加更多细节和解释，扩展内容',
        prompt: '扩展内容到 1.5-2 倍长度。补充具体例子、展开抽象概念、添加背景信息，保持原有观点和风格。',
      },
      translate: {
        name: '翻译',
        description: '中英互译',
        prompt: '中英互译：中文译成英文，英文译成中文。译文自然地道。代码、专有名词、URL 保持原样不翻译。',
      },
      summarize: {
        name: '总结摘要',
        description: '提取要点，生成摘要',
        prompt: '提取 3-5 个核心要点，用列表呈现。每条要点一句话，按重要性排序。',
      },
      explain: {
        name: '解释说明',
        description: '用通俗语言解释内容',
        prompt: '用通俗语言解释，假设读者没有专业背景。先一句话概括，再用类比或例子展开。如果是代码，说明功能和关键逻辑。',
      },
    },
    // Context providers
    contexts: {
      notes: {
        name: '笔记',
        description: '搜索和引用笔记',
      },
      notebooks: {
        name: '笔记本',
        description: '查看笔记本列表',
      },
    },
    // PDF Import
    pdf: {
      uploading: '正在上传 PDF...',
      parsing: '正在解析文档...',
      extracting: '正在提取图片...',
      converting: '正在转换格式...',
      processingFile: (current: number, total: number) => `正在处理第 ${current}/${total} 个文件`,
      // TextIn service
      textinDescription: '合合信息文档解析服务，支持表格、公式、图片提取',
      textinAppIdPlaceholder: '输入 TextIn App ID',
      textinSecretCodePlaceholder: '输入 TextIn Secret Code',
    },
    // Common
    common: {
      unknownError: '未知错误',
      contentTruncated: '[内容已截断...]',
    },
    // Export
    export: {
      nestingTooDeep: '(嵌套层级过深)',
      mermaidSourceNote: 'Mermaid 图表源码',
      untitledNote: '未命名笔记',
      failedToLoadNote: '无法加载笔记',
      embeddedContent: '嵌入内容',
      noResults: '无结果',
      selectExportLocation: '选择导出位置',
      exportMarkdown: '导出 Markdown',
      exportPDF: '导出 PDF',
      attachment: '附件',
      reference: '引用',
      tableOfContents: '目录',
      noHeadings: '暂无标题',
    },
  },
  en: {
    // SDK Agent descriptions
    sdk: {
      assistantName: 'Notes Assistant',
      assistantDescription: 'An intelligent assistant to help you manage notes - search, create, and edit',
      assistantSystemPrompt: `You are the user's notes assistant, helping them manage and query their knowledge base.

## Capabilities
**Query**
- search_notes: Search notes (hybrid: semantic + keyword), use notebook_id to filter by notebook
- get_note: Get note content (supports single ID or array of IDs; use heading parameter for specific section when single)
- get_notebooks: List all notebooks with note counts

**Edit**
- create_note: Create a new note
- update_note: Update a note with three modes:
  - content: Full replacement
  - append/prepend: Add to end or beginning
  - edit: Precise replacement (old_string → new_string)
- move_note: Move note to another notebook
- delete_note: Delete note (dangerous operation, must get user confirmation first)

## Context
The system automatically provides current editor state: the note being edited (title, ID, notebook), selected text, and cursor position (nearest heading and paragraph).

## Q&A Mode
When the user asks a question (rather than giving an operation command):

1. **Decide whether to search**
   - About user's personal records or past notes → use search_notes first
   - General knowledge or casual chat → can answer directly

2. **Search and answer**
   - Use summary and preview from search results to judge relevance
   - Use get_note for full content when needed (can batch fetch multiple)
   - Organize answer based on note content

3. **Cite sources**
   - If a tool result includes link, cite notes with markdown links
   - Format: [Note Title](sanqian-notes://note/noteID)
   - If link is empty (for local-folder resources), cite as plain text "Notebook · relative/path" and do not fabricate links
   - Example: See [Project Report](sanqian-notes://note/abc123) section 2, or local note "Workspace · docs/plan.md"

4. **Handle edge cases**
   - No relevant notes found → honestly inform, can offer general advice or ask if they want to create a new note

## Examples
- "summarize this" + text selected → summarize the selection
- "what's this note about" → use get_note to fetch current note
- "add to weekly report" → search for weekly report, append current content
- "have I written about XX before?" → search_notes, report findings
- "help me review project progress" → search related notes, summarize key points

## Principles
- Prefer edit mode for precise replacement, avoid full content replacement
- Always ask for user confirmation before deleting
- When answering based on notes, clearly distinguish "note content" from "additional commentary"
- When uncertain, prefer to search rather than fabricate information not in the notes
- Include note links when available; for local-folder sources without links, cite as plain text "Notebook · relative/path"
- All content uses Markdown format`,
      writingName: 'Writing Assistant',
      writingDescription: 'A writing assistant focused on text processing, outputs results directly',
      writingSystemPrompt: `You are a text processing assistant. Users will send requests with XML tags:

- <task>: Processing instruction (polish, translate, summarize, etc.)
- <surrounding_context>: Context for understanding, do not process
- <target>: Content to be processed

Your job:
1. Strictly follow the <task> instruction to process the <target> content
2. Output the result directly, without any explanation, preamble, tags, or code blocks
3. Preserve the original format (lists, paragraphs, etc.)
4. Keep the original language (unless the instruction requires translation)`,
      generatorName: 'Generator',
      generatorDescription: 'Content generator for diagrams, formulas, code, and other structured content',
      generatorSystemPrompt: `You are a content generation assistant, specialized in generating structured content (diagrams, formulas, code, queries, etc.).

Rules:
- Output only the requested content itself, without any explanation, preamble, or code block markers
- If current content is provided, modify or optimize it based on the user's request
- If no current content is provided, generate new content based on the user's description
- Ensure the output is syntactically correct and ready to use`,
      formatterName: 'Formatter',
      formatterDescription: 'Refine content and format output to note editor',
    },
    // SDK Tool descriptions
    tools: {
      searchNotes: {
        description: 'Search notes. Internal notes use hybrid search (semantic + keyword), while local-folder notes use keyword full-text search. Use notebook_id to scope results; local-folder also supports folder_relative_path subtree scope.',
        queryDesc: 'Search keywords or natural language query',
        notebookIdDesc: 'Notebook ID to search within; searches all notes if not specified',
        folderPathDesc: 'Folder-relative path (optional, only for local-folder notebooks), searches this folder and descendants',
        limitDesc: 'Maximum number of results to return, default 10',
        folderScopeRequiresNotebook: 'folder_relative_path requires notebook_id',
        notebookNotFound: 'Notebook not found',
        folderScopeOnlyForLocalNotebook: 'folder_relative_path is only supported for local-folder notebooks',
        error: 'Failed to search notes',
      },
      getNote: {
        description: 'Get note content (Markdown format). Supports single ID or array of IDs. Accepts internal note IDs and local note stable IDs (UUID), while remaining compatible with local resource IDs (local:...). Can specify heading when single; batch mode returns {id, error} for missing IDs. Returns etag for concurrency-safe writes via if_match.',
        idDesc: 'Internal note ID or local note stable ID (UUID, local:... still supported), supports single string or array of IDs',
        headingDesc: 'Heading (optional, only for single ID), e.g. "## Chapter 1" or "2.3" (will fuzzy match headings containing this text)',
        headingMatchDesc: 'Match mode: exact, contains (default), startsWith',
        offsetDesc: 'Starting line number (1-based, optional)',
        limitDesc: 'Number of lines to return (optional)',
        notFound: 'Note not found',
        headingNotFound: 'Heading not found',
        headingIgnoredInBatch: 'Note: heading parameter is ignored in batch mode. Use individual queries for specific sections.',
        error: 'Failed to get note',
      },
      getNoteOutline: {
        description: 'Get note outline structure (list of all headings). Accepts internal note IDs and local note stable IDs (UUID), with compatibility for local resource IDs (local:...).',
        idDesc: 'Internal note ID or local note stable ID (UUID, local:... still supported)',
        notFound: 'Note not found',
        error: 'Failed to get outline',
      },
      createNote: {
        description: 'Create a new note. Use Markdown format for content.',
        titleDesc: 'Note title',
        contentDesc: 'Note content in Markdown format',
        notebookIdDesc: 'Notebook ID (optional), creates in default notebook if not specified',
        notebookNotFound: 'Notebook not found',
        localNotebookUnsupported: 'Cannot create notes in local-folder notebooks; create files directly in the local folder',
        localNotebookUnavailable: 'Local-folder notebook is unavailable. Check mount status and try again',
        localFileAlreadyExists: 'A file with the same name already exists',
        localInvalidName: 'Invalid file name',
        localAccessDenied: 'Access denied for local folder',
        localWriteFailed: 'Failed to write local file',
        localConflict: 'Local file conflict detected. Refresh and retry',
        localTooLarge: 'File is too large to write',
        localRollbackFailed: 'Create failed and rollback of created local file also failed. Please clean up manually',
        success: 'Note created successfully',
        error: 'Failed to create note',
      },
      updateNote: {
        description: 'Update a note. Three modes: 1) content for full replacement; 2) append/prepend for adding (with optional position); 3) edit for precise replacement.',
        idDesc: 'Note ID',
        ifMatchDesc: 'Optional concurrency token (revision or etag)',
        titleDesc: 'New title (optional)',
        contentDesc: 'New content (Markdown), replaces entire note content',
        appendDesc: 'Content to append (Markdown). Defaults to end of document, use "after" to specify position',
        prependDesc: 'Content to prepend (Markdown). Defaults to start of document, use "before" to specify position',
        afterDesc: 'Anchor text to insert content after (use with append)',
        beforeDesc: 'Anchor text to insert content before (use with prepend)',
        editDesc: 'Precise replacement: {old_string, new_string, replace_all?}',
        notFound: 'Note not found',
        localReadOnly: 'Local-folder notes are read-only; edit them in the filesystem',
        invalidIfMatch: 'Invalid if_match value',
        ifMatchMismatch: 'Note has changed. Refresh and retry',
        conflict: 'Save conflict. Refresh and retry',
        localInvalidName: 'Invalid file name',
        localAccessDenied: 'Access denied for local folder',
        localWriteFailed: 'Failed to write local file',
        localFileAlreadyExists: 'A file with the same name already exists',
        localTooLarge: 'File is too large to write',
        localRollbackFailed: 'Update failed and rollback of rename also failed. Please verify the file name manually',
        success: 'Note updated successfully',
        editSuccess: 'Replaced {count} occurrence(s)',
        editNotFound: 'No matching content found.',
        editSimilarFound: 'Similar content found',
        editEmptyString: 'old_string cannot be empty',
        editMultipleFound: 'Found {count} matches, please use replace_all=true or provide more precise content',
        anchorNotFound: 'Anchor text not found',
        afterRequiresAppend: '"after" parameter requires "append" to be set',
        beforeRequiresPrepend: '"before" parameter requires "prepend" to be set',
        noChanges: 'No changes to update',
        error: 'Failed to update note',
      },
      deleteNote: {
        description: 'Delete a note (move to trash). Supports internal and local-folder notes (local files are moved to system trash). This is dangerous and requires user confirmation first.',
        idDesc: 'Note ID',
        localReadOnly: 'Local-folder notes are read-only and cannot be deleted',
        ifMatchDesc: 'Optional concurrency token (revision or etag)',
        invalidIfMatch: 'Invalid if_match value',
        ifMatchMismatch: 'Note has changed. Refresh and retry',
        localAccessDenied: 'Access denied for local folder',
        localDeleteFailed: 'Failed to delete local file',
        notFound: 'Note not found',
        success: 'Note moved to trash',
        error: 'Failed to delete note',
      },
      getTags: {
        description: 'Get all tags list.',
        error: 'Failed to get tags',
      },
      getNotebooks: {
        description: 'Get all notebooks with note counts, plus source_type/status/writable metadata.',
        error: 'Failed to get notebooks',
      },
      moveNote: {
        description: 'Move a note to another notebook. Internal notes are moved in DB; local-folder notes are copied to the target local notebook root and the source file is moved to trash.',
        idDesc: 'Note ID',
        notebookIdDesc: 'Target notebook ID (null to remove from notebook)',
        localReadOnly: 'Local-folder notes are read-only and cannot be moved',
        ifMatchDesc: 'Optional concurrency token (revision or etag)',
        invalidIfMatch: 'Invalid if_match value',
        ifMatchMismatch: 'Note has changed. Refresh and retry',
        notFound: 'Note not found',
        notebookNotFound: 'Target notebook not found',
        targetNotAllowed: 'This source/target notebook type combination is not supported for move',
        localNotebookUnavailable: 'Target local-folder notebook is unavailable. Check mount status and try again',
        localFileAlreadyExists: 'A file with the same name already exists in target folder',
        localInvalidName: 'Invalid file name',
        localAccessDenied: 'Access denied for local folder',
        localWriteFailed: 'Failed to write target local file',
        localConflict: 'Conflict on target local file. Refresh and retry',
        localTooLarge: 'File is too large to move',
        localDeleteFailed: 'Moved file but failed to remove source file',
        localRollbackFailed: 'Move failed and rollback of target file also failed. Please clean up target file manually',
        success: 'Note moved successfully',
        error: 'Failed to move note',
      },
      webSearch: {
        description: 'Search the web for up-to-date information. Use when user asks about real-time data or information not in your knowledge base.',
        queryDesc: 'Search query keywords',
      },
      fetchWeb: {
        description: 'Fetch content from a specified webpage. Use to read links provided by user or when you need detailed information from a webpage.',
        urlDesc: 'URL of the webpage to fetch',
        promptDesc: 'Optional prompt specifying what information to extract from the page',
      },
    },
    // AI Actions (for database builtin actions)
    aiActions: {
      improve: {
        name: 'Improve Writing',
        description: 'Improve writing and fix grammar errors',
        prompt: 'Improve the writing, fix grammar and punctuation errors, make the content more fluent and natural. Keep the original wording as much as possible, only change what is necessary.',
      },
      simplify: {
        name: 'Simplify',
        description: 'Remove redundancy, make content more concise',
        prompt: 'Rewrite in simpler language that anyone can understand. Use short sentences instead of long ones, common words instead of jargon.',
      },
      expand: {
        name: 'Expand',
        description: 'Add more details and explanations',
        prompt: 'Expand the content to 1.5-2x length. Add specific examples, elaborate on abstract concepts, provide background information while maintaining the original viewpoint and style.',
      },
      translate: {
        name: 'Translate',
        description: 'Translate between Chinese and English',
        prompt: 'Translate between Chinese and English: Chinese to English, English to Chinese. The translation should be natural and idiomatic. Keep code, proper nouns, and URLs unchanged.',
      },
      summarize: {
        name: 'Summarize',
        description: 'Extract key points and generate summary',
        prompt: 'Extract 3-5 key points, present as a list. One sentence per point, ordered by importance.',
      },
      explain: {
        name: 'Explain',
        description: 'Explain content in plain language',
        prompt: 'Explain in plain language, assuming the reader has no professional background. Start with a one-sentence summary, then elaborate with analogies or examples. For code, explain the functionality and key logic.',
      },
    },
    // Context providers
    contexts: {
      notes: {
        name: 'Notes',
        description: 'Search and reference notes',
      },
      notebooks: {
        name: 'Notebooks',
        description: 'View notebook list',
      },
    },
    // PDF Import
    pdf: {
      uploading: 'Uploading PDF...',
      parsing: 'Parsing document...',
      extracting: 'Extracting images...',
      converting: 'Converting format...',
      processingFile: (current: number, total: number) => `Processing file ${current} of ${total}`,
      // TextIn service
      textinDescription: 'TextIn document parsing service, supports tables, formulas, and images',
      textinAppIdPlaceholder: 'Enter TextIn App ID',
      textinSecretCodePlaceholder: 'Enter TextIn Secret Code',
    },
    // Common
    common: {
      unknownError: 'Unknown error',
      contentTruncated: '[Content truncated...]',
    },
    // Export
    export: {
      nestingTooDeep: '(Nesting too deep)',
      mermaidSourceNote: 'Mermaid diagram source',
      untitledNote: 'Untitled Note',
      failedToLoadNote: 'Failed to load note',
      embeddedContent: 'Embedded content',
      noResults: 'No results',
      selectExportLocation: 'Select Export Location',
      exportMarkdown: 'Export Markdown',
      exportPDF: 'Export PDF',
      attachment: 'Attachment',
      reference: 'Reference',
      tableOfContents: 'Table of Contents',
      noHeadings: 'No headings found',
    },
  },
}

export type MainTranslations = typeof translations.zh

/**
 * Get translations for current app locale
 */
export function t(): MainTranslations {
  return translations[appLocale]
}

/**
 * Get translations for a specific language
 */
export function getTranslations(lang: Lang): MainTranslations {
  return translations[lang]
}
