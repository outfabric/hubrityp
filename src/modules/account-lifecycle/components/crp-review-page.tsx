import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

// `<CrpReviewPage/>` is the bloqueante page rendered for users in
// `pending_crp_validation`. It has NO interactivity beyond the logout
// `<form action={...}>`, so we keep it as a Server Component — that lets
// the route shell pass a Server Action directly into the form without
// going through a client-side action import. The `'use client'` directive
// is intentionally absent here.

export type CrpReviewPageProps = {
  /** CRP registration number, e.g. "06/123456". */
  crpNumber: string;
  /** Brazilian state UF the CRP is registered in, e.g. "SP". */
  crpUf: string;
  /** Contact email surfaced to the user for follow-up questions. */
  contactEmail: string;
  /**
   * Server Action that signs the user out and redirects to /login. Wrapped in
   * a `<form action={...}>` so it works even with JavaScript disabled.
   */
  signOutAction: () => Promise<void>;
};

export function CrpReviewPage({
  crpNumber,
  crpUf,
  contactEmail,
  signOutAction,
}: CrpReviewPageProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Validando seu CRP</CardTitle>
        <CardDescription>
          Estamos validando seu CRP{' '}
          <span data-testid="crp-review-number" className="text-foreground font-medium">
            {crpNumber} / {crpUf}
          </span>
          . Pode levar até 24 horas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Dúvidas? Escreva para{' '}
          <a
            href={`mailto:${contactEmail}`}
            data-testid="crp-review-contact"
            className="text-primary underline-offset-4 hover:underline"
          >
            {contactEmail}
          </a>
          .
        </p>

        <form action={signOutAction}>
          <Button type="submit" variant="ghost" data-testid="crp-review-logout" className="w-full">
            Sair
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
