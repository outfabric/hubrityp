/**
 * Canonical AI consent template — version 1.
 *
 * This template is the legally binding text shown to patients when a
 * psychologist requests consent for AI-powered session recording and
 * transcription. It is snapshot into `template_snapshot` (jsonb) at
 * generation time so that future edits to the template do NOT affect
 * terms already signed.
 *
 * Placeholders (`{{psychologistName}}`, `{{psychologistCrp}}`,
 * `{{patientName}}`) are replaced at render time — the template itself
 * contains no PII.
 *
 * IMPORTANT: Any change to this text constitutes a new version and MUST
 * go through legal review before merge. See the PR checklist in
 * `openspec/changes/ai-transcription-consent/pr-checklist.md`.
 */

/** A single section of the consent template. */
export interface ConsentTemplateSection {
  heading: string;
  body: string;
}

/** Full shape of the versioned consent template. */
export interface AiConsentTemplate {
  version: number;
  title: string;
  sections: ConsentTemplateSection[];
}

export const AI_CONSENT_TEMPLATE_V1: AiConsentTemplate = {
  version: 1,
  title: 'Termo de Consentimento para Gravação e Transcrição por Inteligência Artificial',
  sections: [
    {
      heading: 'Identificação',
      body:
        'Profissional responsável: {{psychologistName}}, inscrito(a) no Conselho Regional de Psicologia sob o número {{psychologistCrp}}.\n\n' +
        'Paciente: {{patientName}}.',
    },
    {
      heading: 'Finalidade',
      body:
        'A gravação da sessão de atendimento psicológico será realizada exclusivamente para processamento por inteligência artificial (IA), ' +
        'com a finalidade de gerar uma evolução clínica estruturada destinada ao prontuário eletrônico do paciente. ' +
        'A nota gerada pela IA é um rascunho que será revisado e validado pelo psicólogo responsável antes de ser incorporada ao prontuário.',
    },
    {
      heading: 'Bases legais (LGPD)',
      body:
        'O tratamento dos dados pessoais e sensíveis decorrentes da gravação e transcrição fundamenta-se nas seguintes bases legais da ' +
        'Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD):\n\n' +
        '- Art. 7º, inciso II — execução de contrato ou de procedimentos preliminares relacionados a contrato do qual seja parte o titular, ' +
        'a pedido do titular dos dados;\n' +
        '- Art. 11 — tratamento de dados pessoais sensíveis de saúde, realizado exclusivamente para a tutela da saúde do titular, ' +
        'em procedimento realizado por profissional de saúde habilitado;\n' +
        '- Art. 6º — observância aos princípios de finalidade, adequação, necessidade, livre acesso, qualidade dos dados, transparência, ' +
        'segurança, prevenção, não discriminação e responsabilização.',
    },
    {
      heading: 'Operação de tratamento',
      body:
        'Controlador: o psicólogo identificado neste termo, responsável pelas decisões referentes ao tratamento dos dados.\n\n' +
        'Operador: Google Gemini API, utilizada como ferramenta de processamento de linguagem natural para transcrição e geração da nota clínica. ' +
        'O operador atua sob contrato de operador de dados, em conformidade com as cláusulas de proteção de dados aplicáveis.\n\n' +
        'Categorias de dados tratados: áudio da sessão, transcrição textual gerada a partir do áudio e nota clínica estruturada.\n\n' +
        'Transferência de dados: os dados de áudio e transcrição são transmitidos aos servidores do Google sob contrato de operador. ' +
        'Nenhum dado é retido pelo operador além do estritamente necessário para o processamento.',
    },
    {
      heading: 'Retenção',
      body:
        'O áudio da sessão será descartado no prazo máximo de 24 horas após o processamento, salvo em caso de falha técnica ' +
        'que exija extensão temporária desse prazo.\n\n' +
        'A transcrição textual intermediária não é retida após a geração da nota clínica.\n\n' +
        'A nota clínica estruturada, após revisão e validação pelo psicólogo, será incorporada ao prontuário eletrônico do paciente ' +
        'e ficará sob guarda do psicólogo pelo prazo mínimo de 20 (vinte) anos, conforme disposto na Lei nº 13.787/2018.',
    },
    {
      heading: 'Direitos do titular',
      body:
        'Em conformidade com o art. 18 da LGPD, o paciente tem direito a:\n\n' +
        '- Confirmação da existência de tratamento de dados;\n' +
        '- Acesso aos dados pessoais tratados;\n' +
        '- Correção de dados incompletos, inexatos ou desatualizados;\n' +
        '- Anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade;\n' +
        '- Portabilidade dos dados a outro fornecedor de serviço;\n' +
        '- Eliminação dos dados pessoais tratados com o consentimento do titular;\n' +
        '- Revogação do consentimento a qualquer momento, mediante manifestação expressa.',
    },
    {
      heading: 'Revogação',
      body:
        'O paciente pode revogar este consentimento a qualquer momento, com efeito imediato sobre gravações futuras. ' +
        'A revogação não afeta a legalidade do tratamento realizado anteriormente com base no consentimento.\n\n' +
        'As notas clínicas já geradas e incorporadas ao prontuário permanecerão sob guarda do psicólogo ' +
        'em conformidade com a obrigação legal de manutenção do prontuário (Lei nº 13.787/2018).\n\n' +
        'Para solicitar a revogação, o paciente deve comunicar o psicólogo responsável, que efetuará o registro imediato no sistema.',
    },
    {
      heading: 'Riscos',
      body:
        'O paciente deve estar ciente dos seguintes riscos associados ao uso de inteligência artificial:\n\n' +
        '- Alucinação da IA: a nota clínica gerada é um rascunho e pode conter imprecisões, omissões ou informações incorretas. ' +
        'O psicólogo responsável revisará e corrigirá a nota antes de incorporá-la ao prontuário, sendo o único responsável pelo conteúdo final.\n\n' +
        '- Falhas técnicas: eventuais falhas no processamento ou na infraestrutura podem estender temporariamente o prazo de descarte do áudio ' +
        'além das 24 horas previstas. Nesses casos, medidas técnicas serão adotadas para minimizar o período de retenção adicional.',
    },
  ],
} as const;
