// ============================================================
// Tenant credential crypto — unit tests
//
// Run with:
//   node --experimental-strip-types --test src/lib/tokens/__tests__/crypto.test.ts
// ============================================================

import crypto from 'crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptCredential,
  decryptCredential,
} from '../credentialCrypto.ts';

const VALID_KEY = 'a'.repeat(64);
const BASE64_KEY = Buffer.from(crypto.randomBytes(32)).toString('base64');

describe('credential encryption', () => {
  it('round-trips a tenant credential', () => {
    const plaintext = 'tenant-google-refresh-token';
    const encrypted = encryptCredential(plaintext, VALID_KEY);
    const decrypted = decryptCredential(encrypted, VALID_KEY);
    assert.equal(decrypted, plaintext);
  });

  it('round-trips with a base64-encoded key', () => {
    const plaintext = 'tenant-google-refresh-token';
    const encrypted = encryptCredential(plaintext, BASE64_KEY);
    const decrypted = decryptCredential(encrypted, BASE64_KEY);
    assert.equal(decrypted, plaintext);
  });

  it('produces different ciphertexts for the same plaintext', () => {
    const plaintext = 'same-secret';
    const a = encryptCredential(plaintext, VALID_KEY);
    const b = encryptCredential(plaintext, VALID_KEY);
    assert.notEqual(a, b);
  });

  it('rejects a tampered ciphertext', () => {
    const encrypted = encryptCredential('secret', VALID_KEY);
    const tampered = encrypted.slice(0, -4) + 'XXXX';
    assert.throws(() => decryptCredential(tampered, VALID_KEY));
  });

  it('rejects a management-token style v1 ciphertext as a credential', () => {
    const v1Ciphertext = 'v1.aaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaa';
    assert.throws(() => decryptCredential(v1Ciphertext, VALID_KEY));
  });

  it('rejects decryption with a different key', () => {
    const encrypted = encryptCredential('secret', VALID_KEY);
    const otherKey = 'b'.repeat(64);
    assert.throws(() => decryptCredential(encrypted, otherKey));
  });
});

describe('key validation', () => {
  it('throws on an invalid key length', () => {
    assert.throws(
      () => encryptCredential('secret', 'too-short'),
      /64 hex chars or 44 base64 chars/,
    );
  });
});
