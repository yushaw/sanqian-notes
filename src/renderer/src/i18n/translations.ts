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
    sound: string
    music: string
    theme: string
    fullscreen: string
    window: string
    exit: string
    wordCount: string
    soundOn: string
    soundOff: string
    typewriterMode: string
    focusMode: string
    // Mood themes
    moodInk: string
    moodPaper: string
    moodBamboo: string
    moodSakura: string
    moodOcean: string
    // Ambient sounds
    ambientNone: string
    ambientRain: string
    ambientCafe: string
    ambientWaves: string
    ambientFire: string
    ambientForest: string
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
    collapse: '收起侧栏',
    expand: '展开侧栏',
    trash: '回收站'
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
    code: '代码',
    quote: '引用'
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
    sound: '音效',
    music: '音乐',
    theme: '主题',
    fullscreen: '全屏',
    window: '窗口',
    exit: '退出',
    wordCount: '字',
    soundOn: '关闭按键音效',
    soundOff: '开启按键音效',
    typewriterMode: '打字机',
    focusMode: '专注',
    moodInk: '墨夜',
    moodPaper: '宣纸',
    moodBamboo: '竹林',
    moodSakura: '樱花',
    moodOcean: '深海',
    ambientNone: '静音',
    ambientRain: '雨声',
    ambientCafe: '咖啡厅',
    ambientWaves: '海浪',
    ambientFire: '壁炉',
    ambientForest: '森林'
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
    collapse: 'Collapse Sidebar',
    expand: 'Expand Sidebar',
    trash: 'Trash'
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
    code: 'Code',
    quote: 'Quote'
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
    sound: 'Sound',
    music: 'Music',
    theme: 'Theme',
    fullscreen: 'Fullscreen',
    window: 'Window',
    exit: 'Exit',
    wordCount: 'words',
    soundOn: 'Disable key sounds',
    soundOff: 'Enable key sounds',
    typewriterMode: 'Typewriter',
    focusMode: 'Focus',
    moodInk: 'Ink Night',
    moodPaper: 'Paper',
    moodBamboo: 'Bamboo',
    moodSakura: 'Sakura',
    moodOcean: 'Ocean',
    ambientNone: 'Silent',
    ambientRain: 'Rain',
    ambientCafe: 'Café',
    ambientWaves: 'Waves',
    ambientFire: 'Fireplace',
    ambientForest: 'Forest'
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
