import { z } from 'zod';
import type { PendingSigner, SignerRepo } from '../../entities/signon-db/index.js';
import { seal } from '../../shared/crypto/index.js';
import { SignonError } from '../../shared/errors/signon.js';
import { geocodeServer } from './geocode.js';
import { serverDistrictsAt, type ServerDistricts } from './districts.js';
import { hashEmail, hashIp, hashToken, newToken } from './hash.js';
import { checkRateLimit } from './rate-limit.js';
import { verifyTurnstile } from './turnstile.js';

export const SignRequestSchema = z.strictObject({
  address: z.string().min(4).max(200),
  email: z.email().max(254),
  turnstileToken: z.string().min(1).max(2048),
  consentUpdates: z.boolean(),
  showPublic: z.boolean(),
  displayName: z.string().max(40).nullable(),
  ref: z.string().length(8).nullable(),
});
export type SignRequest = z.infer<typeof SignRequestSchema>;

/** What the flow needs from the backend config. */
export interface SignConfig {
  turnstileSecret: string;
  hashSecret: Buffer;
  encryptionKey: Buffer;
  siteOrigin: string;
}

/** Puts an email in the outbox; supplied by the API layer (features do not import each other). */
export type EnqueueEmail = (kind: 'confirm' | 'remove', signerId: string, to: string, token: string) => Promise<{ queued: boolean }>;

export interface SignDeps {
  config: SignConfig;
  repo: SignerRepo;
  enqueue: EnqueueEmail;
  fetchFn: typeof fetch;
  now: () => Date;
  /** Defaults to the real lookup from the site's published files; tests may replace it. */
  districtsAt?: (state: string, lonLat: [number, number]) => Promise<ServerDistricts>;
}

export interface SignResult {
  status: 'check-email';
  noteDropped: string | null;
  queued: boolean;
}

/** The sign flow. Steps stop at the first failure. The street address lives only in this function's locals and is never logged or stored. */
export async function sign(body: unknown, ip: string, deps: SignDeps): Promise<SignResult> {
  const parsed = SignRequestSchema.safeParse(body);
  if (!parsed.success) throw new SignonError('bad-request');
  const req = parsed.data;
  const { config, repo } = deps;

  await verifyTurnstile(req.turnstileToken, config.turnstileSecret, ip, deps.fetchFn);
  await checkRateLimit(repo, hashIp(ip, config.hashSecret), deps.now());

  const found = await geocodeServer(req.address, deps.fetchFn);
  const lookup = deps.districtsAt ?? ((s, p) => serverDistrictsAt(s, p, { origin: config.siteOrigin, fetchFn: deps.fetchFn }));
  const districts = await lookup(found.state, found.lonLat);

  const emailHash = hashEmail(req.email, config.hashSecret);
  const done: SignResult = { status: 'check-email', noteDropped: null, queued: false };
  if (await repo.isConfirmed(emailHash)) return done;

  const token = newToken();
  const publicName = req.showPublic && req.displayName ? req.displayName : null;
  const row: PendingSigner = {
    emailHash,
    emailEnc: req.consentUpdates ? seal(req.email, config.encryptionKey) : null,
    consentUpdates: req.consentUpdates,
    state: found.state,
    usHouse: districts.usHouse,
    stateHouse: districts.stateHouse,
    stateSenate: districts.stateSenate,
    displayNameEnc: publicName ? seal(publicName, config.encryptionKey) : null,
    townEnc: req.showPublic && found.town ? seal(found.town, config.encryptionKey) : null,
    showPublic: req.showPublic,
    tokenHash: hashToken(token),
    refCode: req.ref,
  };
  const signer = await repo.upsertPending(row);
  if (!signer) return done;

  const { queued } = await deps.enqueue('confirm', signer.id, req.email, token);
  return { ...done, queued };
}
