// Get management token for a booking ID (used by E2E tests)
// Load .env manually BEFORE importing modules that read env.ts
import fs from 'fs';

const envFile = fs.readFileSync('.env', 'utf8');
for (const line of envFile.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx === -1) continue;
  const key = trimmed.slice(0, idx);
  const value = trimmed.slice(idx + 1).trim();
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

const bookingId = process.argv[2];
if (!bookingId) {
  console.error('Usage: npx tsx get-test-token.ts <bookingId>');
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

const { createClient } = await import('@supabase/supabase-js');
const { decryptManagementToken } = await import('./src/lib/tokens/crypto');

const supabase = createClient(supabaseUrl, serviceRoleKey);

const { data, error } = await supabase
  .from('audit_bookings')
  .select('management_token_encrypted')
  .eq('id', bookingId)
  .single();

if (error || !data?.management_token_encrypted) {
  console.error('Failed to fetch encrypted token:', error);
  process.exit(1);
}

console.log(decryptManagementToken(data.management_token_encrypted));
