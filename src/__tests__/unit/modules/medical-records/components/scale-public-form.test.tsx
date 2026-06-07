import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScalePublicForm } from '@/modules/medical-records/components/scale-public-form';
import type { ScaleQuestion } from '@/modules/medical-records/lib/scales/types';

// ---------------------------------------------------------------------------
// Test data — PHQ-9 (9 questions, 4 options each)
// ---------------------------------------------------------------------------

const PHQ9_OPTIONS = [
  { value: 0, label: 'Nenhuma vez' },
  { value: 1, label: 'Varios dias' },
  { value: 2, label: 'Mais da metade dos dias' },
  { value: 3, label: 'Quase todos os dias' },
];

const PHQ9_QUESTIONS: ScaleQuestion[] = Array.from({ length: 9 }, (_, i) => ({
  id: `q${i + 1}`,
  prompt: `Pergunta ${i + 1}`,
  options: PHQ9_OPTIONS,
}));

const TEST_TOKEN = 'a'.repeat(64);

// ---------------------------------------------------------------------------
// Fetch mock
// ---------------------------------------------------------------------------

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderForm(questions: ScaleQuestion[] = PHQ9_QUESTIONS, token: string = TEST_TOKEN) {
  return render(<ScalePublicForm questions={questions} token={token} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScalePublicForm', () => {
  describe('renders correct number of RadioGroups', () => {
    it('renders 9 RadioGroups for PHQ-9', () => {
      renderForm();

      // Each question renders a RadioGroup with a data-testid
      for (let i = 1; i <= 9; i++) {
        expect(screen.getByTestId(`scale-question-q${i}`)).toBeInTheDocument();
      }
    });

    it('renders each question prompt', () => {
      renderForm();

      for (let i = 1; i <= 9; i++) {
        expect(screen.getByText(`${i}. Pergunta ${i}`)).toBeInTheDocument();
      }
    });

    it('renders all 4 options per question (36 total radio inputs)', () => {
      renderForm();

      const radios = screen.getAllByRole('radio');
      // 9 questions * 4 options = 36
      expect(radios).toHaveLength(36);
    });
  });

  describe('submit button state', () => {
    it('submit button is disabled when no questions are answered', () => {
      renderForm();

      const submitBtn = screen.getByTestId('scale-submit-button');
      expect(submitBtn).toBeDisabled();
    });

    it('submit button is disabled when only some questions are answered', async () => {
      const user = userEvent.setup();
      renderForm();

      // Answer only the first question (use ID to avoid ambiguity)
      const firstRadio = document.getElementById('q1-0');
      expect(firstRadio).toBeTruthy();
      await user.click(firstRadio!);

      const submitBtn = screen.getByTestId('scale-submit-button');
      expect(submitBtn).toBeDisabled();
    });

    it('submit button is enabled when all questions are answered', async () => {
      const user = userEvent.setup();
      renderForm();

      // Answer all 9 questions by clicking the first option of each
      for (let i = 1; i <= 9; i++) {
        const radioId = `q${i}-0`;
        const radioInput = document.getElementById(radioId);
        expect(radioInput).toBeTruthy();
        await user.click(radioInput!);
      }

      const submitBtn = screen.getByTestId('scale-submit-button');
      expect(submitBtn).toBeEnabled();
    });
  });

  describe('success message after submit', () => {
    it('shows success message after a successful submit', async () => {
      const user = userEvent.setup();

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      renderForm();

      // Answer all 9 questions
      for (let i = 1; i <= 9; i++) {
        const radioId = `q${i}-0`;
        const radioInput = document.getElementById(radioId);
        await user.click(radioInput!);
      }

      // Click submit
      const submitBtn = screen.getByTestId('scale-submit-button');
      await user.click(submitBtn);

      // Wait for success state
      await waitFor(() => {
        expect(screen.getByTestId('scale-submit-success')).toBeInTheDocument();
      });

      expect(
        screen.getByText('Suas respostas foram enviadas ao seu psicólogo.'),
      ).toBeInTheDocument();

      // Verify fetch was called with correct URL and body
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe(`/api/scales/${TEST_TOKEN}`);
      expect(init?.method).toBe('POST');

      const body = JSON.parse(init?.body as string) as { responses: Record<string, number> };
      expect(Object.keys(body.responses)).toHaveLength(9);
    });

    it('shows error message on server error', async () => {
      const user = userEvent.setup();

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, code: 'INTERNAL_ERROR' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      renderForm();

      // Answer all 9 questions
      for (let i = 1; i <= 9; i++) {
        const radioId = `q${i}-0`;
        const radioInput = document.getElementById(radioId);
        await user.click(radioInput!);
      }

      // Click submit
      const submitBtn = screen.getByTestId('scale-submit-button');
      await user.click(submitBtn);

      // Wait for error state
      await waitFor(() => {
        expect(screen.getByTestId('scale-submit-error')).toBeInTheDocument();
      });

      expect(
        screen.getByText('Não foi possível enviar suas respostas. Tente novamente.'),
      ).toBeInTheDocument();
    });

    it('shows error message on network failure', async () => {
      const user = userEvent.setup();

      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      renderForm();

      // Answer all 9 questions
      for (let i = 1; i <= 9; i++) {
        const radioId = `q${i}-0`;
        const radioInput = document.getElementById(radioId);
        await user.click(radioInput!);
      }

      // Click submit
      const submitBtn = screen.getByTestId('scale-submit-button');
      await user.click(submitBtn);

      // Wait for error state
      await waitFor(() => {
        expect(screen.getByTestId('scale-submit-error')).toBeInTheDocument();
      });

      expect(
        screen.getByText('Erro de conexão. Verifique sua internet e tente novamente.'),
      ).toBeInTheDocument();
    });
  });
});
