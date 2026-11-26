import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.url(),
  // Signs the access tokens: at least 32 bytes.
  JWT_SECRET: z.string().min(32),
  // The browser origins allowed to call the API, comma-separated. None by default.
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean))
    .pipe(z.array(z.url())),
  // The payment provider's API, and the key it gave you.
  PAYMENTS_API_URL: z.url(),
  PAYMENTS_API_KEY: z.string().min(1),
  // Verifies the provider's webhooks: whsec_ and base64, from the provider's dashboard.
  PAYMENTS_WEBHOOK_SECRET: z.string().startsWith('whsec_'),
  // "off" in tests, which run the outbox relay themselves.
  OUTBOX_RELAY: z.enum(['on', 'off']).default('on'),
});

export type Env = z.infer<typeof envSchema>;
