import { Container } from '@/modules/marketing';

/**
 * Public homepage — interim placeholder.
 *
 * The full marketing homepage body (hero, features, pricing, CTAs) ships in
 * the `public-homepage` change. For now this renders a minimal placeholder.
 * The `(public)` layout already provides the `<main>` landmark, so this page
 * MUST NOT add its own `<main>` wrapper.
 */
export default function HomePage() {
  return (
    <Container className="py-16">
      <h1 className="text-display-md text-text-primary">Hubrity</h1>
      <p className="text-text-secondary mt-4">Plataforma para psicólogos.</p>
    </Container>
  );
}
