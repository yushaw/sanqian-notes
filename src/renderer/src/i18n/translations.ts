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
    move: string
    allNotes: string
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
    heading4: string
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
    ai: string
    about: string
    data: string
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
    version: string
    checkUpdate: string
    feedback: string
    github: string
    discord: string
    copyright: string
    updating: {
      checking: string
      available: (version: string) => string
      downloading: (progress: number) => string
      ready: string
      upToDate: string
      error: string
    }
    buttons: {
      download: string
      restart: string
      retry: string
    }
    aiActions: {
      title: string
      description: string
      loading: string
      add: string
      addAction: string
      editAction: string
      icon: string
      name: string
      namePlaceholder: string
      prompt: string
      promptPlaceholder: string
      mode: string
      modeReplace: string
      modeInsert: string
      modePopup: string
      showIn: string
      contextMenu: string
      slashCommand: string
      shortcut: string
      shortcutKey: string
      pressKey: string
      noShortcut: string
      shortcutConflict: string
      save: string
      saving: string
      cancel: string
      done: string
      builtin: string
      empty: string
      resetToDefaults: string
      resetConfirm: string
      reset: string
    }
    knowledgeBase: {
      title: string
      description: string
      enable: string
      enableDesc: string
      provider: string
      custom: string
      apiKey: string
      apiKeyPlaceholder: string
      apiUrl: string
      modelName: string
      dimensions: string
      testConnection: string
      testing: string
      testSuccess: (dimensions: number) => string
      testFailed: string
      stats: string
      totalChunks: string
      totalEmbeddings: string
      indexedNotes: string
      pendingNotes: string
      errorNotes: string
      lastIndexedTime: string
      never: string
      clearIndex: string
      clearConfirm: string
      clearing: string
      rebuildIndex: string
      rebuildConfirm: string
      rebuilding: string
      rebuildProgress: (current: number, total: number) => string
      queueStatus: string
      processing: string
      waiting: string
      getApiKey: string
      dimensionsChangedWarning: string
      modelChangedRebuild: string
      source: string
      sourceSanqian: string
      sourceCustom: string
      fetchingSanqian: string
      sanqianConnected: string
      sanqianNotConfigured: string
      sanqianNotConfiguredHint: string
      sanqianVersionTooOld: string
      sanqianVersionTooOldHint: string
      refreshSanqian: string
      retryFetch: string
      presets: {
        openaiSmall: string
        openaiLarge: string
        zhipu: string
        ollama: string
        custom: string
      }
    }
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
    enable: string
    disable: string
    next: string
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
    connecting: string
    connectionFailed: string
    ensureSanqianRunning: string
    visitSanqian: string
    retry: string
    chat: string
    selectConversation: string
    arguments: string
    result: string
    executeTool: string
    toolLabel: string
    argsLabel: string
    defaultPrefix: string
    enterResponse: string
    executing: string
    approve: string
    reject: string
    submit: string
    rememberChoice: string
    requiredField: string
    timeoutIn: string
    seconds: string
    // Error messages
    errorConnectionFailed: string
    errorTimeout: string
    errorAuthFailed: string
    errorGeneric: string
    errorDisconnected: string
    // Context message
    continueContextTemplate: string
    // Preview actions
    previewAccept: string
    previewReject: string
    previewRegenerate: string
    // Popup actions
    copied: string
    copyFailed: string
  }
  tray: {
    show: string
    quit: string
  }
  common: {
    loading: string
    collapse: string
    expand: string
    unknownError: string
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
    // Group headers
    formatGroup: string
    aiGroup: string
    aiActionDesc: string
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
    // Table operations
    tableOperations: string
    addRowBefore: string
    addRowAfter: string
    deleteRow: string
    addColumnBefore: string
    addColumnAfter: string
    deleteColumn: string
    deleteTable: string
    // AI operations
    ai: string
    aiImprove: string
    aiSimplify: string
    aiExpand: string
    aiTranslate: string
    aiSummarize: string
    aiExplain: string
    aiCustom: string
    aiCustomPlaceholder: string
    aiProcessing: string
    aiError: string
    aiContinueInChat: string
  }
  fileError: {
    tooLarge: string
    tooLargeDetail: string
    tooLargeWithName: string
    insertFailed: string
    insertFailedWithName: string
    insertImageFailed: string
    insertFileFailed: string
    cannotOpen: string
  }
  ui: {
    dragToMove: string
    clickToReset: string
    processing: string
    noPopupId: string
    noContent: string
  }
  language: {
    chinese: string
    english: string
    system: string
  }
  importExport: {
    // Tab
    dataManagement: string
    // 导入
    import: string
    importDescription: string
    importButton: string
    // 导入来源选项
    importFrom: string
    markdownImport: string
    markdownImportDesc: string
    notionImport: string
    notionImportDesc: string
    notionExportGuide: string
    obsidianImport: string
    obsidianImportDesc: string
    obsidianImportHint: string
    // 导出
    export: string
    exportDescription: string
    exportButton: string
    // 导入对话框
    selectSource: string
    browse: string
    detected: string
    noteCount: string
    attachmentCount: string
    folderStrategy: string
    folderStrategyFirstLevel: string
    folderStrategyFirstLevelDesc: string
    folderStrategyFlattenPath: string
    folderStrategyFlattenPathDesc: string
    folderStrategySingleNotebook: string
    folderStrategySingleNotebookDesc: string
    selectNotebook: string
    tagStrategy: string
    tagStrategyKeepNested: string
    tagStrategyFlattenAll: string
    tagStrategyFirstLevel: string
    conflictStrategy: string
    conflictSkip: string
    conflictRename: string
    conflictOverwrite: string
    importAttachments: string
    parseFrontMatter: string
    startImport: string
    // 导出对话框
    exportRange: string
    exportAll: string
    exportCurrentNotebook: string
    exportSelected: string
    exportFormat: string
    formatMarkdown: string
    formatJson: string
    groupByNotebook: string
    includeAttachments: string
    includeFrontMatter: string
    asZip: string
    outputLocation: string
    startExport: string
    // 进度和结果
    importing: string
    exporting: string
    importComplete: string
    exportComplete: string
    importedNotes: string
    exportedNotes: string
    skippedFiles: string
    createdNotebooks: string
    errors: string
    viewDetails: string
    close: string
    // 错误信息
    noSourceSelected: string
    noTargetSelected: string
    importFailed: string
    exportFailed: string
  }
}

