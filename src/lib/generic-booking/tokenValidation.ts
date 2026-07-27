// ============================================================
// Generic booking — management token validation
//
// The raw management token is a 64-character hex string (32 random bytes).
// Reject malformed or oversized input before hashing/logging it.
// ============================================================

const TOKEN_HEX_LENGTH = 64;
const TOKEN_HEX_REGEX = /^[a-f0-9]{64}$/i;

export function isValidManagementTokenFormat(rawToken: string): boolean {
  return (
    typeof rawToken === 'string' &&
    rawToken.length === TOKEN_HEX_LENGTH &&
    TOKEN_HEX_REGEX.test(rawToken)
  );
}
