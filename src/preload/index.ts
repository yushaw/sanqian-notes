import { contextBridge, ipcRenderer } from 'electron'

// Expose APIs to renderer
contextBridge.exposeInMainWorld('electron', {
  note: {
    getAll: () => ipcRenderer.invoke('note:getAll'),
    getById: (id: string) => ipcRenderer.invoke('note:getById', id),
    add: (note: unknown) => ipcRenderer.invoke('note:add', note),
    update: (id: string, updates: unknown) => ipcRenderer.invoke('note:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('note:delete', id),
    search: (query: string) => ipcRenderer.invoke('note:search', query),
    createDemo: () => ipcRenderer.invoke('note:createDemo'),
  },
  notebook: {
    getAll: () => ipcRenderer.invoke('notebook:getAll'),
    add: (notebook: unknown) => ipcRenderer.invoke('notebook:add', notebook),
    update: (id: string, updates: unknown) => ipcRenderer.invoke('notebook:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('notebook:delete', id),
  },
  tag: {
    getAll: () => ipcRenderer.invoke('tag:getAll'),
    getByNote: (noteId: string) => ipcRenderer.invoke('tag:getByNote', noteId),
  },
  theme: {
    get: () => ipcRenderer.invoke('theme:get'),
    onChange: (callback: (theme: 'light' | 'dark') => void) => {
      ipcRenderer.on('theme:changed', (_, theme) => callback(theme))
    },
  },
  platform: {
    get: () => ipcRenderer.invoke('platform:get'),
  },
})
