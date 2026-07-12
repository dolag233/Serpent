import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/{unit,worker}/**/*.test.ts'],
    coverage: {
      enabled: false,
    },
  },
});
