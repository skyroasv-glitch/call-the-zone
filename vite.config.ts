import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Honour a PORT handed down by the launcher; otherwise Vite's own default.
  server: process.env.PORT ? { port: Number(process.env.PORT) } : undefined,
})
