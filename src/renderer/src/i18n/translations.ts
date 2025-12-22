export type Language = 'zh' | 'en' | 'system'
export type ResolvedLanguage = 'zh' | 'en'

export interface Translations {
  app: {
    name: string
  }
  sidebar: {
    smartViews: string
    all: string
    daily: string
    recent: string
    favorites: string
    notebooks: string
    addNotebook: string
    collapse: string
    expand: string
    trash: string
    settings: string
  }
  trash: {
    title: string
    empty: string
    emptyTrash: string
    emptyConfirmTitle: string
    emptyConfirmMessage: string
    restore: string
    permanentDelete: string
    deleteConfirmTitle: string
    deleteConfirmMessage: string
    daysRemaining: string
  }
  noteList: {
    empty: string
    newNote: string
    untitled: string
    noContent: string
    search: string
    searchPlaceholder: string
    noResults: string
    pin: string
    unpin: string
    favorite: string
    unfavorite: string
    delete: string
    noteCount: string
    notesCount: string
  }
  editor: {
    selectNote: string
    createNew: string
    or: string
    createNewNote: string
    titlePlaceholder: string
    contentPlaceholder: string
  }
  toolbar: {
    bold: string
    italic: string
    strikethrough: string
    heading1: string
    heading2: string
    heading3: string
    bulletList: string
    numberedList: string
    checklist: string
    link: string
    code: string
    quote: string
    underline: string
    highlight: string
    color: string
  }
  settings: {
    title: string
    general: string
    appearance: string
    language: string
    languageDesc: string
    themeColor: string
    themeColorDesc: string
    theme: string
    themeDesc: string
    fontSize: string
    fontSizeDesc: string
    light: string
    dark: string
    system: string
    fontSizeSmall: string
    fontSizeNormal: string
    fontSizeLarge: string
    fontSizeExtraLarge: string
  }
  notebook: {
    selectIcon: string
    name: string
    namePlaceholder: string
    deleteConfirmTitle: string
    deleteConfirmMessage: string
  }
  actions: {
    add: string
    cancel: string
    save: string
    delete: string
    edit: string
    rename: string
  }
  date: {
    today: string
    yesterday: string
    dayBeforeYesterday: string
    daysAgo: string
  }
  typewriter: {
    fullscreen: string
    window: string
    exit: string
    wordCount: string
    typewriterMode: string
    focusMode: string
    sound: string
    soundOn: string
    soundOff: string
  }
  ai: {
    title: string
    placeholder: string
    greeting: string
    greetingDesc: string
    suggestion1: string
    suggestion2: string
    suggestion3: string
    newChat: string
    recentChats: string
    noHistory: string
    loadMore: string
    delete: string
    close: string
    session: string
    thinking: string
  }
  tray: {
    show: string
    quit: string
  }
  common: {
    loading: string
  }
  noteLink: {
    create: string
    noResults: string
    searchHeadingHint: string
    searchBlockHint: string
  }
  emoji: {
    loading: string
    noResults: string
  }
  slashCommand: {
    paragraph: string
    paragraphDesc: string
    heading1: string
    heading1Desc: string
    heading2: string
    heading2Desc: string
    heading3: string
    heading3Desc: string
    bulletList: string
    bulletListDesc: string
    numberedList: string
    numberedListDesc: string
    taskList: string
    taskListDesc: string
    quote: string
    quoteDesc: string
    codeBlock: string
    codeBlockDesc: string
    divider: string
    dividerDesc: string
    table: string
    tableDesc: string
    toggle: string
    toggleDesc: string
    calloutNote: string
    calloutNoteDesc: string
    calloutTip: string
    calloutTipDesc: string
    calloutWarning: string
    calloutWarningDesc: string
    calloutDanger: string
    calloutDangerDesc: string
    math: string
    mathDesc: string
    mermaid: string
    mermaidDesc: string
    footnote: string
    footnoteDesc: string
    image: string
    imageDesc: string
    file: string
    fileDesc: string
    noMatches: string
  }
  codeBlock: {
    searchPlaceholder: string
    noMatch: string
    copy: string
    copied: string
    copyCode: string
  }
  callout: {
    note: string
    tip: string
    warning: string
    danger: string
    info: string
    quote: string
  }
  colors: {
    default: string
    gray: string
    red: string
    orange: string
    yellow: string
    green: string
    blue: string
    purple: string
    pink: string
    textColor: string
    backgroundColor: string
  }
  media: {
    audio: string
    attachment: string
    toggleExpand: string
    emptyHeading: string
    footnoteHint: string
    footnotePlaceholder: string
    mermaidPlaceholder: string
    mermaidError: string
    doubleClickEdit: string
    imageLoadFailed: string
    alignLeft: string
    alignCenter: string
    alignRight: string
    editFormula: string
    openFile: string
    showInFolder: string
  }
  toc: {
    title: string
  }
  shortcuts: {
    title: string
    textFormat: string
    blocks: string
    editing: string
    bold: string
    italic: string
    underline: string
    strikethrough: string
    highlight: string
    inlineCode: string
    slashCommand: string
    codeBlock: string
    mathFormula: string
    noteLink: string
    undo: string
    redo: string
    save: string
    newNote: string
  }
  contextMenu: {
    cut: string
    copy: string
    paste: string
    paragraph: string
    insert: string
    bulletList: string
    numberedList: string
    taskList: string
    quote: string
    codeBlock: string
    divider: string
    table: string
    callout: string
  }
  fileError: {
    tooLarge: string
    tooLargeDetail: string
    insertFailed: string
  }
}

