import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CrpReviewPage } from '@/modules/account-lifecycle/components/crp-review-page';

// Tests for `<CrpReviewPage/>`. The component is a pure Server Component
// (no `'use client'`, no client-side state) — every observable is in its
// JSX output. We render it with React Testing Library; React's renderer
// happily evaluates a function component synchronously regardless of
// whether it carries `'use server'` or `'use client'` (those directives
// only matter to the Next.js bundler).

describe('<CrpReviewPage/>', () => {
  const defaultProps = {
    crpNumber: '06/123456',
    crpUf: 'SP',
    contactEmail: 'suporte@hubrityp.com.br',
    signOutAction: vi.fn().mockResolvedValue(undefined),
  };

  describe('render contract — primary branch (CRP 06/123456 / SP)', () => {
    it('renders the heading "Validando seu CRP"', () => {
      render(<CrpReviewPage {...defaultProps} />);
      expect(screen.getByText('Validando seu CRP')).toBeInTheDocument();
    });

    it('renders the CRP number and UF in the body', () => {
      render(<CrpReviewPage {...defaultProps} />);
      const crpNode = screen.getByTestId('crp-review-number');
      expect(crpNode).toBeInTheDocument();
      expect(crpNode).toHaveTextContent('06/123456 / SP');
    });

    it('renders the 24-hour validation note', () => {
      render(<CrpReviewPage {...defaultProps} />);
      expect(screen.getByText(/até 24 horas/i)).toBeInTheDocument();
    });

    it('renders the contact email as a mailto link', () => {
      render(<CrpReviewPage {...defaultProps} />);
      const link = screen.getByTestId('crp-review-contact');
      expect(link).toBeInTheDocument();
      expect(link).toHaveTextContent('suporte@hubrityp.com.br');
      expect(link).toHaveAttribute('href', 'mailto:suporte@hubrityp.com.br');
    });

    it('renders the logout button inside a form action with the correct testid and label', () => {
      render(<CrpReviewPage {...defaultProps} />);
      const logout = screen.getByTestId('crp-review-logout');
      expect(logout).toBeInTheDocument();
      expect(logout).toHaveTextContent('Sair');
      expect(logout).toHaveAttribute('type', 'submit');
      expect(logout.closest('form')).not.toBeNull();
    });
  });

  describe('render contract — alternative branch (CRP 11/000099 / RJ)', () => {
    // Pin a second CRP/UF combination to confirm the component is fully
    // prop-driven (no hardcoded values for the primary case).
    it('renders the alternative CRP number and UF', () => {
      render(<CrpReviewPage {...defaultProps} crpNumber="11/000099" crpUf="RJ" />);
      expect(screen.getByTestId('crp-review-number')).toHaveTextContent('11/000099 / RJ');
    });

    it('renders an alternative contact email', () => {
      render(<CrpReviewPage {...defaultProps} contactEmail="ajuda@example.com" />);
      const link = screen.getByTestId('crp-review-contact');
      expect(link).toHaveTextContent('ajuda@example.com');
      expect(link).toHaveAttribute('href', 'mailto:ajuda@example.com');
    });
  });

  describe('logout action', () => {
    it('renders the logout button inside a form (signOutAction is the form action)', () => {
      const signOutAction = vi.fn().mockResolvedValue(undefined);
      render(<CrpReviewPage {...defaultProps} signOutAction={signOutAction} />);

      const form = screen.getByTestId('crp-review-logout').closest('form');
      expect(form).not.toBeNull();
      // React's Server Action prop on `<form action={...}>` does not surface
      // as a DOM `action` attribute (it stays in the React fiber), so we
      // can't assert on the function reference from JSDOM. The integration
      // test for the route shell exercises the full Server Action wiring.
    });
  });
});
