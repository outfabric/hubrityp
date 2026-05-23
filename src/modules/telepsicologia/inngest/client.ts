/**
 * Inngest client for the telepsicologia module.
 *
 * Re-exports the shared Inngest client from the whatsapp module.
 * All modules in the monolith share a single Inngest app (id: 'hubrityp')
 * so the client is the same instance. Re-exporting here keeps each
 * module's imports self-contained — consumers import from their own
 * module's inngest/client, not from a sibling module.
 */

export { inngest } from '@/modules/whatsapp/inngest/client';
