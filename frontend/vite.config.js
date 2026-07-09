import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  build: {
    // Enable code splitting
    rollupOptions: {
      output: {
        manualChunks: {
          // Split vendor chunks
          'react-vendor': ['react', 'react-dom'],
          'livekit-vendor': ['livekit-client', '@livekit/components-react'],
          'utils-vendor': ['axios'],
        },
      },
    },
    // Enable compression
    chunkSizeWarningLimit: 1000,
    // Optimize chunk size
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
  },
  // Optimize dependencies
  optimizeDeps: {
    include: ['react', 'react-dom', 'livekit-client', '@livekit/components-react', 'axios'],
  },
})
