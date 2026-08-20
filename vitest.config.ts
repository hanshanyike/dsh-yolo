// Vitest config — CRITICAL: only run YOLO's own tests.
// Without the exclude, vitest's default include also sweeps the gitignored
// dev host (host/deepseek-harness/**) which carries 200+ spec files and hangs
// on Windows (the "empty output / killed task" root cause).
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['host/**', 'node_modules/**', 'dist/**'],
    // forks pool is more stable than worker threads on Windows
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
})