const zh: Translations = {
  app: {
    name: '散墨笔记'
  },
  sidebar: {
    smartViews: '智能视图',
    all: '全部笔记',
    daily: '每日笔记',
    recent: '最近编辑',
    favorites: '收藏',
    notebooks: '笔记本',
    addNotebook: '新建笔记本',
    collapse: '收起',
    expand: '展开',
    trash: '回收站',
    settings: '设置'
  },
  trash: {
    title: '回收站',
    empty: '回收站是空的',
    emptyTrash: '清空回收站',
    emptyConfirmTitle: '清空回收站',
    emptyConfirmMessage: '确定要清空回收站吗？所有笔记将被永久删除，此操作无法撤销。',
    restore: '恢复',
    permanentDelete: '永久删除',
    deleteConfirmTitle: '永久删除',
    deleteConfirmMessage: '确定要永久删除「{name}」吗？此操作无法撤销。',
    daysRemaining: '{n} 天后自动删除'
  },
  noteList: {
    empty: '暂无笔记',
    newNote: '新建笔记',
    untitled: '无标题',
    noContent: '暂无内容',
    search: '搜索',
    searchPlaceholder: '搜索笔记...',
    noResults: '无搜索结果',
    pin: '置顶',
    unpin: '取消置顶',
    favorite: '收藏',
    unfavorite: '取消收藏',
    delete: '删除',
    noteCount: '{n} 篇笔记',
    notesCount: '{n} 篇笔记'
  },
  editor: {
    selectNote: '选择一篇笔记开始编辑',
    createNew: '或创建新笔记',
    or: '或',
    createNewNote: '创建新笔记',
    titlePlaceholder: '无标题',
    contentPlaceholder: '开始输入...'
  },
  toolbar: {
    bold: '加粗',
    italic: '斜体',
    strikethrough: '删除线',
    heading1: '标题 1',
    heading2: '标题 2',
    heading3: '标题 3',
    bulletList: '无序列表',
    numberedList: '有序列表',
    checklist: '任务列表',
    link: '链接',
    code: '行内代码',
    quote: '引用',
    underline: '下划线',
    highlight: '高亮',
    color: '颜色'
  },
  settings: {
    title: '设置',
    general: '通用',
    appearance: '外观',
    language: '语言',
    languageDesc: '选择界面显示语言',
    themeColor: '主题色',
    themeColorDesc: '选择界面主题颜色',
    theme: '外观模式',
    themeDesc: '选择浅色或深色模式',
    fontSize: '字号',
    fontSizeDesc: '调整界面字体大小',
    light: '浅色',
    dark: '深色',
    system: '跟随系统',
    fontSizeSmall: '小',
    fontSizeNormal: '标准',
    fontSizeLarge: '大',
    fontSizeExtraLarge: '特大'
  },
  notebook: {
    selectIcon: '图标',
    name: '名称',
    namePlaceholder: '笔记本名称',
    deleteConfirmTitle: '删除笔记本',
    deleteConfirmMessage: '确定要删除「{name}」吗？该笔记本下的所有笔记都会被删除，此操作无法撤销。'
  },
  actions: {
    add: '添加',
    cancel: '取消',
    save: '保存',
    delete: '删除',
    edit: '编辑',
    rename: '重命名'
  },
  date: {
    today: '今天',
    yesterday: '昨天',
    dayBeforeYesterday: '前天',
    daysAgo: '{n}天前'
  },
  typewriter: {
    fullscreen: '全屏',
    window: '窗口',
    exit: '退出',
    wordCount: '字',
    typewriterMode: '打字机',
    focusMode: '专注',
    sound: '音效',
    soundOn: '开启打字音效',
    soundOff: '关闭打字音效',
  },
  ai: {
    title: 'AI 助手',
    placeholder: '输入消息，按 Enter 发送...',
    greeting: '你好！我是 AI 助手',
    greetingDesc: '我可以帮你搜索、创建和管理笔记',
    suggestion1: '搜索笔记...',
    suggestion2: '创建一个新笔记',
    suggestion3: '帮我改进这段文字',
    newChat: '新对话',
    recentChats: '最近的对话',
    noHistory: '暂无历史对话',
    loadMore: '加载更多',
    delete: '删除',
    close: '关闭',
    session: 'AI 会话',
    thinking: '思考中',
  },
  tray: {
    show: '显示窗口',
    quit: '退出'
  },
  common: {
    loading: '加载中...'
  },
  noteLink: {
    create: '创建「{name}」',
    noResults: '没有找到匹配项',
    searchHeadingHint: '在「{name}」中搜索标题',
    searchBlockHint: '在「{name}」中搜索段落'
  },
  emoji: {
    loading: '加载中...',
    noResults: '没有找到表情'
  },
  slashCommand: {
    paragraph: '正文',
    paragraphDesc: '普通段落文本',
    heading1: '标题 1',
    heading1Desc: '大标题',
    heading2: '标题 2',
    heading2Desc: '中标题',
    heading3: '标题 3',
    heading3Desc: '小标题',
    bulletList: '无序列表',
    bulletListDesc: '项目符号列表',
    numberedList: '有序列表',
    numberedListDesc: '编号列表',
    taskList: '待办事项',
    taskListDesc: '可勾选的任务列表',
    quote: '引用',
    quoteDesc: '引用块',
    codeBlock: '代码块',
    codeBlockDesc: '代码片段',
    divider: '分割线',
    dividerDesc: '水平分割线',
    table: '表格',
    tableDesc: '插入表格',
    toggle: '折叠块',
    toggleDesc: '可展开/收起的内容块',
    calloutNote: '提示 (Note)',
    calloutNoteDesc: '蓝色信息提示框',
    calloutTip: '提示 (Tip)',
    calloutTipDesc: '绿色技巧提示框',
    calloutWarning: '警告 (Warning)',
    calloutWarningDesc: '黄色警告提示框',
    calloutDanger: '危险 (Danger)',
    calloutDangerDesc: '红色危险提示框',
    math: '数学公式',
    mathDesc: '插入 LaTeX 数学公式 (使用 $...$)',
    mermaid: 'Mermaid 图表',
    mermaidDesc: '插入流程图、时序图等',
    footnote: '脚注',
    footnoteDesc: '插入脚注引用',
    image: '图片',
    imageDesc: '从本地选择图片插入',
    file: '文件',
    fileDesc: '插入本地文件附件',
    noMatches: '没有匹配的命令'
  },
  codeBlock: {
    searchPlaceholder: '搜索语言...',
    noMatch: '没有找到匹配的语言',
    copy: '复制',
    copied: '已复制',
    copyCode: '复制代码'
  },
  callout: {
    note: '笔记',
    tip: '提示',
    warning: '警告',
    danger: '危险',
    info: '信息',
    quote: '引用'
  },
  colors: {
    default: '默认',
    gray: '灰色',
    red: '红色',
    orange: '橙色',
    yellow: '黄色',
    green: '绿色',
    blue: '蓝色',
    purple: '紫色',
    pink: '粉色',
    textColor: '文字颜色',
    backgroundColor: '背景颜色'
  },
  media: {
    audio: '音频',
    attachment: '附件',
    toggleExpand: '点击展开',
    emptyHeading: '(空标题)',
    footnoteHint: 'ESC 或点击外部关闭',
    footnotePlaceholder: '输入脚注内容...',
    mermaidPlaceholder: '输入 Mermaid 代码...',
    mermaidError: '渲染失败',
    doubleClickEdit: '双击编辑',
    imageLoadFailed: '图片加载失败',
    alignLeft: '左对齐',
    alignCenter: '居中',
    alignRight: '右对齐',
    editFormula: '点击编辑公式',
    openFile: '打开文件',
    showInFolder: '在文件夹中显示'
  },
  toc: {
    title: '目录'
  },
  shortcuts: {
    title: '快捷键',
    textFormat: '文本格式',
    blocks: '块元素',
    editing: '编辑操作',
    bold: '粗体',
    italic: '斜体',
    underline: '下划线',
    strikethrough: '删除线',
    highlight: '高亮',
    inlineCode: '行内代码',
    slashCommand: '插入命令',
    codeBlock: '代码块',
    mathFormula: '数学公式',
    noteLink: '双向链接',
    undo: '撤销',
    redo: '重做',
    save: '保存',
    newNote: '新建笔记'
  },
  contextMenu: {
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    paragraph: '正文',
    insert: '插入',
    bulletList: '无序列表',
    numberedList: '有序列表',
    taskList: '待办事项',
    quote: '引用',
    codeBlock: '代码块',
    divider: '分割线',
    table: '表格',
    callout: '提示块'
  },
  fileError: {
    tooLarge: '文件过大',
    tooLargeDetail: '文件大小 {size}MB 超过 100MB 限制',
    insertFailed: '插入文件失败'
  }
}

