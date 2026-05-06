import { ForgotPasswordForm } from '@/modules/password-recovery';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

import { requestPasswordReset } from './actions';

export default function ForgotPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recuperar senha</CardTitle>
        <CardDescription>
          Informe seu e-mail para receber um link de recuperação de senha.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ForgotPasswordForm action={requestPasswordReset} />
      </CardContent>
    </Card>
  );
}
