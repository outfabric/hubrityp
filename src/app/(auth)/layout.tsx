import { Logo } from '@/shared/ui/logo';

// Minimal centered layout for the public auth surface (login, future password
// reset, etc.). No global navigation — anonymous visitors should see only the
// auth form. The (auth) route group keeps these pages out of the authenticated
// shell defined in (app)/layout.tsx.
//
// The centered Logo is intentionally non-interactive (no <a> wrapper): adding a
// link here would create a navigation affordance on the anonymous auth surface,
// which this layout deliberately omits. It also does not affect route gating —
// that stays owned by src/middleware.ts.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col items-center">
        <Logo variant="lockup-v" className="mb-8 h-24 w-auto" />
        <div className="w-full">{children}</div>
      </div>
    </div>
  );
}
