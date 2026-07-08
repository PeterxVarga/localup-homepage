// ============================================================
// Secure management token handling
//
// Format:
//   raw token       : 32 random bytes, hex-encoded (64 chars)
//   token hash      : SHA-256(raw token), hex (lookup in DB)
//   encrypted token : v1.<base64url(iv)>.<base64url(authTag)>.<base64url(ciphertext)>
//
// The raw token is used in the manage URL. The hash is indexed for lookups.
// The encrypted value is stored so reminder emails can reconstruct the URL.
// ============================================================

import crypto from 'crypto';
import { env } from '../env';

const TOKEN_BYTES = 32;
const TOKEN_PREFIX = 'v1';
const ALGO = 'aes-256-gcm';
const IV_LEN = 16;
const TAG_LEN = 16;

function getKey(): Buffer {
  const key = env.bookingTokenEncryptionKey;
  if (!key) {
    throw new Error('BOOKING_TOKEN_ENCRYPTION_KEY is not configured');
  }

  if (key.length === 64) {
    // Hex-encoded 32-byte key
    return Buffer.from(key, 'hex');
  }

  if (key.length === 44) {
    // Base64-encoded 32-byte key
    return Buffer.from(key, 'base64');
  }

  throw new Error(
    'BOOKING_TOKEN_ENCRYPTION_KEY must be 64 hex chars or 44 base64 chars',
  );
}

/** Generate a new cryptographically secure raw management token. */
export function generateManagementToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

/** Hash a raw token for database lookup. */
export function hashManagementToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Encrypt a raw token for database storage. */
export function encryptManagementToken(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    TOKEN_PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

/** Decrypt a stored encrypted token back to the raw token. */
export function decryptManagementToken(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split('.');
  if (parts.length !== 4 || parts[0] !== TOKEN_PREFIX) {
    throw new Error('Invalid encrypted token format');
  }

  const [, ivB64, tagB64, encryptedB64] = parts;
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const encrypted = Buffer.from(encryptedB64, 'base64url');

  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new Error('Invalid encrypted token components');
  }

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    'utf8',
  );
}

/** Verify that a raw token matches a stored encrypted token. */
export function verifyManagementToken(
  rawToken: string,
  encryptedToken: string,
): boolean {
  try {
    return decryptManagementToken(encryptedToken) === rawToken;
  } catch {
    return false;
  }
}
