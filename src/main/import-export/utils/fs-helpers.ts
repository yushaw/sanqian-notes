import { constants as fsConstants } from 'fs'
import { access } from 'fs/promises'

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}
