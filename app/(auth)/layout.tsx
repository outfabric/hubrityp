// Minimal centered layout for the public auth surface (login, future password
// reset, etc.). No global navigation — anonymous visitors should see only the
// auth form. The (auth) route group keeps these pages out of the authenticated
// shell defined in (app)/layout.tsx.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
