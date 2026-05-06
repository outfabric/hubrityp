import { LinkAccountForm } from '@/modules/oauth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

import { linkOAuthIdentity } from './actions';

// `/auth/link-account?pendingUserId=<uuid>` — shown when an OAuth sign-in
// detects an existing account with the same email. The user must confirm
// ownership by entering their existing password.

type LinkAccountPageProps = {
  searchParams: Promise<{ pendingUserId?: string | string[] }>;
};

export default async function LinkAccountPage({ searchParams }: LinkAccountPageProps) {
  const params = await searchParams;
  const rawPendingUserId = params.pendingUserId;
  const pendingUserId = Array.isArray(rawPendingUserId) ? rawPendingUserId[0] : rawPendingUserId;

  if (!pendingUserId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Vincular conta</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-destructive text-sm">Solicitacao invalida.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vincular conta</CardTitle>
        <CardDescription>
          Ja existe uma conta com este email. Informe sua senha para vincular sua conta Google.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LinkAccountForm pendingUserId={pendingUserId} action={linkOAuthIdentity} />
      </CardContent>
    </Card>
  );
}
