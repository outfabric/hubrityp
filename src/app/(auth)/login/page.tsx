import { LoginForm } from '@/modules/auth';
import { GoogleButton } from '@/modules/oauth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

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
      <CardContent className="space-y-4">
        <LoginForm redirectTo={redirectTo} />
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card text-muted-foreground px-2">ou</span>
          </div>
        </div>
        <GoogleButton />
      </CardContent>
    </Card>
  );
}
