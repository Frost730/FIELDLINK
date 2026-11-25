import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react()
  ],
  build: {
    chunkSizeWarningLimit: 1100,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'maplibre',
              test: /node_modules[\\/]maplibre-gl/,
            },
            {
              name: 'vendor',
              test: /node_modules[\\/](react|react-dom|lucide-react|zustand|mgrs)/,
            },
          ],
        },
      },
    },
  },
})
