import type { GeneratedNote } from './schemas';

/**
 * Serializes a structured AI-generated note into the `livre` evolution
 * content shape (`{ conteudo: string }`).
 *
 * The `livre` template stores a single freeform rich-text field, which is the
 * right destination for an AI draft: the structured `GeneratedNote` keys do
 * not map 1:1 onto any single clinical template (TCC/psicanálise/etc.), and
 * forcing a mapping would lose information. Instead we render a readable
 * Markdown document the psychologist can edit freely in the evolution editor.
 *
 * The output is plain Markdown (matching what existing `livre` evolutions
 * store as free text). Empty/`null` sections are omitted so the draft stays
 * clean. The result always has at least a non-empty heading, so the
 * `conteudo: z.string().min(1)` constraint on the evolution schema is met.
 */
export function serializeNoteAsEvolution(note: GeneratedNote): { conteudo: string } {
  const lines: string[] = ['# Nota gerada por IA (revisada)'];

  const section = (heading: string, body: string | null) => {
    if (body && body.trim().length > 0) {
      lines.push('', `## ${heading}`, body.trim());
    }
  };

  const listSection = (heading: string, items: string[]) => {
    const cleaned = items.map((item) => item.trim()).filter((item) => item.length > 0);
    if (cleaned.length > 0) {
      lines.push('', `## ${heading}`, ...cleaned.map((item) => `- ${item}`));
    }
  };

  section('Humor inicial', note.humorInicial);
  section('Humor final', note.humorFinal);
  listSection('Pauta', note.pauta);
  listSection('Conteúdo trabalhado', note.conteudoTrabalhado);
  listSection('Tarefa de casa', note.tarefaCasa);
  listSection('Palavras de risco', note.palavrasRisco);
  section('Observações extras', note.observacoesExtras);

  return { conteudo: lines.join('\n') };
}
