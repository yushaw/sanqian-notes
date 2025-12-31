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
  const locale = app.getLocale().toLowerCase()
  return locale.startsWith('zh') ? 'zh' : 'en'
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
      assistantSystemPrompt: `你是一个专业的笔记助手，帮助用户管理他们的笔记。你可以：
1. 搜索笔记 - 使用 search_notes 工具（支持指定笔记本范围）
2. 查看笔记详情 - 使用 get_note 工具
3. 创建新笔记 - 使用 create_note 工具
4. 更新现有笔记 - 使用 update_note 工具
5. 删除笔记 - 使用 delete_note 工具（需要用户确认）
6. 查看所有笔记本 - 使用 get_notebooks 工具

注意事项：
- 删除笔记是危险操作，必须先询问用户确认
- 创建或更新笔记时，content 使用 Markdown 格式
- 搜索时，如果结果太多，建议用户提供更具体的关键词
- 始终以用户的需求为中心，提供清晰、准确的帮助`,
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
        description: '获取笔记的完整内容。用于查看笔记详情或在编辑前读取笔记。',
        idDesc: '笔记 ID',
        notFound: '笔记不存在',
        error: '获取笔记失败',
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
        description: '更新现有笔记的标题或内容。',
        idDesc: '笔记 ID',
        titleDesc: '新标题（可选）',
        contentDesc: '新内容，使用 Markdown 格式（可选）',
        notFound: '笔记不存在',
        success: '笔记更新成功',
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
        description: '获取所有笔记本列表。用于了解用户的笔记分类结构。',
        error: '获取笔记本失败',
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
    // Common
    common: {
      unknownError: '未知错误',
    },
  },
  en: {
    // SDK Agent descriptions
    sdk: {
      assistantName: 'Notes Assistant',
      assistantDescription: 'An intelligent assistant to help you manage notes - search, create, and edit',
      assistantSystemPrompt: `You are a professional notes assistant helping users manage their notes. You can:
1. Search notes - use the search_notes tool (supports filtering by notebook)
2. View note details - use the get_note tool
3. Create new notes - use the create_note tool
4. Update existing notes - use the update_note tool
5. Delete notes - use the delete_note tool (requires user confirmation)
6. View all notebooks - use the get_notebooks tool

Important notes:
- Deleting notes is a dangerous operation, always ask for user confirmation first
- When creating or updating notes, use Markdown format for content
- If search results are too many, suggest the user to provide more specific keywords
- Always focus on user needs and provide clear, accurate help`,
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
        description: 'Get the full content of a note. Used to view details or read before editing.',
        idDesc: 'Note ID',
        notFound: 'Note not found',
        error: 'Failed to get note',
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
        description: 'Update an existing note title or content.',
        idDesc: 'Note ID',
        titleDesc: 'New title (optional)',
        contentDesc: 'New content in Markdown format (optional)',
        notFound: 'Note not found',
        success: 'Note updated successfully',
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
        description: 'Get all notebooks list. Use to understand user\'s note organization structure.',
        error: 'Failed to get notebooks',
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
    // Common
    common: {
      unknownError: 'Unknown error',
    },
  },
}

export type MainTranslations = typeof translations.zh

/**
 * Get translations for current system language
 */
export function t(): MainTranslations {
  return translations[getSystemLang()]
}

/**
 * Get translations for a specific language
 */
export function getTranslations(lang: Lang): MainTranslations {
  return translations[lang]
}
