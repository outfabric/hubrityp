// Shared helpers for distributing a patient consent term via WhatsApp / copy
// link. Extracted from `patient-detail-header.tsx` (design D4) so the row-action
// component and the detail header can reuse a single canonical implementation —
// most importantly the canonical WhatsApp message text.

/** Extracts digits from a phone string for building a wa.me link. */
export function extractPhoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

/** Builds the public consent-term URL for a given origin and token. */
export function buildConsentUrl(origin: string, token: string): string {
  return `${origin}/termo/${token}`;
}

/**
 * Builds a `wa.me` consent link with the canonical pre-filled message.
 * For minors, the caller passes the primary guardian's phone.
 */
export function buildConsentWhatsAppHref(phone: string, consentUrl: string): string {
  const digits = extractPhoneDigits(phone);
  const message = encodeURIComponent(
    `Olá! Segue o link para assinatura do termo de consentimento: ${consentUrl}`,
  );
  return `https://wa.me/${digits}?text=${message}`;
}
