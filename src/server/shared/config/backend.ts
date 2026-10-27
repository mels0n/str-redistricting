import { z } from 'zod';
import { ConfigError } from '../errors/index.js';

// The only place the backend's environment variable names appear (build/migrate.ts holds the Postgres one).
// Supabase: project URL NEXT_PUBLIC_BACKERS_SUPABASE_URL, server key BACKERS_SUPABASE_SECRET_KEY.

const key32 = z
  .string()
  .min(1)
  .transform((s) => Buffer.from(s, 'base64'))
  .refine((b) => b.length === 32, 'must be base64 that decodes to 32 bytes');

const Schema = z.object({
  NEXT_PUBLIC_BACKERS_SUPABASE_URL: z.url(),
  BACKERS_SUPABASE_SECRET_KEY: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  SIGNON_HASH_SECRET: key32,
  SIGNON_ENCRYPTION_KEY: key32,
  VERCEL_ENV: z.string().optional(),
  SIGNON_FROM: z.string().min(1).default('Fair Maps <signon@fairmaps.melson.us>'),
  SITE_ORIGIN: z.url().default('https://fairmaps.melson.us'),
});

export interface BackendConfig {
  supabaseUrl: string;
  supabaseKey: string;
  resendApiKey: string;
  turnstileSecret: string;
  hashSecret: Buffer;
  encryptionKey: Buffer;
  vercelEnv: string | undefined;
  from: string;
  siteOrigin: string;
}

let cached: BackendConfig | null = null;

/** Validates the environment once, at the first request. Errors name the keys, never their values. */
export function loadBackendConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  if (env === process.env && cached) return cached;
  const parsed = Schema.safeParse(env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
    throw new ConfigError(`Invalid backend configuration: ${keys.join(', ')}`);
  }
  const v = parsed.data;
  const config: BackendConfig = {
    supabaseUrl: v.NEXT_PUBLIC_BACKERS_SUPABASE_URL,
    supabaseKey: v.BACKERS_SUPABASE_SECRET_KEY,
    resendApiKey: v.RESEND_API_KEY,
    turnstileSecret: v.TURNSTILE_SECRET_KEY,
    hashSecret: v.SIGNON_HASH_SECRET,
    encryptionKey: v.SIGNON_ENCRYPTION_KEY,
    vercelEnv: v.VERCEL_ENV,
    from: v.SIGNON_FROM,
    siteOrigin: v.SITE_ORIGIN,
  };
  if (env === process.env) cached = config;
  return config;
}
