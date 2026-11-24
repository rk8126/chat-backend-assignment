import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  FIRESTORE_EMULATOR_HOST: z.string().min(1, 'FIRESTORE_EMULATOR_HOST is required (e.g. firestore:8080)'),
  FIREBASE_PROJECT_ID: z.string().min(1).default('demo-chat-backend'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\nStart the app with: docker compose up`);
  }
  return parsed.data;
}
