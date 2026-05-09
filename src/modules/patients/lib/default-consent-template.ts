// ---------------------------------------------------------------------------
// Default consent term template for psychologist–patient relationships.
//
// Provides the legally compliant consent text used when the psychologist has
// not configured a custom template. Covers all CFP and LGPD requirements:
//   1. Psychologist identification
//   2. Service description
//   3. LGPD data treatment clause (art. 7 V + VIII)
//   4. Data subject rights
//   5. Retention period (minimum 5 years per CFP)
//   6. Recording policy
//   7. Fee and cancellation policy
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DefaultConsentTemplateData = {
  /** Full name of the psychologist (e.g., "Maria da Silva"). */
  psychologistName: string;
  /** CRP registration number with UF (e.g., "06/123456"). */
  psychologistCrp: string;
};

// ---------------------------------------------------------------------------
// Template builder
// ---------------------------------------------------------------------------

/**
 * Returns the default consent term text with the psychologist's identification
 * interpolated. The returned string is stored as `term_text` in the
 * `consent_terms` table and rendered both on the signing page and in the
 * signed PDF.
 *
 * The template is written in Brazilian Portuguese and follows:
 *   - CFP Code of Ethics (Código de Ética Profissional do Psicólogo)
 *   - LGPD (Lei nº 13.709/2018), especially articles 7 (V and VIII),
 *     11 (II-f), 17, and 18
 *   - CFP Resolution nº 01/2009 (minimum 5-year data retention)
 *
 * All monetary values and specific scheduling policies use placeholder
 * markers (e.g., "[valor da sessão]") so the psychologist knows where to
 * customize when they eventually create their own template.
 */
export function getDefaultConsentTemplate(data: DefaultConsentTemplateData): string {
  const { psychologistName, psychologistCrp } = data;

  return [
    // --- 1. Identificação do psicólogo ---
    'TERMO DE CONSENTIMENTO INFORMADO PARA TRATAMENTO PSICOLÓGICO',
    '',
    `Psicólogo(a) responsável: ${psychologistName}`,
    `Registro profissional: CRP ${psychologistCrp}`,
    '',

    // --- 2. Descrição do serviço ---
    '1. DO SERVIÇO',
    '',
    'O(a) paciente abaixo identificado(a) declara que foi informado(a) sobre a natureza do ' +
      'atendimento psicológico oferecido pelo(a) profissional acima identificado(a), incluindo:',
    '- Os objetivos e a metodologia do acompanhamento psicológico;',
    '- A duração estimada do processo terapêutico, que será avaliada continuamente;',
    '- Os possíveis benefícios e limitações do tratamento;',
    '- O sigilo profissional e suas exceções legais, conforme o Código de Ética Profissional ' +
      'do Psicólogo (Resolução CFP nº 010/2005) e a legislação vigente.',
    '',

    // --- 3. Cláusula LGPD ---
    '2. DO TRATAMENTO DE DADOS PESSOAIS (LGPD)',
    '',
    'Em conformidade com a Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018), ' +
      'informo que os dados pessoais e dados pessoais sensíveis coletados durante o atendimento ' +
      'psicológico serão tratados com as seguintes bases legais:',
    '',
    'a) Execução de contrato ou de procedimentos preliminares relacionados a contrato do qual ' +
      'o titular seja parte (art. 7º, V, LGPD) — para viabilizar a prestação do serviço de ' +
      'atendimento psicológico contratado;',
    '',
    'b) Tutela da saúde, exclusivamente, em procedimento realizado por profissional de saúde ' +
      '(art. 7º, VIII, LGPD e art. 11, II, "f", LGPD) — para o tratamento de dados pessoais ' +
      'sensíveis (informações sobre saúde mental) estritamente necessários ao acompanhamento ' +
      'psicológico.',
    '',
    'Os dados coletados incluem, mas não se limitam a: dados de identificação pessoal, dados ' +
      'de contato, histórico clínico, anotações de sessão, relatórios e laudos psicológicos. ' +
      'Esses dados serão utilizados exclusivamente para a finalidade do atendimento psicológico ' +
      'e não serão compartilhados com terceiros, exceto quando houver obrigação legal ou ' +
      'autorização expressa do titular.',
    '',

    // --- 4. Direitos do titular ---
    '3. DOS DIREITOS DO TITULAR DOS DADOS',
    '',
    'Conforme os artigos 17 e 18 da LGPD, o(a) paciente tem direito a:',
    '- Confirmação da existência de tratamento de seus dados pessoais;',
    '- Acesso aos dados pessoais tratados;',
    '- Correção de dados incompletos, inexatos ou desatualizados;',
    '- Anonimização, bloqueio ou eliminação de dados desnecessários ou excessivos;',
    '- Portabilidade dos dados a outro prestador de serviço;',
    '- Informação sobre com quem os dados foram compartilhados;',
    '- Informação sobre a possibilidade de não fornecer consentimento e suas consequências;',
    '- Revogação do consentimento a qualquer tempo, sem prejuízo do tratamento realizado ' +
      'anteriormente.',
    '',
    'Para exercer seus direitos, o(a) paciente pode entrar em contato diretamente com o(a) ' +
      'psicólogo(a) responsável.',
    '',

    // --- 5. Prazo de retenção ---
    '4. DO PRAZO DE RETENÇÃO DOS DADOS',
    '',
    'Os dados pessoais e registros clínicos serão mantidos pelo prazo mínimo de 5 (cinco) anos ' +
      'após o último atendimento, conforme exigido pela Resolução CFP nº 01/2009 e pelo Código ' +
      'de Ética Profissional do Psicólogo. Após esse período, os dados poderão ser eliminados ' +
      'ou anonimizados, salvo quando houver obrigação legal de guarda por prazo superior.',
    '',

    // --- 6. Política de gravação ---
    '5. DA GRAVAÇÃO DE SESSÕES',
    '',
    'As sessões de atendimento psicológico NÃO serão gravadas (áudio ou vídeo), salvo quando ' +
      'houver acordo prévio, específico e por escrito entre o(a) psicólogo(a) e o(a) paciente, ' +
      'especificando a finalidade da gravação. Em caso de gravação autorizada, o material será ' +
      'armazenado de forma segura e eliminado após cumprir sua finalidade.',
    '',

    // --- 7. Valor e política de cancelamento ---
    '6. DO VALOR E DA POLÍTICA DE CANCELAMENTO',
    '',
    'O valor de cada sessão é de R$ [valor da sessão], a ser pago conforme combinado entre ' +
      'as partes. O(a) paciente compromete-se a comunicar eventual cancelamento ou ' +
      'reagendamento com antecedência mínima de [horas de antecedência] horas. Cancelamentos ' +
      'fora desse prazo poderão ser cobrados integralmente.',
    '',

    // --- Consentimento ---
    '7. DO CONSENTIMENTO',
    '',
    'Ao assinar eletronicamente este termo, o(a) paciente declara que:',
    '- Leu e compreendeu todas as informações acima;',
    '- Consente com o tratamento psicológico proposto;',
    '- Autoriza o tratamento de seus dados pessoais e dados pessoais sensíveis nas condições ' +
      'descritas;',
    '- Está ciente de que poderá revogar este consentimento a qualquer momento, sem prejuízo ' +
      'do tratamento já realizado.',
  ].join('\n');
}
