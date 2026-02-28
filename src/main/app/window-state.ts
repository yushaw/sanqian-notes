import { app, BaseWindow, screen } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized?: boolean
}

export const DEFAULT_WINDOW_STATE: WindowState = {
  width: 1200,
  height: 800
}

function getWindowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

export function loadWindowState(): WindowState {
  try {
    const statePath = getWindowStatePath()
    if (existsSync(statePath)) {
      const data = JSON.parse(readFileSync(statePath, 'utf-8'))
      if (typeof data.width === 'number' && typeof data.height === 'number') {
        return { ...DEFAULT_WINDOW_STATE, ...data }
      }
    }
  } catch {
    // Ignore errors
  }
  return DEFAULT_WINDOW_STATE
}

export function saveWindowState(win: BaseWindow): void {
  try {
    const isMaximized = win.isMaximized()
    const bounds = isMaximized ? win.getNormalBounds() : win.getBounds()
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized
    }
    writeFileSync(getWindowStatePath(), JSON.stringify(state, null, 2))
  } catch {
    // Ignore errors
  }
}

export function isWindowVisible(state: WindowState): boolean {
  if (state.x === undefined || state.y === undefined) {
    return false
  }

  const displays = screen.getAllDisplays()
  const windowArea = state.width * state.height
  let visibleArea = 0

  for (const display of displays) {
    const { x: dx, y: dy, width: dw, height: dh } = display.bounds
    const left = Math.max(state.x, dx)
    const top = Math.max(state.y, dy)
    const right = Math.min(state.x + state.width, dx + dw)
    const bottom = Math.min(state.y + state.height, dy + dh)

    if (left < right && top < bottom) {
      visibleArea += (right - left) * (bottom - top)
    }
  }

  return visibleArea >= windowArea * 0.2
}

export function getCenteredBoundsOnMouseDisplay(state: WindowState): { x: number; y: number } {
  const cursorPoint = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPoint)
  const { x, y, width, height } = display.workArea

  return {
    x: Math.round(x + (width - state.width) / 2),
    y: Math.round(y + (height - state.height) / 2)
  }
}
