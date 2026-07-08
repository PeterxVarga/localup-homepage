// Get management token for a booking ID (used by E2E tests)
import { createClient } from '@supabase/supabase-js';
import { decryptManagementToken } from './src/lib/tokens/crypto';

const bookingId = process.argv[2];
if (!bookingId) {
  console.error('Usage: npx tsx get-test-token.ts <bookingId>');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

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
