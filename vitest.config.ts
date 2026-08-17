import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Windows CI runners are slower; the 5s vitest default flakes heavy
    // worker tests (schema chains, write fencing, model pipeline).
    testTimeout: 120_000,
    include: ['tests/{unit,worker}/**/*.test.ts'],
    coverage: {
      enabled: false,
    },
  },
});
