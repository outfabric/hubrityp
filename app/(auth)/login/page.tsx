import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { LoginForm } from './login-form';

// Next 16: `searchParams` is a Promise. We await it so the Server Component
// can read `redirectTo` and pass it down to the client form, which forwards
// it as a hidden input to the `signIn` Server Action.
type LoginPageProps = {
  searchParams: Promise<{ redirectTo?: string | string[] }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const rawRedirect = params.redirectTo;
  const redirectTo = Array.isArray(rawRedirect) ? rawRedirect[0] : rawRedirect;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entrar</CardTitle>
        <CardDescription>Acesse sua conta HubrityP.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm redirectTo={redirectTo} />
      </CardContent>
    </Card>
  );
}
