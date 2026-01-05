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
  const isInitializedRef = useRef<boolean>(false)
  const pendingInitRef = useRef<boolean>(false)

  // 懒加载初始化函数 - 在第一次用户交互时调用
  const ensureInitialized = useCallback(async () => {
    if (isInitializedRef.current || pendingInitRef.current || !enabled) return
    pendingInitRef.current = true

    // 创建 AudioContext（兼容 Safari）
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
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
      console.log('[TypewriterSound] All audio files loaded successfully')
    } catch (error) {
      console.error('[TypewriterSound] Failed to load audio files:', error)
    } finally {
      pendingInitRef.current = false
    }
  }, [enabled])

  // 清理
  useEffect(() => {
    return () => {
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
      isInitializedRef.current = false
      pendingInitRef.current = false
    }
  }, [])

  // 当 enabled 变为 false 时重置状态
  useEffect(() => {
    if (!enabled) {
      sourceNodesRef.current.forEach(node => {
        try {
          node.stop()
          node.disconnect()
        } catch (e) {
          // 忽略
        }
      })
      sourceNodesRef.current = []

      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }

      audioBuffersRef.current.clear()
      isInitializedRef.current = false
      pendingInitRef.current = false
    }
  }, [enabled])

  // 播放音效
  const play = useCallback((keyType: KeyType = 'normal') => {
    if (!enabled) return

    // 懒加载初始化（第一次调用时触发）
    if (!isInitializedRef.current && !pendingInitRef.current) {
      ensureInitialized()
      return // 第一次调用时跳过播放，等待初始化完成
    }

    // 如果还在初始化中或没有音频数据，跳过
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

      // 确保 AudioContext 处于运行状态（某些浏览器需要用户交互后 resume）
      if (context.state === 'suspended') {
        context.resume()
      }

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
  }, [enabled, volume, playbackRate, maxConcurrent, ensureInitialized])

  return { play }
}
