// ============================================================
// Tenant credential crypto — domain-separated AES-256-GCM
//
// Pure helpers that receive the key as a parameter. The key is sourced from
// BOOKING_TOKEN_ENCRYPTION_KEY by the caller (src/lib/tokens/crypto.ts).
//
// Domain separation:
//   * management tokens keep their existing v1 format without AAD;
//   * tenant credentials use the c1 prefix and a domain-specific AAD,
//     so a management-token ciphertext cannot be decrypted as a credential
//     and vice versa.
// ============================================================

import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 16;
const TAG_LEN = 16;
const CREDENTIAL_PREFIX = 'c1';
const CREDENTIAL_DOMAIN = 'calendar-credential';

function parseKey(key: string): Buffer {
  if (key.length === 64) {
    return Buffer.from(key, 'hex');
  }

  if (key.length === 44) {
    return Buffer.from(key, 'base64');
  }

  throw new Error(
    'BOOKING_TOKEN_ENCRYPTION_KEY must be 64 hex chars or 44 base64 chars',
  );
}

/**
 * Encrypt plaintext with the credential domain AAD and version prefix.
 * A fresh cryptographically random IV is generated for every call.
 */
export function encryptCredential(plaintext: string, key: string): string {
  const keyBuf = parseKey(key);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, keyBuf, iv);
  cipher.setAAD(Buffer.from(CREDENTIAL_DOMAIN, 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    CREDENTIAL_PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

/**
 * Decrypt a credential ciphertext. Wrong prefix, malformed payload, bad key,
 * or mismatched AAD all fail-closed with a generic error.
 */
export function decryptCredential(ciphertext: string, key: string): string {
  const keyBuf = parseKey(key);
  const parts = ciphertext.split('.');
  if (parts.length !== 4 || parts[0] !== CREDENTIAL_PREFIX) {
    throw new Error('Invalid encrypted credential format');
  }

  const [, ivB64, tagB64, encryptedB64] = parts;
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const encrypted = Buffer.from(encryptedB64, 'base64url');

  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new Error('Invalid encrypted credential components');
  }

  const decipher = crypto.createDecipheriv(ALGO, keyBuf, iv);
  decipher.setAuthTag(tag);
  decipher.setAAD(Buffer.from(CREDENTIAL_DOMAIN, 'utf8'));
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8');
}
