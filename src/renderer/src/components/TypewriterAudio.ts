/**
 * TypewriterAudio - 打字机模式音频管理
 *
 * 音频文件位置：src/renderer/public/audio/
 * - typewriter-key.wav    打字机按键音
 * - typewriter-return.wav 回车键音
 * - rain.mp3              雨声
 * - cafe.mp3              咖啡厅
 * - waves.mp3             海浪
 * - fire.mp3              壁炉
 * - forest.mp3            森林
 */

// ==================== 打字机音效 ====================

let keyClickAudio: HTMLAudioElement | null = null
let returnAudio: HTMLAudioElement | null = null

/**
 * 初始化打字机音效
 */
function initTypewriterSounds(): void {
  if (!keyClickAudio) {
    keyClickAudio = new Audio('/audio/typewriter-key.wav')
    keyClickAudio.load() // 预加载
  }
  if (!returnAudio) {
    returnAudio = new Audio('/audio/typewriter-return.wav')
    returnAudio.load() // 预加载
  }
}

/**
 * 预加载打字音效（进入打字机模式时调用）
 */
export function preloadAudio(): void {
  initTypewriterSounds()
}

/**
 * 清理克隆的音频元素
 */
function cleanupClonedAudio(audio: HTMLAudioElement, timeoutId?: ReturnType<typeof setTimeout>): void {
  if (timeoutId) clearTimeout(timeoutId)
  audio.pause()
  audio.src = ''
  audio.remove()
}

/**
 * 播放打字机按键音效
 */
export function playTypewriterClick(): void {
  initTypewriterSounds()
  if (keyClickAudio) {
    const audio = keyClickAudio.cloneNode() as HTMLAudioElement
    // 超时保护：2秒后强制清理（防止 ended 事件未触发）
    const timeoutId = setTimeout(() => cleanupClonedAudio(audio), 2000)
    audio.addEventListener('ended', () => cleanupClonedAudio(audio, timeoutId), { once: true })
    audio.addEventListener('error', () => cleanupClonedAudio(audio, timeoutId), { once: true })
    audio.play().catch(() => cleanupClonedAudio(audio, timeoutId))
  }
}

/**
 * 播放回车键音效
 */
export function playTypewriterReturn(): void {
  initTypewriterSounds()
  if (returnAudio) {
    const audio = returnAudio.cloneNode() as HTMLAudioElement
    // 超时保护：2秒后强制清理（防止 ended 事件未触发）
    const timeoutId = setTimeout(() => cleanupClonedAudio(audio), 2000)
    audio.addEventListener('ended', () => cleanupClonedAudio(audio, timeoutId), { once: true })
    audio.addEventListener('error', () => cleanupClonedAudio(audio, timeoutId), { once: true })
    audio.play().catch(() => cleanupClonedAudio(audio, timeoutId))
  }
}

// ==================== 背景环境音 ====================

let ambientAudio: HTMLAudioElement | null = null

export type AmbientSoundType = 'none' | 'rain' | 'cafe' | 'waves' | 'fire' | 'forest'

const AMBIENT_FILES: Record<AmbientSoundType, string> = {
  none: '',
  rain: '/audio/rain.mp3',
  cafe: '/audio/cafe.mp3',
  waves: '/audio/waves.mp3',
  fire: '/audio/fire.mp3',
  forest: '/audio/forest.mp3',
}

/**
 * 播放背景环境音
 */
export function playAmbientSound(type: AmbientSoundType, volume: number = 1.0): void {
  stopAmbientSound()

  if (type === 'none') return

  const src = AMBIENT_FILES[type]
  if (!src) return

  ambientAudio = new Audio(src)
  ambientAudio.loop = true
  ambientAudio.volume = volume
  ambientAudio.play().catch(err => {
    console.warn('无法播放背景音乐:', err)
  })
}

/**
 * 停止背景环境音
 */
export function stopAmbientSound(): void {
  if (ambientAudio) {
    ambientAudio.pause()
    ambientAudio.src = ''
    ambientAudio = null
  }
}

/**
 * 设置环境音音量
 */
export function setAmbientVolume(volume: number): void {
  const v = Math.max(0, Math.min(1, volume))
  if (ambientAudio) {
    ambientAudio.volume = v
  }
}

/**
 * 清理音频资源
 */
export function cleanupAudio(): void {
  stopAmbientSound()
  keyClickAudio = null
  returnAudio = null
}
