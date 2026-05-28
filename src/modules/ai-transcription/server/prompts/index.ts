import 'server-only';

import type { RiskSensitivity } from '@/modules/ai-transcription/lib/schemas';
import type { TranscriptionTemplate } from '@/modules/ai-transcription/lib/schemas';

import * as noteAba from './note-aba';
import * as noteLivre from './note-livre';
import * as notePsicanalise from './note-psicanalise';
import * as noteSistemica from './note-sistemica';
import * as noteTcc from './note-tcc';

// Re-export the transcription prompt for the audio-to-text step.
export {
  PROMPT_VERSION as TRANSCRIPTION_PROMPT_VERSION,
  TRANSCRIPTION_SYSTEM_INSTRUCTION,
} from './transcription';

/**
 * Shape of a note prompt module. Every template file exports these two members.
 */
export interface NotePromptModule {
  readonly PROMPT_VERSION: number;
  readonly buildSystemInstruction: (sensitivity: RiskSensitivity) => string;
}

/**
 * Returns the prompt module for the given template.
 *
 * This is the single entry point for the pipeline to resolve which
 * system instruction + version to use when generating a clinical note.
 *
 * @throws {Error} If the template is not recognized (should never happen
 *   because `TranscriptionTemplate` is a closed Zod enum — the throw is
 *   a defense-in-depth exhaustiveness check).
 */
export function getNotePromptModule(template: TranscriptionTemplate): NotePromptModule {
  switch (template) {
    case 'tcc':
      return noteTcc;
    case 'psicanalise':
      return notePsicanalise;
    case 'sistemica':
      return noteSistemica;
    case 'aba':
      return noteAba;
    case 'livre':
      return noteLivre;
    default: {
      // Exhaustiveness check — ensures a compile-time error if a new
      // template value is added to the enum without a corresponding case.
      const _exhaustive: never = template;
      throw new Error(`Unknown transcription template: ${String(_exhaustive)}`);
    }
  }
}
