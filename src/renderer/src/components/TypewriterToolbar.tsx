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
            <span className="toolbar-icon">{typewriterSoundEnabled ? '🔊' : '🔈'}</span>
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
              <span className="toolbar-icon">{currentSound.icon}</span>
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
                    <span className="panel-icon">{sound.icon}</span>
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
              <span className="toolbar-icon">{currentMoodTheme.icon}</span>
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
                    <span className="panel-icon">{mood.icon}</span>
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
          <span className="typewriter-wordcount">{wordCount} {t.typewriter.wordCount}</span>
        </div>

        {/* 右侧：全屏和退出 */}
        <div className="typewriter-toolbar-right">
          {/* 全屏切换 */}
          <button
            className="typewriter-toolbar-btn"
            onClick={onToggleFullscreen}
            title={isFullscreen ? t.typewriter.window : t.typewriter.fullscreen}
          >
            <span className="toolbar-icon">{isFullscreen ? '⛋' : '⛶'}</span>
            <span className="toolbar-label">{isFullscreen ? t.typewriter.window : t.typewriter.fullscreen}</span>
          </button>

          {/* 退出 */}
          <button
            className="typewriter-toolbar-btn typewriter-toolbar-exit"
            onClick={onExit}
            title={`${t.typewriter.exit} (ESC)`}
          >
            <span className="toolbar-icon">✕</span>
            <span className="toolbar-label">{t.typewriter.exit}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
