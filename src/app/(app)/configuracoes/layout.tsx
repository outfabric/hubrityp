import { SettingsBreadcrumb } from '@/app/(app)/configuracoes/settings-breadcrumb';

/**
 * Settings section layout. Renders the breadcrumb navigation above the page
 * content inside a max-width container. Does NOT duplicate the app-shell
 * chrome (header/sidebar) — those are inherited from `(app)/layout.tsx`.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1200px]">
      <SettingsBreadcrumb />
      <div className="mt-4">{children}</div>
    </div>
  );
}
