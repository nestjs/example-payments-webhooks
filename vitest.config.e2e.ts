import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    env: {
      DATABASE_URL: 'postgres://unused-in-tests',
      JWT_SECRET: 'test-only-jwt-secret-of-at-least-32-bytes',
      // Never called: the tests stub fetch.
      PAYMENTS_API_URL: 'https://payments.invalid',
      PAYMENTS_API_KEY: 'test-only-key',
      PAYMENTS_WEBHOOK_SECRET: 'whsec_dGVzdC1vbmx5LXdlYmhvb2stc2VjcmV0LTMyLWJ5dGVz',
      // The tests run the outbox relay themselves.
      OUTBOX_RELAY: 'off',
    },
  },
});
