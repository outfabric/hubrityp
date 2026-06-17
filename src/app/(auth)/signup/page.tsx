import { SignupForm } from '@/modules/registration';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

import { signUp } from './actions';

// Server Component shell for `/signup`. The (auth) route group keeps this
// page out of the authenticated app shell, mirrors the `/login` layout, and
// hands the production `signUp` Server Action to the Client form. The
// action wiring goes through the local `./actions.ts` shell — the form
// MUST receive an action that has crossed a `'use server'` boundary so the
// Next.js compiler emits a client-safe RPC stub. Importing from
// `@/modules/registration` directly here would be fine (the barrel re-
// exports the impl), but the shell pattern is what the existing `/login`
// page uses and we keep it for consistency.
export default function SignupPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Criar conta</CardTitle>
        <CardDescription>Cadastre-se para começar a usar o Hubrity.</CardDescription>
      </CardHeader>
      <CardContent>
        <SignupForm action={signUp} />
      </CardContent>
    </Card>
  );
}
