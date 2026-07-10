import { applyMigrations, bootPostgres } from '@/__tests__/e2e/_shared/postgres-container';

// Vitest global setup: boots a single Postgres container for the entire test
// process, applies Drizzle migrations, and exposes the connection string via
// `process.env.DATABASE_URL` so individual tests can build their own clients
// without re-discovering the host/port.
export default async function globalSetup() {
  const { connectionString } = await bootPostgres();
  await applyMigrations(connectionString);
  process.env.DATABASE_URL = connectionString;
  process.env.LOG_LEVEL = 'silent';
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'integration-anon-key';
  // Public marketing-site base URL — required by clientEnvSchema.
  process.env.NEXT_PUBLIC_SITE_URL ??= 'http://127.0.0.1:3000';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'integration-service-key';
  // Stream SDK — dummy values for integration tests that import serverEnv
  // transitively. The real Stream client is mocked in tests that need it.
  process.env.NEXT_PUBLIC_STREAM_API_KEY ??= 'integration-stream-public-key';
  process.env.STREAM_API_KEY ??= 'integration-stream-api-key';
  process.env.STREAM_API_SECRET ??= 'integration-stream-api-secret';
  process.env.STREAM_WEBHOOK_SECRET ??= 'integration-stream-webhook-secret';
  // Gemini AI transcription — dummy key for integration tests.
  process.env.GEMINI_API_KEY ??= 'integration-gemini-api-key';
  // Inngest encryption — dummy key (min 32 chars) for integration tests.
  process.env.INNGEST_ENCRYPTION_KEY ??= 'integration-inngest-encryption-key-32ch';
  // Inngest signing — dummy key so any transitive import of serverEnv in
  // production mode does not trip the production guard in env/index.ts.
  process.env.INNGEST_SIGNING_KEY ??= 'integration-inngest-signing-key';
  // Signature hash salt — used for hashing IP/user-agent in consent signing.
  process.env.SIGNATURE_HASH_SALT ??= 'integration-test-signature-hash-salt-minimum-32-chars';
  // Pending-email cookie secret — used to HMAC-sign the hp_pending_email cookie.
  process.env.PENDING_EMAIL_COOKIE_SECRET ??=
    'integration-test-pending-email-cookie-secret-min-32-chars';
  // Twilio platform Content SIDs — required server-only vars for the shared-
  // number reminders MVP so env validation passes on transitive serverEnv import.
  process.env.TWILIO_CONTENT_SID_LEMBRETE_24H ??= 'HXint24h';
  process.env.TWILIO_CONTENT_SID_LEMBRETE_2H ??= 'HXint2h';
  process.env.TWILIO_CONTENT_SID_LINK_VIDEO ??= 'HXintvideo';
  process.env.TWILIO_CONTENT_SID_CONFIRMACAO_RECEBIDA ??= 'HXintconfirm';
  process.env.TWILIO_CONTENT_SID_CANCELAMENTO_AVISO ??= 'HXintcancel';
  // Platform shared WhatsApp number — used by lazy provisioning of
  // `whatsapp_accounts` on the first consented reminder-settings save.
  process.env.TWILIO_WHATSAPP_FROM ??= '+551140000000';
  // Twilio webhook HMAC validation — required by the inbound webhook Route
  // Handler to authenticate `X-Twilio-Signature`. Optional in the env schema,
  // so this only affects tests that exercise the Route Handler directly.
  process.env.TWILIO_AUTH_TOKEN ??= 'integration-twilio-auth-token';
  process.env.TWILIO_WEBHOOK_URL ??= 'https://example.com/api/webhooks/twilio/whatsapp';

  return async () => {
    // No teardown — `.withReuse()` keeps the container alive between runs.
    // Use `docker rm -f` manually if you need a clean slate.
  };
}
