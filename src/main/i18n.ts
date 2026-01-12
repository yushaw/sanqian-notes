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
- search_notes：搜索笔记（支持语义搜索，可限定笔记本范围）
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
   - 引用笔记时必须使用 markdown 链接格式，使用工具返回的 link 字段
   - 格式：[笔记标题](sanqian-notes://note/笔记ID)
   - 示例：详见 [项目周报](sanqian-notes://note/abc123) 第二节

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
- 引用笔记内容时务必附上链接，方便用户跳转查看原文
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
    },
    // SDK Tool descriptions
    tools: {
      searchNotes: {
        description: '搜索笔记。使用混合搜索（语义 + 关键词），返回最相关的结果。',
        queryDesc: '搜索关键词或自然语言查询',
        notebookIdDesc: '限制搜索范围的笔记本 ID（可选），不指定则搜索所有笔记',
        limitDesc: '返回结果的最大数量，默认 10',
        error: '搜索笔记失败',
      },
      getNote: {
        description: '获取笔记内容（Markdown 格式）。支持单个 ID 或 ID 数组批量获取。单个时可指定章节；批量时若某 ID 不存在则该项返回 {id, error}。',
        idDesc: '笔记 ID，支持单个字符串或 ID 数组',
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
        description: '获取笔记的大纲结构（所有标题列表）',
        idDesc: '笔记 ID',
        notFound: '笔记不存在',
        error: '获取大纲失败',
      },
      createNote: {
        description: '创建新笔记。content 使用 Markdown 格式。',
        titleDesc: '笔记标题',
        contentDesc: '笔记内容，使用 Markdown 格式',
        notebookIdDesc: '笔记本 ID（可选），如果不指定则创建在默认笔记本',
        success: '笔记创建成功',
        error: '创建笔记失败',
      },
      updateNote: {
        description: '更新笔记。支持三种模式：1) content 全量替换；2) append/prepend 追加；3) edit 精确替换。',
        idDesc: '笔记 ID',
        titleDesc: '新标题（可选）',
        contentDesc: '新内容（Markdown），会替换整个笔记内容',
        appendDesc: '追加到末尾的内容（Markdown）',
        prependDesc: '插入到开头的内容（Markdown）',
        editDesc: '精确替换：{old_string, new_string, replace_all?}',
        notFound: '笔记不存在',
        success: '笔记更新成功',
        editSuccess: '替换了 {count} 处',
        editNotFound: '未找到匹配内容。',
        editSimilarFound: '找到相似内容',
        editEmptyString: 'old_string 不能为空',
        editMultipleFound: '找到 {count} 处匹配，请使用 replace_all=true 或提供更精确的内容',
        noChanges: '没有需要更新的内容',
        error: '更新笔记失败',
      },
      deleteNote: {
        description: '删除笔记（移动到回收站）。这是危险操作，必须先获得用户确认。',
        idDesc: '笔记 ID',
        notFound: '笔记不存在',
        success: '笔记已移动到回收站',
        error: '删除笔记失败',
      },
      getTags: {
        description: '获取所有标签列表。',
        error: '获取标签失败',
      },
      getNotebooks: {
        description: '获取所有笔记本列表，包含笔记数量。',
        error: '获取笔记本失败',
      },
      moveNote: {
        description: '移动笔记到其他笔记本。',
        idDesc: '笔记 ID',
        notebookIdDesc: '目标笔记本 ID（null 表示移出笔记本）',
        notFound: '笔记不存在',
        notebookNotFound: '目标笔记本不存在',
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
- search_notes: Search notes (supports semantic search, can filter by notebook)
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
   - When referencing notes, always use markdown link format with the link field from tool results
   - Format: [Note Title](sanqian-notes://note/noteID)
   - Example: See [Project Report](sanqian-notes://note/abc123) section 2

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
- Always include note links when citing content, so users can jump to the source
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
    },
    // SDK Tool descriptions
    tools: {
      searchNotes: {
        description: 'Search notes. Uses hybrid search (semantic + keyword) to return the most relevant results.',
        queryDesc: 'Search keywords or natural language query',
        notebookIdDesc: 'Notebook ID to limit search scope (optional), searches all notes if not specified',
        limitDesc: 'Maximum number of results to return, default 10',
        error: 'Failed to search notes',
      },
      getNote: {
        description: 'Get note content (Markdown format). Supports single ID or array of IDs for batch fetch. Can specify heading when single; batch mode returns {id, error} for missing IDs.',
        idDesc: 'Note ID, supports single string or array of IDs',
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
        description: 'Get note outline structure (list of all headings)',
        idDesc: 'Note ID',
        notFound: 'Note not found',
        error: 'Failed to get outline',
      },
      createNote: {
        description: 'Create a new note. Use Markdown format for content.',
        titleDesc: 'Note title',
        contentDesc: 'Note content in Markdown format',
        notebookIdDesc: 'Notebook ID (optional), creates in default notebook if not specified',
        success: 'Note created successfully',
        error: 'Failed to create note',
      },
      updateNote: {
        description: 'Update a note. Three modes: 1) content for full replacement; 2) append/prepend for adding; 3) edit for precise replacement.',
        idDesc: 'Note ID',
        titleDesc: 'New title (optional)',
        contentDesc: 'New content (Markdown), replaces entire note content',
        appendDesc: 'Content to append at the end (Markdown)',
        prependDesc: 'Content to insert at the beginning (Markdown)',
        editDesc: 'Precise replacement: {old_string, new_string, replace_all?}',
        notFound: 'Note not found',
        success: 'Note updated successfully',
        editSuccess: 'Replaced {count} occurrence(s)',
        editNotFound: 'No matching content found.',
        editSimilarFound: 'Similar content found',
        editEmptyString: 'old_string cannot be empty',
        editMultipleFound: 'Found {count} matches, please use replace_all=true or provide more precise content',
        noChanges: 'No changes to update',
        error: 'Failed to update note',
      },
      deleteNote: {
        description: 'Delete a note (move to trash). This is a dangerous operation, must get user confirmation first.',
        idDesc: 'Note ID',
        notFound: 'Note not found',
        success: 'Note moved to trash',
        error: 'Failed to delete note',
      },
      getTags: {
        description: 'Get all tags list.',
        error: 'Failed to get tags',
      },
      getNotebooks: {
        description: 'Get all notebooks list with note counts.',
        error: 'Failed to get notebooks',
      },
      moveNote: {
        description: 'Move a note to another notebook.',
        idDesc: 'Note ID',
        notebookIdDesc: 'Target notebook ID (null to remove from notebook)',
        notFound: 'Note not found',
        notebookNotFound: 'Target notebook not found',
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
