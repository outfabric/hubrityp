import type { Metadata } from 'next';
import * as React from 'react';

import { Container, LegalReviewNotice, absoluteUrl } from '@/modules/marketing';

/**
 * Política de Privacidade — public legal page (task 9.1).
 *
 * A static Server Component (no client interactivity, no authenticated data,
 * no Supabase access). It is reachable anonymously: the `(public)` route group
 * is classified `'public'` by `middleware.ts:classifyPath()` (the explicit
 * `/politica-de-privacidade` prefix), so it never redirects to /login — this is
 * a prerequisite for the consent and signup flows that link here.
 *
 * Layout: rendered inside the shared `(public)` layout (which already provides
 * the `<main>` landmark), wrapped in the `reading` Container variant (720px max)
 * for a comfortable prose measure per the DS reading-column convention.
 *
 * Content is REFERENCE text (see `LegalReviewNotice`) — a placeholder draft to
 * be reviewed with legal before publishing. Each section carries a stable
 * heading `id` so the footer / other pages can deep-link to it; the LGPD
 * section is anchored as `#lgpd` (linked from the footer's "LGPD" item).
 */
export const metadata: Metadata = {
  title: 'Política de Privacidade | Hubrity',
  description:
    'Como a Hubrity coleta, usa, armazena e protege os dados pessoais e clínicos na plataforma para psicólogos, em conformidade com a LGPD.',
  alternates: {
    canonical: absoluteUrl('/politica-de-privacidade'),
  },
};

type LegalSection = {
  id: string;
  title: string;
  body: React.ReactNode;
};

const SECTIONS: ReadonlyArray<LegalSection> = [
  {
    id: 'introducao',
    title: '1. Introdução',
    body: (
      <p>
        Esta Política de Privacidade descreve como a Hubrity trata os dados pessoais de psicólogos
        usuários da plataforma e dos respectivos pacientes. Ao utilizar a plataforma, você declara
        estar ciente das práticas aqui descritas. Os dados são armazenados no Brasil (região
        sa-east-1).
      </p>
    ),
  },
  {
    id: 'dados-coletados',
    title: '2. Dados que coletamos',
    body: (
      <p>
        Coletamos dados de cadastro do psicólogo (nome, e-mail, número de CRP), dados de pacientes
        inseridos por você (nome, contato, histórico clínico) e dados de uso da plataforma. Você é o
        responsável pelos dados clínicos que insere; a Hubrity atua como operadora desses dados.
      </p>
    ),
  },
  {
    id: 'finalidade',
    title: '3. Finalidade do tratamento',
    body: (
      <p>
        Tratamos os dados para prestar os serviços da plataforma: agenda, prontuário, cobrança,
        lembretes via WhatsApp e emissão de documentos. Não utilizamos dados clínicos de pacientes
        para finalidades publicitárias.
      </p>
    ),
  },
  {
    id: 'compartilhamento',
    title: '4. Compartilhamento com terceiros',
    body: (
      <p>
        Compartilhamos dados apenas com operadores necessários à prestação do serviço (por exemplo,
        provedor de infraestrutura e provedor de mensageria), sob contrato e com garantias de
        segurança. Não vendemos seus dados.
      </p>
    ),
  },
  {
    id: 'lgpd',
    title: '5. Seus direitos sob a LGPD',
    body: (
      <p>
        Em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), você pode
        solicitar a confirmação do tratamento, o acesso, a correção, a anonimização, a portabilidade
        e a eliminação dos seus dados, além de revogar consentimentos. Para exercer esses direitos,
        entre em contato pelos canais de suporte da Hubrity.
      </p>
    ),
  },
  {
    id: 'cookies',
    title: '6. Cookies e tecnologias semelhantes',
    body: (
      <p>
        Utilizamos cookies essenciais para autenticação e preferências (como tema claro/escuro) e,
        mediante o seu consentimento, cookies de análise de uso. Você pode gerenciar suas
        preferências de cookies pelo banner de consentimento exibido na primeira visita.
      </p>
    ),
  },
  {
    id: 'seguranca',
    title: '7. Segurança e retenção',
    body: (
      <p>
        Adotamos medidas técnicas e organizacionais para proteger os dados, incluindo criptografia
        em trânsito e isolamento por usuário. Os dados são retidos pelo período necessário ao
        cumprimento das finalidades e das obrigações legais aplicáveis.
      </p>
    ),
  },
  {
    id: 'alteracoes',
    title: '8. Alterações desta política',
    body: (
      <p>
        Esta política pode ser atualizada periodicamente. Alterações relevantes serão comunicadas na
        plataforma. A versão vigente é sempre a publicada nesta página.
      </p>
    ),
  },
  {
    id: 'contato',
    title: '9. Contato e encarregado (DPO)',
    body: (
      <p>
        Para dúvidas sobre privacidade ou para exercer seus direitos, utilize os canais de suporte
        da Hubrity. O encarregado pelo tratamento de dados (DPO) responderá às solicitações nos
        prazos previstos em lei.
      </p>
    ),
  },
];

export default function PrivacyPolicyPage(): React.JSX.Element {
  return (
    <Container width="reading" className="py-16">
      <h1 className="text-display-md text-text-primary">Política de Privacidade</h1>

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
