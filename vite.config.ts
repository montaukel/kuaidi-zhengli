import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '快递整理',
        short_name: '快递整理',
        description: '在设备本地识别、整理和管理快递截图',
        theme_color: '#3157d5',
        background_color: '#f5f7fb',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: './',
        scope: './',
        lang: 'zh-CN',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/tesseract\.js-core/,
            handler: 'CacheFirst',
            options: { cacheName: 'ocr-core', expiration: { maxEntries: 12, maxAgeSeconds: 31536000 } }
          },
          {
            urlPattern: /^https:\/\/tessdata\.projectnaptha\.com/,
            handler: 'CacheFirst',
            options: { cacheName: 'ocr-language', expiration: { maxEntries: 6, maxAgeSeconds: 31536000 } }
          }
        ]
      }
    })
  ]
})
