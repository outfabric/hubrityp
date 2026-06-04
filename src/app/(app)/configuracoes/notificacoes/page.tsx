import { Suspense } from 'react';

import { getNotificationPreferencesForOwner } from '@/modules/notifications';
import { createServerClient } from '@/shared/supabase/server';

import { NotificationPreferencesForm } from './notification-preferences-form';

// ---------------------------------------------------------------------------
// Inner async component that fetches data
// ---------------------------------------------------------------------------

async function NotificationPreferencesServer() {
  const supabase = await createServerClient();
  const result = await getNotificationPreferencesForOwner(supabase);

  if (!result.ok) {
    return (
      <div className="text-text-secondary py-12 text-center">
        Erro ao carregar preferências. Tente novamente.
      </div>
    );
  }

  return <NotificationPreferencesForm preferences={result.preferences} />;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function NotificationPreferencesPage() {
  return (
    <>
      <div className="mb-6">
        <h1
          className="text-text-primary text-[28px] leading-[1.25] font-semibold"
          data-testid="notification-preferences-page-title"
        >
          Notificações
        </h1>
        <p className="text-text-secondary mt-1 text-[15px]">
          Escolha como e quando você quer ser avisado.
        </p>
      </div>

      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        }
      >
        <NotificationPreferencesServer />
      </Suspense>
    </>
  );
}
