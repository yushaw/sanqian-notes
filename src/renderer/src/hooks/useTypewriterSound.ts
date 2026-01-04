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
  const isLoadingRef = useRef<boolean>(false)

  // 初始化 AudioContext 并加载所有音效文件
  useEffect(() => {
    if (!enabled) return

    // 用于取消异步操作的标志
    let isActive = true

    // 创建 AudioContext（兼容 Safari）
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioContextClass) {
      console.warn('[TypewriterSound] Web Audio API not supported')
      return
    }

    const context = new AudioContextClass()
    audioContextRef.current = context

    // 加载所有音频文件
    const loadAllAudio = async () => {
      if (isLoadingRef.current) return
      isLoadingRef.current = true

      try {
        const loadTasks: Promise<void>[] = []

        // 加载特殊按键音效
        const loadSound = async (key: string, path: string) => {
          try {
            const response = await fetch(path)
            if (!isActive) return // 已取消，提前退出
            if (!response.ok) {
              throw new Error(`Failed to load ${path}: ${response.statusText}`)
            }
            const arrayBuffer = await response.arrayBuffer()
            if (!isActive) return // 已取消，提前退出
            const audioBuffer = await context.decodeAudioData(arrayBuffer)
            if (!isActive) return // 已取消，提前退出
            audioBuffersRef.current.set(key, audioBuffer)
          } catch (error) {
            // 忽略已取消的操作产生的错误
            if (isActive) {
              console.error(`[TypewriterSound] Failed to load ${key}:`, error)
            }
          }
        }

        loadTasks.push(loadSound('backspace', SOUND_FILES.backspace))
        loadTasks.push(loadSound('enter', SOUND_FILES.enter))
        loadTasks.push(loadSound('space', SOUND_FILES.space))

        // 加载普通按键音效
        SOUND_FILES.normal.forEach((path, index) => {
          loadTasks.push(loadSound(`normal-${index}`, path))
        })

        await Promise.all(loadTasks)
        if (isActive) {
          console.log('[TypewriterSound] All audio files loaded successfully')
        }
      } catch (error) {
        if (isActive) {
          console.error('[TypewriterSound] Failed to load audio files:', error)
        }
      } finally {
        isLoadingRef.current = false
      }
    }

    loadAllAudio()

    // 清理
    return () => {
      isActive = false // 取消正在进行的异步操作

      sourceNodesRef.current.forEach(node => {
        try {
          node.stop()
          node.disconnect()
        } catch (e) {
          // 忽略已经停止的节点
        }
      })
      sourceNodesRef.current = []

      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }

      audioBuffersRef.current.clear()
    }
  }, [enabled])

  // 播放音效
  const play = useCallback((keyType: KeyType = 'normal') => {
    if (!enabled || !audioContextRef.current || audioBuffersRef.current.size === 0) {
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
    let volumeMultiplier = 1.0 // 音量倍数，用于调整不同音效的相对音量

    switch (keyType) {
      case 'backspace':
      case 'delete':
        audioBuffer = audioBuffersRef.current.get('backspace')
        volumeMultiplier = 2.5 // backspace 音效本身较小，放大 2.5 倍
        break
      case 'enter':
        audioBuffer = audioBuffersRef.current.get('enter')
        break
      case 'space':
        audioBuffer = audioBuffersRef.current.get('space')
        break
      case 'normal':
      default:
        // 轮流播放 5 个普通按键音效
        const index = normalKeyIndexRef.current % SOUND_FILES.normal.length
        audioBuffer = audioBuffersRef.current.get(`normal-${index}`)
        normalKeyIndexRef.current = (normalKeyIndexRef.current + 1) % SOUND_FILES.normal.length
        break
    }

    if (!audioBuffer) {
      console.warn(`[TypewriterSound] Audio buffer not found for key type: ${keyType}`)
      return
    }

    // 限制同时播放数量
    if (sourceNodesRef.current.length >= maxConcurrent) {
      // 停止最旧的音效
      const oldestNode = sourceNodesRef.current.shift()
      if (oldestNode) {
        try {
          oldestNode.stop()
          oldestNode.disconnect()
        } catch (e) {
          // 忽略
        }
      }
    }

    try {
      const context = audioContextRef.current

      // 创建音源节点
      const source = context.createBufferSource()
      source.buffer = audioBuffer
      source.playbackRate.value = playbackRate

      // 创建增益节点（音量控制）
      const gainNode = context.createGain()
      gainNode.gain.value = volume * volumeMultiplier

      // 连接节点：source -> gain -> destination
      source.connect(gainNode)
      gainNode.connect(context.destination)

      // 播放
      source.start(0)

      // 记录节点
      sourceNodesRef.current.push(source)

      // 播放结束后清理
      source.onended = () => {
        const index = sourceNodesRef.current.indexOf(source)
        if (index > -1) {
          sourceNodesRef.current.splice(index, 1)
        }
        try {
          source.disconnect()
        } catch (e) {
          // 忽略
        }
      }
    } catch (error) {
      console.error('[TypewriterSound] Failed to play audio:', error)
    }
  }, [enabled, volume, playbackRate, maxConcurrent])

  return { play }
}
