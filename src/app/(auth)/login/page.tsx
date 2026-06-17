import { CheckCircle2 } from 'lucide-react';

import { LoginForm } from '@/modules/auth';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

/** Allowed banner values shown as success messages above the login form. */
type LoginBanner = 'password_changed' | 'account_linked';

const BANNER_COPY: Record<LoginBanner, string> = {
  password_changed: 'Senha redefinida com sucesso. Faça login novamente.',
  account_linked: 'Conta Google vinculada com sucesso.',
};

function isValidBanner(value: string | undefined): value is LoginBanner {
  return value === 'password_changed' || value === 'account_linked';
}

// Next 16: `searchParams` is a Promise. We await it so the Server Component
// can read `redirectTo` and `banner` and pass them down to the client form.
type LoginPageProps = {
  searchParams: Promise<{ redirectTo?: string | string[]; banner?: string | string[] }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const rawRedirect = params.redirectTo;
  const redirectTo = Array.isArray(rawRedirect) ? rawRedirect[0] : rawRedirect;

  const rawBanner = Array.isArray(params.banner) ? params.banner[0] : params.banner;
  const banner = isValidBanner(rawBanner) ? rawBanner : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entrar</CardTitle>
        <CardDescription>Acesse sua conta Hubrity.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {banner ? (
          <Alert variant="success" data-testid={`login-banner-${banner}`}>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>{BANNER_COPY[banner]}</AlertDescription>
          </Alert>
        ) : null}
        <LoginForm redirectTo={redirectTo} />
      </CardContent>
    </Card>
  );
}