const en: Translations = {
  app: {
    name: 'Sanqian Notes'
  },
  sidebar: {
    smartViews: 'Smart Views',
    all: 'All Notes',
    daily: 'Daily Notes',
    recent: 'Recent',
    favorites: 'Favorites',
    notebooks: 'Notebooks',
    addNotebook: 'New Notebook',
    collapse: 'Collapse',
    expand: 'Expand',
    trash: 'Trash',
    settings: 'Settings'
  },
  trash: {
    title: 'Trash',
    empty: 'Trash is empty',
    emptyTrash: 'Empty Trash',
    emptyConfirmTitle: 'Empty Trash',
    emptyConfirmMessage: 'Are you sure you want to empty the trash? All notes will be permanently deleted. This action cannot be undone.',
    restore: 'Restore',
    permanentDelete: 'Delete Permanently',
    deleteConfirmTitle: 'Delete Permanently',
    deleteConfirmMessage: 'Are you sure you want to permanently delete "{name}"? This action cannot be undone.',
    daysRemaining: 'Auto-delete in {n} days'
  },
  noteList: {
    empty: 'No notes yet',
    newNote: 'New Note',
    untitled: 'Untitled',
    noContent: 'No content',
    search: 'Search',
    searchPlaceholder: 'Search notes...',
    noResults: 'No results found',
    pin: 'Pin to Top',
    unpin: 'Unpin',
    favorite: 'Favorite',
    unfavorite: 'Unfavorite',
    delete: 'Delete',
    noteCount: '{n} note',
    notesCount: '{n} notes'
  },
  editor: {
    selectNote: 'Select a note to start editing',
    createNew: 'or create a new one',
    or: 'or',
    createNewNote: 'Create a New Note',
    titlePlaceholder: 'Untitled',
    contentPlaceholder: 'Start typing...'
  },
  toolbar: {
    bold: 'Bold',
    italic: 'Italic',
    strikethrough: 'Strikethrough',
    heading1: 'Heading 1',
    heading2: 'Heading 2',
    heading3: 'Heading 3',
    bulletList: 'Bullet List',
    numberedList: 'Numbered List',
    checklist: 'Checklist',
    link: 'Link',
    code: 'Inline Code',
    quote: 'Quote',
    underline: 'Underline',
    highlight: 'Highlight',
    color: 'Color'
  },
  settings: {
    title: 'Settings',
    general: 'General',
    appearance: 'Appearance',
    language: 'Language',
    languageDesc: 'Choose display language',
    themeColor: 'Theme Color',
    themeColorDesc: 'Choose accent color',
    theme: 'Appearance',
    themeDesc: 'Choose light or dark mode',
    fontSize: 'Font Size',
    fontSizeDesc: 'Adjust interface font size',
    light: 'Light',
    dark: 'Dark',
    system: 'System',
    fontSizeSmall: 'Small',
    fontSizeNormal: 'Normal',
    fontSizeLarge: 'Large',
    fontSizeExtraLarge: 'Extra Large'
  },
  notebook: {
    selectIcon: 'Icon',
    name: 'Name',
    namePlaceholder: 'Notebook name',
    deleteConfirmTitle: 'Delete Notebook',
    deleteConfirmMessage: 'Are you sure you want to delete "{name}"? All notes in this notebook will be deleted. This action cannot be undone.'
  },
  actions: {
    add: 'Add',
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    rename: 'Rename'
  },
  date: {
    today: 'Today',
    yesterday: 'Yesterday',
    dayBeforeYesterday: '2 days ago',
    daysAgo: '{n} days ago'
  },
  typewriter: {
    fullscreen: 'Fullscreen',
    window: 'Window',
    exit: 'Exit',
    wordCount: 'words',
    typewriterMode: 'Typewriter',
    focusMode: 'Focus',
    sound: 'Sound',
    soundOn: 'Enable typing sound',
    soundOff: 'Disable typing sound',
  },
  ai: {
    title: 'AI Assistant',
    placeholder: 'Type a message, press Enter to send...',
    greeting: 'Hello! I am your AI Assistant',
    greetingDesc: 'I can help you search, create, and manage notes',
    suggestion1: 'Search notes...',
    suggestion2: 'Create a new note',
    suggestion3: 'Help me improve this text',
    newChat: 'New Chat',
    recentChats: 'Recent Chats',
    noHistory: 'No chat history',
    loadMore: 'Load More',
    delete: 'Delete',
    close: 'Close',
    session: 'AI Session',
    thinking: 'Thinking',
  },
  tray: {
    show: 'Show Window',
    quit: 'Quit'
  },
  common: {
    loading: 'Loading...'
  },
  noteLink: {
    create: 'Create "{name}"',
    noResults: 'No matches found',
    searchHeadingHint: 'Search headings in "{name}"',
    searchBlockHint: 'Search blocks in "{name}"'
  },
  emoji: {
    loading: 'Loading...',
    noResults: 'No emoji found'
  },
  slashCommand: {
    paragraph: 'Paragraph',
    paragraphDesc: 'Plain text paragraph',
    heading1: 'Heading 1',
    heading1Desc: 'Large heading',
    heading2: 'Heading 2',
    heading2Desc: 'Medium heading',
    heading3: 'Heading 3',
    heading3Desc: 'Small heading',
    bulletList: 'Bullet List',
    bulletListDesc: 'Unordered list',
    numberedList: 'Numbered List',
    numberedListDesc: 'Ordered list',
    taskList: 'Task List',
    taskListDesc: 'Checkable todo list',
    quote: 'Quote',
    quoteDesc: 'Block quote',
    codeBlock: 'Code Block',
    codeBlockDesc: 'Code snippet',
    divider: 'Divider',
    dividerDesc: 'Horizontal line',
    table: 'Table',
    tableDesc: 'Insert table',
    toggle: 'Toggle',
    toggleDesc: 'Collapsible content block',
    calloutNote: 'Note',
    calloutNoteDesc: 'Blue info callout',
    calloutTip: 'Tip',
    calloutTipDesc: 'Green tip callout',
    calloutWarning: 'Warning',
    calloutWarningDesc: 'Yellow warning callout',
    calloutDanger: 'Danger',
    calloutDangerDesc: 'Red danger callout',
    math: 'Math',
    mathDesc: 'Insert LaTeX formula (use $...$)',
    mermaid: 'Mermaid',
    mermaidDesc: 'Insert flowchart, sequence diagram, etc.',
    footnote: 'Footnote',
    footnoteDesc: 'Insert footnote reference',
    image: 'Image',
    imageDesc: 'Select and insert local image',
    file: 'File',
    fileDesc: 'Insert local file attachment',
    noMatches: 'No matching commands'
  },
  codeBlock: {
    searchPlaceholder: 'Search language...',
    noMatch: 'No matching language found',
    copy: 'Copy',
    copied: 'Copied',
    copyCode: 'Copy code'
  },
  callout: {
    note: 'Note',
    tip: 'Tip',
    warning: 'Warning',
    danger: 'Danger',
    info: 'Info',
    quote: 'Quote'
  },
  colors: {
    default: 'Default',
    gray: 'Gray',
    red: 'Red',
    orange: 'Orange',
    yellow: 'Yellow',
    green: 'Green',
    blue: 'Blue',
    purple: 'Purple',
    pink: 'Pink',
    textColor: 'Text Color',
    backgroundColor: 'Background Color'
  },
  media: {
    audio: 'Audio',
    attachment: 'Attachment',
    toggleExpand: 'Click to expand',
    emptyHeading: '(Empty heading)',
    footnoteHint: 'ESC or click outside to close',
    footnotePlaceholder: 'Enter footnote content...',
    mermaidPlaceholder: 'Enter Mermaid code...',
    mermaidError: 'Render failed',
    doubleClickEdit: 'Double-click to edit',
    imageLoadFailed: 'Image load failed',
    alignLeft: 'Align left',
    alignCenter: 'Center',
    alignRight: 'Align right',
    editFormula: 'Click to edit formula',
    openFile: 'Open file',
    showInFolder: 'Show in folder'
  },
  toc: {
    title: 'Contents'
  },
  shortcuts: {
    title: 'Shortcuts',
    textFormat: 'Text Format',
    blocks: 'Blocks',
    editing: 'Editing',
    bold: 'Bold',
    italic: 'Italic',
    underline: 'Underline',
    strikethrough: 'Strikethrough',
    highlight: 'Highlight',
    inlineCode: 'Inline Code',
    slashCommand: 'Slash Command',
    codeBlock: 'Code Block',
    mathFormula: 'Math Formula',
    noteLink: 'Note Link',
    undo: 'Undo',
    redo: 'Redo',
    save: 'Save',
    newNote: 'New Note'
  },
  contextMenu: {
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    paragraph: 'Paragraph',
    insert: 'Insert',
    bulletList: 'Bullet List',
    numberedList: 'Numbered List',
    taskList: 'Task List',
    quote: 'Quote',
    codeBlock: 'Code Block',
    divider: 'Divider',
    table: 'Table',
    callout: 'Callout'
  },
  fileError: {
    tooLarge: 'File too large',
    tooLargeDetail: 'File size {size}MB exceeds 100MB limit',
    insertFailed: 'Failed to insert file'
  }
}

export const translations = { zh, en }

export function getSystemLanguage(): ResolvedLanguage {
  const lang = navigator.language.toLowerCase()
  if (lang.startsWith('zh')) return 'zh'
  return 'en'
}

export function getTranslations(lang: Language): Translations {
  if (lang === 'system') {
    return translations[getSystemLanguage()]
  }
  return translations[lang]
}
