import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { execSync } from 'node:child_process'

function copyWasmPlugin() {
  return {
    name: 'copy-wasm',
    buildStart() {
      if (!process.env.VITEST) {
        execSync('node scripts/copy-wasm.mjs', { stdio: 'inherit' })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), svelteTesting(), copyWasmPlugin()],
  optimizeDeps: {
    exclude: ['@neth4ck/api', '@neth4ck/neth4ck', '@neth4ck/wasm-367', '@neth4ck/wasm-37'],
  },
  test: {
    environment: 'node',
    setupFiles: ['src/test-setup.ts'],
    // Component tests (*.component.test.ts) use jsdom for DOM rendering;
    // all other tests stay on node for speed.
    environmentMatchGlobs: [
      ['**/*.component.test.ts', 'jsdom'],
    ],
  },
})