const zh: Translations = {
  app: {
    name: '心流'
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
    notesCount: '{n} 篇笔记',
    move: '移动',
    allNotes: '全部笔记'
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
    heading4: '标题 4',
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
    ai: 'AI',
    about: '关于',
    data: '导入/导出',
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
    fontSizeExtraLarge: '特大',
    version: '版本',
    checkUpdate: '检查更新',
    feedback: '反馈建议',
    github: 'GitHub',
    discord: 'Discord',
    copyright: '© 2026 心流. All rights reserved.',
    updating: {
      checking: '正在检查更新...',
      available: (version: string) => `发现新版本 ${version}`,
      downloading: (progress: number) => `正在下载更新 ${progress}%`,
      ready: '更新已就绪，重启后生效',
      upToDate: '当前已是最新版本',
      error: '检查更新失败'
    },
    buttons: {
      download: '下载更新',
      restart: '重启应用',
      retry: '重试'
    },
    aiActions: {
      title: 'AI 操作',
      description: '自定义选中文本的 AI 操作',
      loading: '加载中...',
      add: '添加',
      addAction: '添加操作',
      editAction: '编辑操作',
      icon: '图标',
      name: '名称',
      namePlaceholder: '操作名称',
      prompt: '提示词',
      promptPlaceholder: 'AI 指令...',
      mode: '模式',
      modeReplace: '替换',
      modeInsert: '插入',
      modePopup: '弹窗',
      showIn: '显示位置',
      contextMenu: '右键菜单',
      slashCommand: '斜杠命令',
      shortcut: '快捷面板',
      shortcutKey: '快捷键',
      pressKey: '按下快捷键...',
      noShortcut: '点击设置',
      shortcutConflict: '与「{name}」冲突',
      save: '保存',
      saving: '保存中...',
      cancel: '取消',
      done: '完成',
      builtin: '内置',
      empty: '暂无 AI 操作',
      resetToDefaults: '恢复默认',
      resetConfirm: '这将删除所有自定义操作，确定继续？',
      reset: '恢复'
    },
    knowledgeBase: {
      title: '知识库',
      description: '使用向量索引增强语义搜索能力',
      enable: '启用知识库',
      enableDesc: '启用后将自动为笔记创建向量索引',
      provider: 'Embedding 服务',
      custom: '自定义',
      apiKey: 'API Key',
      apiKeyPlaceholder: '输入 API Key',
      apiUrl: 'API 地址',
      modelName: '模型名称',
      dimensions: '向量维度',
      testConnection: '测试连接',
      testing: '测试中...',
      testSuccess: (dimensions: number) => `连接成功 (维度: ${dimensions})`,
      testFailed: '连接失败',
      stats: '索引统计',
      totalChunks: '文本块',
      totalEmbeddings: '向量数',
      indexedNotes: '已索引',
      pendingNotes: '待处理',
      errorNotes: '错误',
      lastIndexedTime: '最后索引',
      never: '从未',
      clearIndex: '清空索引',
      clearConfirm: '确定要清空所有索引数据吗？',
      clearing: '清空中...',
      rebuildIndex: '重建索引',
      rebuildConfirm: '确定要重建所有笔记的索引吗？这可能需要一些时间。',
      rebuilding: '重建中...',
      rebuildProgress: (current: number, total: number) => `${current} / ${total}`,
      queueStatus: '队列状态',
      processing: '处理中',
      waiting: '等待中',
      getApiKey: '获取 API Key',
      dimensionsChangedWarning: '向量维度已变更，索引已清空',
      modelChangedRebuild: '模型已变更，正在重建索引...',
      source: '配置来源',
      sourceSanqian: '使用三千配置',
      sourceCustom: '自定义配置',
      fetchingSanqian: '正在获取三千配置...',
      sanqianConnected: '已连接到三千',
      sanqianNotConfigured: '三千未配置 Embedding',
      sanqianNotConfiguredHint: '请先在三千中配置 Embedding 模型，或切换到自定义模式',
      sanqianVersionTooOld: '三千版本过低，请升级',
      sanqianVersionTooOldHint: '请访问 Sanqian.io 下载升级',
      refreshSanqian: '刷新',
      retryFetch: '重试',
      presets: {
        openaiSmall: 'OpenAI text-embedding-3-small',
        openaiLarge: 'OpenAI text-embedding-3-large',
        zhipu: '智谱 embedding-3',
        ollama: 'Ollama 本地模型',
        custom: '自定义'
      }
    }
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
    rename: '重命名',
    enable: '启用',
    disable: '禁用',
    next: '下一步'
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
    connecting: '正在连接...',
    connectionFailed: '无法连接到 AI 服务',
    ensureSanqianRunning: '请确保 Sanqian 已安装并运行。',
    visitSanqian: '访问 sanqian.io',
    retry: '重试',
    chat: 'AI 对话',
    selectConversation: '选择一个对话继续...',
    arguments: '参数',
    result: '结果',
    executeTool: '执行',
    toolLabel: '工具',
    argsLabel: '参数',
    defaultPrefix: '默认',
    enterResponse: '输入你的回复...',
    executing: '执行中...',
    approve: '同意',
    reject: '拒绝',
    submit: '提交',
    rememberChoice: '记住此选择',
    requiredField: '此字段为必填项',
    timeoutIn: '超时倒计时',
    seconds: '秒',
    // Error messages
    errorConnectionFailed: '连接失败，请确保三千已启动',
    errorTimeout: '连接超时，请重试',
    errorAuthFailed: '认证失败，请重新登录',
    errorGeneric: '连接出错，请重试',
    errorDisconnected: '连接已断开，请重试',
    // Context message
    continueContextTemplate: '我选中了以下文本：\n\n> {selectedText}\n\nAI 给出的解释是：\n\n{explanation}\n\n请继续帮我深入理解这个内容。',
    // Preview actions
    previewAccept: '接受',
    previewReject: '拒绝',
    previewRegenerate: '重试',
    // Popup actions
    copied: '已复制',
    copyFailed: '复制失败',
  },
  tray: {
    show: '显示窗口',
    quit: '退出'
  },
  common: {
    loading: '加载中...',
    collapse: '收起',
    expand: '展开',
    unknownError: '未知错误',
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
    noMatches: '没有匹配的命令',
    formatGroup: '格式',
    aiGroup: 'AI 操作',
    aiActionDesc: '使用 AI 处理选中文本'
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
    callout: '提示块',
    tableOperations: '表格操作',
    addRowBefore: '在上方插入行',
    addRowAfter: '在下方插入行',
    deleteRow: '删除行',
    addColumnBefore: '在左侧插入列',
    addColumnAfter: '在右侧插入列',
    deleteColumn: '删除列',
    deleteTable: '删除表格',
    ai: 'AI',
    aiImprove: '润色改写',
    aiSimplify: '简化语言',
    aiExpand: '扩写详述',
    aiTranslate: '翻译',
    aiSummarize: '总结摘要',
    aiExplain: '解释说明',
    aiCustom: '自由输入...',
    aiCustomPlaceholder: '让 AI 帮你...',
    aiProcessing: 'AI 处理中...',
    aiError: 'AI 处理失败',
    aiContinueInChat: '继续对话'
  },
  fileError: {
    tooLarge: '文件过大',
    tooLargeDetail: '文件大小 {size}MB 超过 100MB 限制',
    tooLargeWithName: '文件过大：{name}\n文件大小 {size}MB 超过 100MB 限制',
    insertFailed: '插入文件失败',
    insertFailedWithName: '文件插入失败：{name}',
    insertImageFailed: '插入图片失败：{error}',
    insertFileFailed: '插入文件失败：{error}',
    cannotOpen: '无法打开文件：{name}\n文件可能已被移动或删除'
  },
  ui: {
    dragToMove: '拖动移动',
    clickToReset: '点击复位',
    processing: '处理中...',
    noPopupId: '缺少弹窗 ID',
    noContent: '暂无内容'
  },
  language: {
    chinese: '中文',
    english: 'English',
    system: '跟随系统'
  },
  importExport: {
    // Tab
    dataManagement: '数据管理',
    // 导入
    import: '导入笔记',
    importDescription: '从其他笔记应用迁移数据到心流',
    importButton: '导入笔记...',
    // 导入来源选项
    importFrom: '选择导入来源',
    markdownImport: 'Markdown',
    markdownImportDesc: '导入 .md 文件或文件夹',
    notionImport: 'Notion',
    notionImportDesc: '选择 Markdown & CSV 格式导出的 ZIP 文件',
    notionExportGuide: '如何从 Notion 导出？',
    obsidianImport: 'Obsidian',
    obsidianImportDesc: '导入 Obsidian 库文件夹',
    obsidianImportHint: '选择你的 Obsidian vault 文件夹，通常包含 .obsidian 目录',
    // 导出
    export: '导出笔记',
    exportDescription: '将笔记导出为 Markdown 文件或 JSON 备份',
    exportButton: '导出笔记...',
    // 导入对话框
    selectSource: '选择来源',
    browse: '浏览...',
    detected: '检测到',
    noteCount: '{n} 篇笔记',
    attachmentCount: '{n} 个附件',
    folderStrategy: '文件夹处理',
    folderStrategyFirstLevel: '第一级文件夹作为笔记本',
    folderStrategyFirstLevelDesc: '推荐用于整理好的文件夹结构',
    folderStrategyFlattenPath: '完整路径作为笔记本名',
    folderStrategyFlattenPathDesc: '保留完整的文件夹层级信息',
    folderStrategySingleNotebook: '全部放入指定笔记本',
    folderStrategySingleNotebookDesc: '忽略原有文件夹结构',
    selectNotebook: '选择笔记本',
    tagStrategy: '标签处理',
    tagStrategyKeepNested: '保留嵌套格式',
    tagStrategyFlattenAll: '拆分为多个标签',
    tagStrategyFirstLevel: '只保留第一级',
    conflictStrategy: '同名笔记',
    conflictSkip: '跳过',
    conflictRename: '重命名',
    conflictOverwrite: '覆盖',
    importAttachments: '导入附件',
    parseFrontMatter: '解析 Front Matter',
    startImport: '开始导入',
    // 导出对话框
    exportRange: '导出范围',
    exportAll: '全部笔记',
    exportCurrentNotebook: '当前笔记本',
    exportSelected: '选中的笔记',
    exportFormat: '导出格式',
    formatMarkdown: 'Markdown (.md)',
    formatJson: 'JSON 完整备份',
    groupByNotebook: '按笔记本创建文件夹',
    includeAttachments: '包含附件',
    includeFrontMatter: '添加 Front Matter',
    asZip: '打包为 ZIP',
    outputLocation: '输出位置',
    startExport: '开始导出',
    // 进度和结果
    importing: '正在导入...',
    exporting: '正在导出...',
    importComplete: '导入完成',
    exportComplete: '导出完成',
    importedNotes: '已导入 {n} 篇笔记',
    exportedNotes: '已导出 {n} 篇笔记',
    skippedFiles: '跳过 {n} 个文件',
    createdNotebooks: '创建 {n} 个笔记本',
    errors: '{n} 个错误',
    viewDetails: '查看详情',
    close: '关闭',
    // 错误信息
    noSourceSelected: '请选择要导入的文件或文件夹',
    noTargetSelected: '请选择导出目录',
    importFailed: '导入失败',
    exportFailed: '导出失败'
  }
}

