import { LembretesTabs } from '@/app/(app)/configuracoes/lembretes/lembretes-tabs';

/**
 * Layout for the Lembretes settings section. Renders the underline tab
 * navigation above the page content. The breadcrumb is already provided by
 * the parent `configuracoes/layout.tsx` — this layout only adds the tabs.
 */
export default function LembretesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LembretesTabs />
      <div className="border-border mb-6 border-b" />
      {children}
    </>
  );
}
