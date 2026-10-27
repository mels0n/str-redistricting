import { z } from 'zod';
import { ConfigError } from '../errors/index.js';

// The only place the backend's environment variable names appear (build/migrate.ts holds the Postgres one).
// Supabase: project URL NEXT_PUBLIC_BACKERS_SUPABASE_URL, server key BACKERS_SUPABASE_SECRET_KEY.

const key32 = z
  .string()
  .min(1)
  .transform((s) => Buffer.from(s, 'base64'))
  .refine((b) => b.length === 32, 'must be base64 that decodes to 32 bytes');

const httpsUrl = z.url({ protocol: /^https$/ });
const httpsOrLocal = z.string().refine((s) => /^https:\/\/[^/]/.test(s) || /^http:\/\/localhost(:\d+)?$/.test(s), 'must be https');

const DbSchema = z.object({
  NEXT_PUBLIC_BACKERS_SUPABASE_URL: httpsUrl,
  BACKERS_SUPABASE_SECRET_KEY: z.string().min(1),
});

const Schema = DbSchema.extend({
  RESEND_API_KEY: z.string().min(1),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  SIGNON_HASH_SECRET: key32,
  SIGNON_ENCRYPTION_KEY: key32,
  VERCEL_ENV: z.string().optional(),
  SIGNON_FROM: z.string().min(1).default('Fair Maps <signon@fairmaps.melson.us>'),
  SITE_ORIGIN: httpsOrLocal.default('https://fairmaps.melson.us'),
  EMAIL_DAILY_CAP: z.coerce.number().int().min(1).max(100000).default(20),
  // Not created by Vercel: the owner adds it as a Production environment variable (16 or more random characters). Vercel then sends it
  // as a bearer token on the daily cron call, and the drain endpoint refuses every request without it.
  CRON_SECRET: z.string().min(1).optional(),
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
  emailDailyCap: number;
  cronSecret: string | undefined;
}

let cached: BackendConfig | null = null;
let cachedDb: { supabaseUrl: string; supabaseKey: string } | null = null;

/** Just what the database client needs, so a health check does not depend on the mail, bot-check or crypto keys. */
export function loadDbConfig(env: NodeJS.ProcessEnv = process.env): { supabaseUrl: string; supabaseKey: string } {
  if (env === process.env && cachedDb) return cachedDb;
  const parsed = DbSchema.safeParse(env);
  if (!parsed.success) throw new ConfigError(`Invalid backend configuration: ${[...new Set(parsed.error.issues.map((i) => String(i.path[0])))].join(', ')}`);
  const out = { supabaseUrl: parsed.data.NEXT_PUBLIC_BACKERS_SUPABASE_URL, supabaseKey: parsed.data.BACKERS_SUPABASE_SECRET_KEY };
  if (env === process.env) cachedDb = out;
  return out;
}

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
    emailDailyCap: v.EMAIL_DAILY_CAP,
    cronSecret: v.CRON_SECRET,
  };
  if (env === process.env) cached = config;
  return config;
}

/** Just the key that seals notes, names and towns, so reading them back does not depend on the mail or bot-check keys. */
export function loadEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const parsed = z.object({ SIGNON_ENCRYPTION_KEY: key32 }).safeParse(env);
  if (!parsed.success) throw new ConfigError('Invalid backend configuration: SIGNON_ENCRYPTION_KEY');
  return parsed.data.SIGNON_ENCRYPTION_KEY;
}
