/**
 * useTypewriterSound - 打字机音效 Hook
 *
 * 参考 Tickeys 项目实现，不同按键播放不同音效：
 * - Backspace: backspace.wav
 * - Enter: return-new.wav
 * - Space: space-new.wav
 * - 普通按键: key-new-01.wav ~ key-new-05.wav (轮流播放)
 *
 * 使用 Web Audio API 实现跨平台兼容 (macOS & Windows)
 */

import { useEffect, useRef, useCallback } from 'react'

// Safari compatibility: webkitAudioContext
interface WindowWithWebkit extends Window {
  webkitAudioContext?: typeof AudioContext
}

interface TypewriterSoundOptions {
  enabled?: boolean
  volume?: number // 0-1
  playbackRate?: number // 0.5-2.0，音调
  maxConcurrent?: number // 最大同时播放数
}

export type KeyType = 'backspace' | 'enter' | 'space' | 'normal' | 'delete'

// 音效文件映射（使用相对路径，兼容打包后的 file:// 协议）
const SOUND_FILES = {
  backspace: './sounds/typewriter/backspace.wav',
  enter: './sounds/typewriter/return-new.wav',
  space: './sounds/typewriter/space-new.wav',
  normal: [
    './sounds/typewriter/key-new-01.wav',
    './sounds/typewriter/key-new-02.wav',
    './sounds/typewriter/key-new-03.wav',
    './sounds/typewriter/key-new-04.wav',
    './sounds/typewriter/key-new-05.wav',
  ],
}

