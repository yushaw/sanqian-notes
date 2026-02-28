import type { IpcMainInvokeEvent } from 'electron'

/**
 * Wraps an IPC handler with a try/catch boundary that logs the channel name
 * and re-throws. This prevents silent failures and gives the renderer a
 * readable rejection instead of an opaque crash.
 *
 * Handlers that already contain domain-specific try/catch (e.g. returning
 * `{ success: false, errorCode }`) do NOT need this wrapper -- their own
 * error handling is more informative.
 */
export function createSafeHandler<T extends unknown[], R>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: T) => R | Promise<R>
): (event: IpcMainInvokeEvent, ...args: T) => Promise<R> {
  return async (event, ...args) => {
    try {
      return await handler(event, ...args)
    } catch (error) {
      console.error(`[IPC] ${channel} failed:`, error)
      throw error
    }
  }
}
