/**
 * AES-256-GCM encryption for sensitive at-rest fields (EIN, and any future
 * SSN/account-number-class data). Ported from conduit-next's
 * lib/crypto/encrypt.ts unchanged — SERVER-ONLY, decrypt() must never run
 * in a client component.
 *
 * Key: ENCRYPTION_KEY (64 hex chars = 32 bytes) if set; otherwise derived
 * from the service-role key via SHA-256 so the feature works before a
 * dedicated key is provisioned. Set ENCRYPTION_KEY in prod for key
 * rotation independence from Supabase credentials.
 */
import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function key(): Buffer {
  const k = process.env.ENCRYPTION_KEY;
  if (k && /^[0-9a-fA-F]{64}$/.test(k)) return Buffer.from(k, 'hex');
  const seed = process.env.ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'credit-coach-iq-fallback';
  return createHash('sha256').update(seed).digest();
}

/** Returns "iv:authTag:ciphertext" (all hex). */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}

export function decrypt(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(':');
  if (!ivHex || !tagHex || !dataHex) throw new Error('Malformed ciphertext');
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(dataHex, 'hex')).toString('utf8') + decipher.final('utf8');
}

/** Last-4 masking for display ("••••1234") without ever revealing the full value. */
export function maskTail(value: string): string {
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}