export function useTypewriterSound(options: TypewriterSoundOptions = {}) {
  const {
    enabled = true,
    volume = 0.3,
    playbackRate = 1.0,
    maxConcurrent = 3
  } = options

  const audioContextRef = useRef<AudioContext | null>(null)
  const audioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map())
  const sourceNodesRef = useRef<AudioBufferSourceNode[]>([])
  const lastPlayTimeRef = useRef<number>(0)
  const normalKeyIndexRef = useRef<number>(0) // 用于轮流播放普通按键音效
  const isInitializedRef = useRef<boolean>(false)
  const pendingInitRef = useRef<boolean>(false)
  // 存储初始化期间的待播放按键（只保存最后一个，初始化约100-200ms，丢失几个音效可接受）
  const pendingPlayRef = useRef<KeyType | null>(null)
  // 用于在 ensureInitialized 中访问最新的 playSound，避免闭包捕获旧版本
  const playSoundRef = useRef<(keyType: KeyType) => void>(() => {})

  // 清理音频资源的公共函数
  const cleanupAudio = useCallback(() => {
    sourceNodesRef.current.forEach(node => {
      try {
        node.stop()
        node.disconnect()
      } catch {
        // 忽略已经停止的节点
      }
    })
    sourceNodesRef.current = []

    if (audioContextRef.current) {
      try {
        audioContextRef.current.close()
      } catch {
        // 忽略关闭失败
      }
      audioContextRef.current = null
    }

    audioBuffersRef.current.clear()
    isInitializedRef.current = false
    pendingInitRef.current = false
  }, [])

  // 懒加载初始化函数 - 在第一次用户交互时调用
  const ensureInitialized = useCallback(async () => {
    if (isInitializedRef.current || pendingInitRef.current || !enabled) return
    pendingInitRef.current = true

    // 创建 AudioContext（兼容 Safari）
    const AudioContextClass = window.AudioContext || (window as WindowWithWebkit).webkitAudioContext
    if (!AudioContextClass) {
      console.warn('[TypewriterSound] Web Audio API not supported')
      pendingInitRef.current = false
      return
    }

    // 创建 AudioContext（在用户交互时创建，避免 autoplay policy 问题）
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass()
    }

    const context = audioContextRef.current

    // 确保 context 处于运行状态
    if (context.state === 'suspended') {
      try {
        await context.resume()
      } catch (e) {
        console.warn('[TypewriterSound] Failed to resume AudioContext:', e)
      }
    }

    // 如果已经加载过，直接返回
    if (audioBuffersRef.current.size > 0) {
      isInitializedRef.current = true
      pendingInitRef.current = false
      return
    }

    // 加载所有音频文件
    try {
      const loadSound = async (key: string, path: string) => {
        try {
          const response = await fetch(path)
          if (!response.ok) {
            throw new Error(`Failed to load ${path}: ${response.statusText}`)
          }
          const arrayBuffer = await response.arrayBuffer()
          const audioBuffer = await context.decodeAudioData(arrayBuffer)
          audioBuffersRef.current.set(key, audioBuffer)
        } catch (error) {
          console.error(`[TypewriterSound] Failed to load ${key}:`, error)
        }
      }

      await Promise.all([
        loadSound('backspace', SOUND_FILES.backspace),
        loadSound('enter', SOUND_FILES.enter),
        loadSound('space', SOUND_FILES.space),
        ...SOUND_FILES.normal.map((path, index) => loadSound(`normal-${index}`, path))
      ])

      isInitializedRef.current = true

      // 播放初始化期间的待播放按键
      if (pendingPlayRef.current) {
        const pendingKey = pendingPlayRef.current
        pendingPlayRef.current = null
        // 短暂延迟让音频上下文稳定后再播放
        setTimeout(() => {
          playSoundRef.current(pendingKey)
        }, 10)
      }
    } catch (error) {
      console.error('[TypewriterSound] Failed to load audio files:', error)
    } finally {
      pendingInitRef.current = false
    }
  }, [enabled])  

  // 内部播放函数
  const playSound = useCallback((keyType: KeyType) => {
    if (!audioContextRef.current || audioBuffersRef.current.size === 0) {
      return
    }

    // 防抖：避免过于频繁的播放（小于 30ms 间隔）
    const now = Date.now()
    if (now - lastPlayTimeRef.current < 30) {
      return
    }
    lastPlayTimeRef.current = now

    // 获取对应的音效
    let audioBuffer: AudioBuffer | undefined
    let volumeMultiplier = 1.0

    switch (keyType) {
      case 'backspace':
      case 'delete':
        audioBuffer = audioBuffersRef.current.get('backspace')
        volumeMultiplier = 2.5
        break
      case 'enter':
        audioBuffer = audioBuffersRef.current.get('enter')
        break
      case 'space':
        audioBuffer = audioBuffersRef.current.get('space')
        break
      case 'normal':
      default: {
        const index = normalKeyIndexRef.current % SOUND_FILES.normal.length
        audioBuffer = audioBuffersRef.current.get(`normal-${index}`)
        normalKeyIndexRef.current = (normalKeyIndexRef.current + 1) % SOUND_FILES.normal.length
        break
      }
    }

    if (!audioBuffer) {
      return
    }

    // 限制同时播放数量
    if (sourceNodesRef.current.length >= maxConcurrent) {
      const oldestNode = sourceNodesRef.current.shift()
      if (oldestNode) {
        try {
          oldestNode.stop()
          oldestNode.disconnect()
        } catch {
          // 忽略
        }
      }
    }

    try {
      const context = audioContextRef.current

      if (context.state === 'suspended') {
        context.resume()
      }

      const source = context.createBufferSource()
      source.buffer = audioBuffer
      source.playbackRate.value = playbackRate

      const gainNode = context.createGain()
      gainNode.gain.value = volume * volumeMultiplier

      source.connect(gainNode)
      gainNode.connect(context.destination)

      source.start(0)

      sourceNodesRef.current.push(source)

      source.onended = () => {
        const idx = sourceNodesRef.current.indexOf(source)
        if (idx > -1) {
          sourceNodesRef.current.splice(idx, 1)
        }
        try {
          source.disconnect()
        } catch {
          // 忽略
        }
      }
    } catch (error) {
      console.error('[TypewriterSound] Failed to play audio:', error)
    }
  }, [volume, playbackRate, maxConcurrent])

  // 每次渲染更新 ref，确保 ensureInitialized 中使用最新版本
  playSoundRef.current = playSound

  // 组件卸载时清理
  useEffect(() => {
    return cleanupAudio
  }, [cleanupAudio])

  // 当 enabled 变为 false 时重置状态
  useEffect(() => {
    if (!enabled) {
      cleanupAudio()
    }
  }, [enabled, cleanupAudio])

  // 播放音效（外部接口）
  const play = useCallback((keyType: KeyType = 'normal') => {
    if (!enabled) return

    // 懒加载初始化（第一次调用时触发）
    if (!isInitializedRef.current && !pendingInitRef.current) {
      pendingPlayRef.current = keyType // 保存待播放的按键
      ensureInitialized()
      return
    }

    // 如果正在初始化中，保存待播放的按键
    if (pendingInitRef.current) {
      pendingPlayRef.current = keyType
      return
    }

    // 已初始化，直接播放
    playSound(keyType)
  }, [enabled, ensureInitialized, playSound])

  return { play }
}
