import type { Metadata } from 'next';
import * as React from 'react';

import { Container, LegalReviewNotice, absoluteUrl } from '@/modules/marketing';

/**
 * Termos de Uso — public legal page (task 9.2).
 *
 * A static Server Component (no client interactivity, no authenticated data,
 * no Supabase access). Reachable anonymously: the `(public)` route group is
 * classified `'public'` by `middleware.ts:classifyPath()` (the explicit
 * `/termos-de-uso` prefix), so it never redirects to /login — a prerequisite
 * for the consent and signup flows that link here.
 *
 * Layout: rendered inside the shared `(public)` layout (which already provides
 * the `<main>` landmark), wrapped in the `reading` Container variant (720px max)
 * per the DS reading-column convention.
 *
 * Content is REFERENCE text (see `LegalReviewNotice`) — a placeholder draft to
 * be reviewed with legal before publishing. Required sections per the spec:
 * elegibilidade (CRP ativo), planos, cancelamento, propriedade intelectual,
 * responsabilidade, lei aplicável / CDC.
 */
export const metadata: Metadata = {
  title: 'Termos de Uso | Hubrity',
  description:
    'Termos e condições de uso da Hubrity: elegibilidade, planos, cancelamento, propriedade intelectual, responsabilidades e lei aplicável.',
  alternates: {
    canonical: absoluteUrl('/termos-de-uso'),
  },
};

type LegalSection = {
  id: string;
  title: string;
  body: React.ReactNode;
};

const SECTIONS: ReadonlyArray<LegalSection> = [
  {
    id: 'aceitacao',
    title: '1. Aceitação dos termos',
    body: (
      <p>
        Ao criar uma conta ou utilizar a Hubrity, você concorda com estes Termos de Uso e com a
        Política de Privacidade. Caso não concorde, não utilize a plataforma.
      </p>
    ),
  },
  {
    id: 'elegibilidade',
    title: '2. Elegibilidade (CRP ativo)',
    body: (
      <p>
        A plataforma destina-se a psicólogos autônomos com inscrição ativa e regular no Conselho
        Regional de Psicologia (CRP). Ao se cadastrar, você declara possuir CRP ativo e ser o
        responsável profissional pelos atendimentos registrados. A Hubrity pode validar o número de
        CRP informado e suspender contas com registro irregular.
      </p>
    ),
  },
  {
    id: 'planos',
    title: '3. Planos e pagamento',
    body: (
      <p>
        Os planos, recursos incluídos e valores vigentes são apresentados na página de Preços. As
        cobranças são recorrentes conforme o plano contratado. Eventuais reajustes serão comunicados
        previamente.
      </p>
    ),
  },
  {
    id: 'cancelamento',
    title: '4. Cancelamento',
    body: (
      <p>
        Você pode cancelar a assinatura a qualquer momento pelas configurações da conta. O acesso
        permanece ativo até o fim do período já pago. Após o cancelamento, seus dados podem ser
        exportados e, decorrido o prazo de retenção, são eliminados conforme a Política de
        Privacidade.
      </p>
    ),
  },
  {
    id: 'responsabilidade-usuario',
    title: '5. Responsabilidades do usuário',
    body: (
      <p>
        Você é responsável pela veracidade dos dados inseridos, pelo sigilo profissional dos dados
        clínicos dos pacientes e pelo cumprimento das normas do Conselho Federal de Psicologia. Você
        deve manter suas credenciais de acesso seguras.
      </p>
    ),
  },
  {
    id: 'propriedade-intelectual',
    title: '6. Propriedade intelectual',
    body: (
      <p>
        A marca, o software, o design e os demais elementos da plataforma são de titularidade da
        Hubrity, protegidos pela legislação aplicável. O uso da plataforma não transfere qualquer
        direito de propriedade intelectual. Os dados clínicos inseridos permanecem de titularidade
        do psicólogo e de seus pacientes.
      </p>
    ),
  },
  {
    id: 'limitacao-responsabilidade',
    title: '7. Limitação de responsabilidade',
    body: (
      <p>
        A Hubrity envida esforços para manter a plataforma disponível e segura, mas não garante
        funcionamento ininterrupto. A Hubrity não se responsabiliza pela conduta profissional do
        psicólogo nem por decisões clínicas, que são de exclusiva responsabilidade do usuário.
      </p>
    ),
  },
  {
    id: 'lei-aplicavel',
    title: '8. Lei aplicável e foro (CDC)',
    body: (
      <p>
        Estes Termos são regidos pelas leis brasileiras, incluindo o Código de Defesa do Consumidor
        (Lei nº 8.078/1990) quando aplicável. Fica eleito o foro do domicílio do usuário para
        dirimir eventuais controvérsias, salvo disposição legal em contrário.
      </p>
    ),
  },
  {
    id: 'alteracoes',
    title: '9. Alterações dos termos',
    body: (
      <p>
        Estes Termos podem ser atualizados periodicamente. Alterações relevantes serão comunicadas
        na plataforma. O uso continuado após a atualização implica aceitação da nova versão.
      </p>
    ),
  },
];

export default function TermsOfUsePage(): React.JSX.Element {
  return (
    <Container width="reading" className="py-16">
      <h1 className="text-display-md text-text-primary">Termos de Uso</h1>

      <LegalReviewNotice className="mt-6" />

      <div className="mt-10 flex flex-col gap-10">
        {SECTIONS.map((section) => (
          <section key={section.id} id={section.id} className="scroll-mt-24">
            <h2 className="text-text-primary text-xl font-semibold">{section.title}</h2>
            <div className="text-text-secondary mt-3 leading-relaxed">{section.body}</div>
          </section>
        ))}
      </div>
    </Container>
  );
}