const en: Translations = {
  app: {
    name: 'Flow'
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
    notesCount: '{n} notes',
    move: 'Move',
    allNotes: 'All Notes'
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
    heading4: 'Heading 4',
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
    ai: 'AI',
    about: 'About',
    data: 'Import/Export',
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
    fontSizeExtraLarge: 'Extra Large',
    version: 'Version',
    checkUpdate: 'Check for Updates',
    feedback: 'Feedback',
    github: 'GitHub',
    discord: 'Discord',
    copyright: '© 2026 Flow. All rights reserved.',
    updating: {
      checking: 'Checking for updates...',
      available: (version: string) => `New version ${version} available`,
      downloading: (progress: number) => `Downloading update ${progress}%`,
      ready: 'Update ready, restart to apply',
      upToDate: 'You are up to date',
      error: 'Update check failed'
    },
    buttons: {
      download: 'Download',
      restart: 'Restart',
      retry: 'Retry'
    },
    aiActions: {
      title: 'AI Actions',
      description: 'Customize AI operations for selected text',
      loading: 'Loading...',
      add: 'Add',
      addAction: 'Add Action',
      editAction: 'Edit Action',
      icon: 'Icon',
      name: 'Name',
      namePlaceholder: 'Action name',
      prompt: 'Prompt',
      promptPlaceholder: 'Instructions for AI...',
      mode: 'Mode',
      modeReplace: 'Replace',
      modeInsert: 'Insert',
      modePopup: 'Popup',
      showIn: 'Show in',
      contextMenu: 'Context menu',
      slashCommand: 'Slash command',
      shortcut: 'Shortcut panel',
      shortcutKey: 'Shortcut Key',
      pressKey: 'Press a key...',
      noShortcut: 'Click to set',
      shortcutConflict: 'Conflicts with "{name}"',
      save: 'Save',
      saving: 'Saving...',
      cancel: 'Cancel',
      done: 'Done',
      builtin: 'Builtin',
      empty: 'No AI actions configured',
      resetToDefaults: 'Reset to defaults',
      resetConfirm: 'This will remove all custom actions. Continue?',
      reset: 'Reset'
    },
    knowledgeBase: {
      title: 'Knowledge Base',
      description: 'Enhance semantic search with vector indexing',
      enable: 'Enable Knowledge Base',
      enableDesc: 'Automatically create vector index for notes when enabled',
      provider: 'Embedding Provider',
      custom: 'Custom',
      apiKey: 'API Key',
      apiKeyPlaceholder: 'Enter API Key',
      apiUrl: 'API URL',
      modelName: 'Model Name',
      dimensions: 'Dimensions',
      testConnection: 'Test Connection',
      testing: 'Testing...',
      testSuccess: (dimensions: number) => `Connected (dimensions: ${dimensions})`,
      testFailed: 'Connection failed',
      stats: 'Index Statistics',
      totalChunks: 'Chunks',
      totalEmbeddings: 'Embeddings',
      indexedNotes: 'Indexed',
      pendingNotes: 'Pending',
      errorNotes: 'Errors',
      lastIndexedTime: 'Last Indexed',
      never: 'Never',
      clearIndex: 'Clear Index',
      clearConfirm: 'Are you sure you want to clear all index data?',
      clearing: 'Clearing...',
      rebuildIndex: 'Rebuild Index',
      rebuildConfirm: 'Are you sure you want to rebuild all note indexes? This may take a while.',
      rebuilding: 'Rebuilding...',
      rebuildProgress: (current: number, total: number) => `${current} / ${total}`,
      queueStatus: 'Queue Status',
      processing: 'Processing',
      waiting: 'Waiting',
      getApiKey: 'Get API Key',
      dimensionsChangedWarning: 'Dimensions changed, index cleared',
      modelChangedRebuild: 'Model changed, rebuilding index...',
      source: 'Configuration Source',
      sourceSanqian: 'From Sanqian',
      sourceCustom: 'Custom',
      fetchingSanqian: 'Fetching from Sanqian...',
      sanqianConnected: 'Connected to Sanqian',
      sanqianNotConfigured: 'Sanqian not configured',
      sanqianNotConfiguredHint: 'Please configure embedding model in Sanqian first, or switch to custom mode.',
      sanqianVersionTooOld: 'Sanqian version is too old, please upgrade',
      sanqianVersionTooOldHint: 'Please visit Sanqian.io to download and upgrade',
      refreshSanqian: 'Refresh',
      retryFetch: 'Retry',
      presets: {
        openaiSmall: 'OpenAI text-embedding-3-small',
        openaiLarge: 'OpenAI text-embedding-3-large',
        zhipu: 'Zhipu embedding-3',
        ollama: 'Ollama Local',
        custom: 'Custom'
      }
    }
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
    rename: 'Rename',
    enable: 'Enable',
    disable: 'Disable',
    next: 'Next'
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
    connecting: 'Connecting...',
    connectionFailed: 'Unable to connect to AI service',
    ensureSanqianRunning: 'Please ensure Sanqian is installed and running.',
    visitSanqian: 'Visit sanqian.io',
    retry: 'Retry',
    chat: 'AI Chat',
    selectConversation: 'Select a conversation to continue...',
    arguments: 'Arguments',
    result: 'Result',
    executeTool: 'Execute',
    toolLabel: 'Tool',
    argsLabel: 'Args',
    defaultPrefix: 'Default',
    enterResponse: 'Enter your response...',
    executing: 'Executing...',
    approve: 'Approve',
    reject: 'Reject',
    submit: 'Submit',
    rememberChoice: 'Remember this choice',
    requiredField: 'This field is required',
    timeoutIn: 'Timeout in',
    seconds: 's',
    // Error messages
    errorConnectionFailed: 'Connection failed, please ensure Sanqian is running',
    errorTimeout: 'Connection timeout, please retry',
    errorAuthFailed: 'Authentication failed, please login again',
    errorGeneric: 'Connection error, please retry',
    errorDisconnected: 'Connection lost, please retry',
    // Context message
    continueContextTemplate: 'I selected the following text:\n\n> {selectedText}\n\nAI explanation:\n\n{explanation}\n\nPlease help me understand this further.',
    // Preview actions
    previewAccept: 'Accept',
    previewReject: 'Reject',
    previewRegenerate: 'Retry',
    // Popup actions
    copied: 'Copied',
    copyFailed: 'Copy failed',
  },
  tray: {
    show: 'Show Window',
    quit: 'Quit'
  },
  common: {
    loading: 'Loading...',
    collapse: 'Collapse',
    expand: 'Expand',
    unknownError: 'Unknown error',
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
    noMatches: 'No matching commands',
    formatGroup: 'Format',
    aiGroup: 'AI Actions',
    aiActionDesc: 'Process selected text with AI'
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
    callout: 'Callout',
    tableOperations: 'Table',
    addRowBefore: 'Insert Row Above',
    addRowAfter: 'Insert Row Below',
    deleteRow: 'Delete Row',
    addColumnBefore: 'Insert Column Left',
    addColumnAfter: 'Insert Column Right',
    deleteColumn: 'Delete Column',
    deleteTable: 'Delete Table',
    ai: 'AI',
    aiImprove: 'Improve Writing',
    aiSimplify: 'Simplify',
    aiExpand: 'Expand',
    aiTranslate: 'Translate',
    aiSummarize: 'Summarize',
    aiExplain: 'Explain',
    aiCustom: 'Custom prompt...',
    aiCustomPlaceholder: 'Ask AI to...',
    aiProcessing: 'AI processing...',
    aiError: 'AI processing failed',
    aiContinueInChat: 'Continue in chat'
  },
  fileError: {
    tooLarge: 'File too large',
    tooLargeDetail: 'File size {size}MB exceeds 100MB limit',
    tooLargeWithName: 'File too large: {name}\nFile size {size}MB exceeds 100MB limit',
    insertFailed: 'Failed to insert file',
    insertFailedWithName: 'Failed to insert file: {name}',
    insertImageFailed: 'Failed to insert image: {error}',
    insertFileFailed: 'Failed to insert file: {error}',
    cannotOpen: 'Cannot open file: {name}\nThe file may have been moved or deleted'
  },
  ui: {
    dragToMove: 'Drag to move',
    clickToReset: 'Click to reset',
    processing: 'Processing...',
    noPopupId: 'No popup ID provided',
    noContent: 'No content'
  },
  language: {
    chinese: '中文',
    english: 'English',
    system: 'System'
  },
  importExport: {
    // Tab
    dataManagement: 'Data',
    // Import
    import: 'Import Notes',
    importDescription: 'Import notes from other apps to Flow',
    importButton: 'Import Notes...',
    // Import source options
    importFrom: 'Import From',
    markdownImport: 'Markdown',
    markdownImportDesc: 'Import .md files or folders',
    notionImport: 'Notion',
    notionImportDesc: 'Export as Markdown & CSV format',
    notionExportGuide: 'How to export from Notion?',
    obsidianImport: 'Obsidian',
    obsidianImportDesc: 'Import Obsidian vault folder',
    obsidianImportHint: 'Select your Obsidian vault folder (contains .obsidian directory)',
    // Export
    export: 'Export Notes',
    exportDescription: 'Export notes as Markdown files or JSON backup',
    exportButton: 'Export Notes...',
    // Import dialog
    selectSource: 'Select Source',
    browse: 'Browse...',
    detected: 'Detected',
    noteCount: '{n} notes',
    attachmentCount: '{n} attachments',
    folderStrategy: 'Folder Handling',
    folderStrategyFirstLevel: 'First level folders as notebooks',
    folderStrategyFirstLevelDesc: 'Recommended for organized folder structures',
    folderStrategyFlattenPath: 'Full path as notebook name',
    folderStrategyFlattenPathDesc: 'Preserve full folder hierarchy',
    folderStrategySingleNotebook: 'All to specified notebook',
    folderStrategySingleNotebookDesc: 'Ignore original folder structure',
    selectNotebook: 'Select Notebook',
    tagStrategy: 'Tag Handling',
    tagStrategyKeepNested: 'Keep nested format',
    tagStrategyFlattenAll: 'Split into multiple tags',
    tagStrategyFirstLevel: 'Keep first level only',
    conflictStrategy: 'Duplicate Notes',
    conflictSkip: 'Skip',
    conflictRename: 'Rename',
    conflictOverwrite: 'Overwrite',
    importAttachments: 'Import attachments',
    parseFrontMatter: 'Parse Front Matter',
    startImport: 'Start Import',
    // Export dialog
    exportRange: 'Export Range',
    exportAll: 'All notes',
    exportCurrentNotebook: 'Current notebook',
    exportSelected: 'Selected notes',
    exportFormat: 'Export Format',
    formatMarkdown: 'Markdown (.md)',
    formatJson: 'JSON full backup',
    groupByNotebook: 'Group by notebook',
    includeAttachments: 'Include attachments',
    includeFrontMatter: 'Add Front Matter',
    asZip: 'Package as ZIP',
    outputLocation: 'Output Location',
    startExport: 'Start Export',
    // Progress and results
    importing: 'Importing...',
    exporting: 'Exporting...',
    importComplete: 'Import Complete',
    exportComplete: 'Export Complete',
    importedNotes: '{n} notes imported',
    exportedNotes: '{n} notes exported',
    skippedFiles: '{n} files skipped',
    createdNotebooks: '{n} notebooks created',
    errors: '{n} errors',
    viewDetails: 'View Details',
    close: 'Close',
    // Error messages
    noSourceSelected: 'Please select a file or folder to import',
    noTargetSelected: 'Please select an output directory',
    importFailed: 'Import failed',
    exportFailed: 'Export failed'
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
