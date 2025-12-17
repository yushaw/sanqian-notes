/**
 * TypewriterToolbar - 打字机模式底部工具栏
 *
 * 功能：
 * - 打字机音效开关
 * - 背景音乐/白噪音
 * - Mood 主题切换
 * - 全屏切换
 * - 退出按钮
 * - 字数统计
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslations } from '../i18n'

// SVG Icons
const Icons = {
  soundOn: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  ),
  soundOff: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  ),
  music: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  ),
  theme: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  ),
  fullscreen: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  ),
  exitFullscreen: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  ),
  exit: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  // 环境音图标
  none: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .74-.11 1.45-.33 2.12" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  ),
  rain: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="16" y1="13" x2="16" y2="21" />
      <line x1="8" y1="13" x2="8" y2="21" />
      <line x1="12" y1="15" x2="12" y2="23" />
      <path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" />
    </svg>
  ),
  cafe: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
      <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
      <line x1="6" y1="2" x2="6" y2="4" />
      <line x1="10" y1="2" x2="10" y2="4" />
      <line x1="14" y1="2" x2="14" y2="4" />
    </svg>
  ),
  waves: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
    </svg>
  ),
  fire: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  ),
  forest: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 10v.2A3 3 0 0 1 8.9 16v0H5v0h0a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z" />
      <path d="M7 16v6" />
      <path d="M13 19v3" />
      <path d="M18 22v-3" />
      <path d="M18 8.8V10a3 3 0 0 0 .1.2A3 3 0 0 0 18 16h1v0a3 3 0 0 0 1-5.8V10a3 3 0 0 0-6 0c0 .7.2 1.3.6 1.9" />
      <path d="M18 16v3" />
      <path d="m14 8-2 4h4l-2 4" />
    </svg>
  ),
  // Mood 主题图标
  ink: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  ),
  paper: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  bamboo: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 8l4-4" />
      <path d="M12.5 12.5L21 4" />
      <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
      <path d="M12.5 12.5L8 21" />
    </svg>
  ),
  sakura: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5" />
      <path d="M8.5 8.5v.01" />
      <path d="M16 15.5v.01" />
      <path d="M12 12v.01" />
      <path d="M11 17v.01" />
      <path d="M7 14v.01" />
    </svg>
  ),
  ocean: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
    </svg>
  ),
}

// Mood 主题定义
export interface MoodTheme {
  id: string
  nameKey: keyof typeof MOOD_THEME_KEYS
  icon: string
  backgroundColor: string
  textColor: string
  focusTextColor: string
  dimmedTextColor: string
  accentColor: string
}

// 主题名称的翻译 key 映射
const MOOD_THEME_KEYS = {
  ink: 'moodInk',
  paper: 'moodPaper',
  bamboo: 'moodBamboo',
  sakura: 'moodSakura',
  ocean: 'moodOcean',
} as const

// 预设 Mood 主题
export const MOOD_THEMES: MoodTheme[] = [
  {
    id: 'ink',
    nameKey: 'ink',
    icon: '🌙',
    backgroundColor: '#1a1a1a',
    textColor: '#e6e1db',
    focusTextColor: '#f5f2ed',
    dimmedTextColor: '#6b6560',
    accentColor: '#c45c3e',
  },
  {
    id: 'paper',
    nameKey: 'paper',
    icon: '📜',
    backgroundColor: '#f8f6f2',
    textColor: '#2c2825',
    focusTextColor: '#1a1715',
    dimmedTextColor: '#a09890',
    accentColor: '#c45c3e',
  },
  {
    id: 'bamboo',
    nameKey: 'bamboo',
    icon: '🌲',
    backgroundColor: '#1a2118',
    textColor: '#c8d4c4',
    focusTextColor: '#e8f0e6',
    dimmedTextColor: '#5a6b56',
    accentColor: '#7dad71',
  },
  {
    id: 'sakura',
    nameKey: 'sakura',
    icon: '🌸',
    backgroundColor: '#2a1f24',
    textColor: '#e8d8dc',
    focusTextColor: '#f8ecf0',
    dimmedTextColor: '#8a6b74',
    accentColor: '#d4a0ab',
  },
  {
    id: 'ocean',
    nameKey: 'ocean',
    icon: '🌊',
    backgroundColor: '#0f1a24',
    textColor: '#b8d4e8',
    focusTextColor: '#e0f0f8',
    dimmedTextColor: '#4a6a80',
    accentColor: '#5ca0c8',
  },
]

// 背景音效定义
export interface AmbientSound {
  id: string
  nameKey: keyof typeof AMBIENT_SOUND_KEYS
  icon: string
}

// 音效名称的翻译 key 映射
const AMBIENT_SOUND_KEYS = {
  none: 'ambientNone',
  rain: 'ambientRain',
  cafe: 'ambientCafe',
  waves: 'ambientWaves',
  fire: 'ambientFire',
  forest: 'ambientForest',
} as const

export const AMBIENT_SOUNDS: AmbientSound[] = [
  { id: 'none', nameKey: 'none', icon: '🔇' },
  { id: 'rain', nameKey: 'rain', icon: '🌧' },
  { id: 'cafe', nameKey: 'cafe', icon: '☕' },
  { id: 'waves', nameKey: 'waves', icon: '🌊' },
  { id: 'fire', nameKey: 'fire', icon: '🔥' },
  { id: 'forest', nameKey: 'forest', icon: '🌲' },
]

interface TypewriterToolbarProps {
  wordCount: number
  selectedWordCount: number | null
  currentMood: string
  onMoodChange: (mood: MoodTheme) => void
  onToggleFullscreen: () => void
  onExit: () => void
  isFullscreen: boolean
  // 音效相关
  typewriterSoundEnabled: boolean
  onToggleTypewriterSound: () => void
  ambientSound: string
  onAmbientSoundChange: (soundId: string) => void
}

export function TypewriterToolbar({
  wordCount,
  selectedWordCount,
  currentMood,
  onMoodChange,
  onToggleFullscreen,
  onExit,
  isFullscreen,
  typewriterSoundEnabled,
  onToggleTypewriterSound,
  ambientSound,
  onAmbientSoundChange,
}: TypewriterToolbarProps) {
  const [showMoodPanel, setShowMoodPanel] = useState(false)
  const [showSoundPanel, setShowSoundPanel] = useState(false)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const t = useTranslations()

  // 点击外部关闭面板
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setShowMoodPanel(false)
        setShowSoundPanel(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleMoodSelect = useCallback((mood: MoodTheme) => {
    onMoodChange(mood)
    setShowMoodPanel(false)
  }, [onMoodChange])

  const handleSoundSelect = useCallback((soundId: string) => {
    onAmbientSoundChange(soundId)
    setShowSoundPanel(false)
  }, [onAmbientSoundChange])

  const currentMoodTheme = MOOD_THEMES.find(m => m.id === currentMood) || MOOD_THEMES[0]
  const currentSound = AMBIENT_SOUNDS.find(s => s.id === ambientSound) || AMBIENT_SOUNDS[0]

  // 获取翻译后的主题名称
  const getMoodName = (nameKey: keyof typeof MOOD_THEME_KEYS) => {
    return t.typewriter[MOOD_THEME_KEYS[nameKey] as keyof typeof t.typewriter] || nameKey
  }

  // 获取翻译后的音效名称
  const getSoundName = (nameKey: keyof typeof AMBIENT_SOUND_KEYS) => {
    return t.typewriter[AMBIENT_SOUND_KEYS[nameKey] as keyof typeof t.typewriter] || nameKey
  }

  // 获取环境音图标
  const getAmbientIcon = (soundId: string) => {
    const iconMap: Record<string, React.ReactNode> = {
      none: Icons.none,
      rain: Icons.rain,
      cafe: Icons.cafe,
      waves: Icons.waves,
      fire: Icons.fire,
      forest: Icons.forest,
    }
    return iconMap[soundId] || Icons.music
  }

  // 获取主题图标
  const getMoodIcon = (moodId: string) => {
    const iconMap: Record<string, React.ReactNode> = {
      ink: Icons.ink,
      paper: Icons.paper,
      bamboo: Icons.bamboo,
      sakura: Icons.sakura,
      ocean: Icons.ocean,
    }
    return iconMap[moodId] || Icons.theme
  }

  return (
    <div className="typewriter-toolbar" ref={toolbarRef}>
      <div className="typewriter-toolbar-inner">
        {/* 左侧：功能按钮 */}
        <div className="typewriter-toolbar-left">
          {/* 打字机音效 */}
          <button
            className={`typewriter-toolbar-btn ${typewriterSoundEnabled ? 'active' : ''}`}
            onClick={onToggleTypewriterSound}
            title={typewriterSoundEnabled ? t.typewriter.soundOn : t.typewriter.soundOff}
          >
            <span className="toolbar-icon">{typewriterSoundEnabled ? Icons.soundOn : Icons.soundOff}</span>
            <span className="toolbar-label">{t.typewriter.sound}</span>
          </button>

          {/* 背景音乐 */}
          <div className="typewriter-toolbar-dropdown">
            <button
              className={`typewriter-toolbar-btn ${ambientSound !== 'none' ? 'active' : ''}`}
              onClick={() => {
                setShowSoundPanel(!showSoundPanel)
                setShowMoodPanel(false)
              }}
              title={t.typewriter.music}
            >
              <span className="toolbar-icon">{getAmbientIcon(currentSound.id)}</span>
              <span className="toolbar-label">{t.typewriter.music}</span>
            </button>
            {showSoundPanel && (
              <div className="typewriter-panel">
                {AMBIENT_SOUNDS.map(sound => (
                  <button
                    key={sound.id}
                    className={`typewriter-panel-item ${ambientSound === sound.id ? 'active' : ''}`}
                    onClick={() => handleSoundSelect(sound.id)}
                  >
                    <span className="panel-icon">{getAmbientIcon(sound.id)}</span>
                    <span className="panel-label">{getSoundName(sound.nameKey)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Mood 主题 */}
          <div className="typewriter-toolbar-dropdown">
            <button
              className="typewriter-toolbar-btn"
              onClick={() => {
                setShowMoodPanel(!showMoodPanel)
                setShowSoundPanel(false)
              }}
              title={t.typewriter.theme}
            >
              <span className="toolbar-icon">{getMoodIcon(currentMoodTheme.id)}</span>
              <span className="toolbar-label">{t.typewriter.theme}</span>
            </button>
            {showMoodPanel && (
              <div className="typewriter-panel">
                {MOOD_THEMES.map(mood => (
                  <button
                    key={mood.id}
                    className={`typewriter-panel-item ${currentMood === mood.id ? 'active' : ''}`}
                    onClick={() => handleMoodSelect(mood)}
                  >
                    <span className="panel-icon">{getMoodIcon(mood.id)}</span>
                    <span className="panel-label">{getMoodName(mood.nameKey)}</span>
                    <span
                      className="panel-color-preview"
                      style={{ backgroundColor: mood.backgroundColor }}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 中间：字数统计 */}
        <div className="typewriter-toolbar-center">
          <span className="typewriter-wordcount">
            {selectedWordCount !== null
              ? `${selectedWordCount} / ${wordCount} ${t.typewriter.wordCount}`
              : `${wordCount} ${t.typewriter.wordCount}`
            }
          </span>
        </div>

        {/* 右侧：全屏和退出 */}
        <div className="typewriter-toolbar-right">
          {/* 全屏切换 */}
          <button
            className="typewriter-toolbar-btn"
            onClick={onToggleFullscreen}
            title={isFullscreen ? t.typewriter.window : t.typewriter.fullscreen}
          >
            <span className="toolbar-icon">{isFullscreen ? Icons.exitFullscreen : Icons.fullscreen}</span>
            <span className="toolbar-label">{isFullscreen ? t.typewriter.window : t.typewriter.fullscreen}</span>
          </button>

          {/* 退出 */}
          <button
            className="typewriter-toolbar-btn typewriter-toolbar-exit"
            onClick={onExit}
            title={`${t.typewriter.exit} (ESC)`}
          >
            <span className="toolbar-icon">{Icons.exit}</span>
            <span className="toolbar-label">{t.typewriter.exit}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
