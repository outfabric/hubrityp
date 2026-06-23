/**
 * Single source of truth for the "confirme seu email" pt-BR copy.
 *
 * The same guidance is shown wherever a user encounters the
 * unconfirmed-account condition — the `/verifique-email` page and the login
 * page's `email_not_confirmed` state — so the wording MUST be defined once and
 * reused, keeping the message consistent across surfaces.
 *
 * Copy follows the Design System microcopy tone: direct, human, no emojis.
 *
 * Pure module — strings only, no DB access, no side effects. Safe to import
 * from both Server and Client Components.
 */

/** Heading shown on the confirm-email surfaces. */
export const CONFIRM_EMAIL_TITLE = 'Confirme seu cadastro' as const;

/**
 * Body guidance instructing the user to look for the confirmation link and,
 * if missing, to check the Spam / Trash folders.
 */
export const CONFIRM_EMAIL_BODY =
  'Confirme seu cadastro, através de um link que enviamos para seu email. Se não encontrar, busque na caixa de Spam ou Lixeira.' as const;

/**
 * Generic acknowledgement returned after a resend request.
 *
 * Deliberately neutral: it never confirms whether an account exists for the
 * given email, avoiding account-enumeration leakage.
 */
export const RESEND_CONFIRMATION_ACK =
  'Se houver um cadastro com este email, reenviamos o link de confirmação.' as const;
