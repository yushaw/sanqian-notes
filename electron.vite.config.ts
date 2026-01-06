import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin({
      // Don't externalize sanqian-chat - it needs to be bundled into preload
      exclude: ['@yushaw/sanqian-chat']
    })],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          chat: resolve('src/preload/chat.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          chat: resolve('src/renderer/chat.html')
        },
        external: ['@yushaw/sanqian-sdk']
      }
    }
  }
})
