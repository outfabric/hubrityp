import { AlertCircle } from 'lucide-react';

import { Card, CardContent } from '@/shared/ui/card';

/**
 * Custom 404 for the patient video join surface (`/v/:token`).
 *
 * Triggered when the RSC shell calls `notFound()` because the token format is
 * invalid (not 64-char lowercase hex). Keeps the same visual language as the
 * other public token-gated pages (centered card, icon, message).
 */
export default function VideoJoinNotFound() {
  return (
    <div className="flex flex-col items-center gap-6 py-16">
      <Card className="w-full">
        <CardContent className="flex flex-col items-center gap-4 p-6 text-center md:p-8">
          <AlertCircle className="text-danger-500 h-12 w-12" aria-hidden="true" />
          <h2 className="text-text-primary text-[22px] leading-tight font-semibold">
            Link de sessão inválido
          </h2>
          <p className="text-text-secondary text-[15px]">
            Verifique o link ou entre em contato com seu psicólogo.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
