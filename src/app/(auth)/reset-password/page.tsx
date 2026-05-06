import { ResetPasswordForm } from '@/modules/password-recovery';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

import { resetPassword } from './actions';

export default function ResetPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Redefinir senha</CardTitle>
        <CardDescription>Escolha uma nova senha forte para sua conta.</CardDescription>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm action={resetPassword} />
      </CardContent>
    </Card>
  );
}
