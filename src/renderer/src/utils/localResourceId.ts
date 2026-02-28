import {
  createLocalResourceId,
  createLocalResourceIdFromUid,
  getLocalResourceFileTitle,
  isLocalResourceId,
  isLocalResourceUidRef,
  parseLocalResourceId,
  type LocalResourceRef,
} from '../../../shared/local-resource-id'

export {
  createLocalResourceId,
  createLocalResourceIdFromUid,
  getLocalResourceFileTitle,
  isLocalResourceId,
  isLocalResourceUidRef,
  parseLocalResourceId,
  type LocalResourceRef,
}

export function getLocalSearchFileTitle(relativePath: string): string {
  return getLocalResourceFileTitle(relativePath)
}
