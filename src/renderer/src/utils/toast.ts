/**
 * Simple toast notification utility
 * Creates a temporary DOM element for toast messages
 */

interface ToastOptions {
  duration?: number
  type?: 'info' | 'error' | 'success'
}

const TOAST_CONTAINER_ID = 'toast-container'
const MAX_TOASTS = 5 // Maximum number of simultaneous toasts

function getOrCreateContainer(): HTMLElement {
  let container = document.getElementById(TOAST_CONTAINER_ID)
  if (!container) {
    container = document.createElement('div')
    container.id = TOAST_CONTAINER_ID
    container.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 99999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    `
    document.body.appendChild(container)
  }
  return container
}

export function toast(message: string, options: ToastOptions = {}): void {
  const { duration = 3000, type = 'info' } = options

  const container = getOrCreateContainer()

  const toastEl = document.createElement('div')
  toastEl.style.cssText = `
    padding: 10px 16px;
    border-radius: 8px;
    font-size: 13px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    animation: toast-in 0.2s ease-out;
    pointer-events: auto;
    max-width: 320px;
    text-align: center;
  `

  // Apply theme-aware colors
  const isDark = document.documentElement.classList.contains('dark')
  if (type === 'error') {
    toastEl.style.backgroundColor = isDark ? '#7f1d1d' : '#fef2f2'
    toastEl.style.color = isDark ? '#fecaca' : '#991b1b'
    toastEl.style.border = `1px solid ${isDark ? '#991b1b' : '#fecaca'}`
  } else if (type === 'success') {
    toastEl.style.backgroundColor = isDark ? '#14532d' : '#f0fdf4'
    toastEl.style.color = isDark ? '#bbf7d0' : '#166534'
    toastEl.style.border = `1px solid ${isDark ? '#166534' : '#bbf7d0'}`
  } else {
    toastEl.style.backgroundColor = isDark ? '#27272a' : '#ffffff'
    toastEl.style.color = isDark ? '#fafafa' : '#27272a'
    toastEl.style.border = `1px solid ${isDark ? '#3f3f46' : '#e4e4e7'}`
  }

  toastEl.textContent = message

  // Enforce max toast limit - remove oldest toasts
  while (container.children.length >= MAX_TOASTS) {
    const oldest = container.firstElementChild
    if (oldest) oldest.remove()
  }

  container.appendChild(toastEl)

  // Add animation keyframes if not exists
  if (!document.getElementById('toast-styles')) {
    const style = document.createElement('style')
    style.id = 'toast-styles'
    style.textContent = `
      @keyframes toast-in {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes toast-out {
        from { opacity: 1; transform: translateY(0); }
        to { opacity: 0; transform: translateY(-10px); }
      }
    `
    document.head.appendChild(style)
  }

  // Remove after duration
  setTimeout(() => {
    toastEl.style.animation = 'toast-out 0.2s ease-in forwards'
    setTimeout(() => {
      toastEl.remove()
      // Clean up container if empty
      if (container.children.length === 0) {
        container.remove()
      }
    }, 200)
  }, duration)
}
