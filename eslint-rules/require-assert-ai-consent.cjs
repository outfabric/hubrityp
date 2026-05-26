/**
 * ESLint rule: require-assert-ai-consent
 *
 * Enforces that any file in `ai-transcription/server/**` or
 * `ai-transcription/inngest/**` that imports `aiTranscriptions` (the Drizzle
 * table) also imports `assertAiConsentActive` in the same file.
 *
 * This prevents future Server Actions or Inngest functions from accidentally
 * touching audio/transcription data without first verifying that the patient
 * has an active AI consent. The `assertAiConsentActive` helper is the single
 * authority for "is AI recording allowed?".
 *
 * The rule only fires when `aiTranscriptions` is imported WITHOUT a
 * corresponding `assertAiConsentActive` import in the same file.
 */

'use strict';

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require `assertAiConsentActive` import when `aiTranscriptions` table is imported in ai-transcription server/inngest code.',
    },
    messages: {
      missingConsentAssert:
        'Importing `aiTranscriptions` without also importing `assertAiConsentActive` in the same file. ' +
        'Every server/inngest file that touches the transcription table must call `assertAiConsentActive` ' +
        'to verify the patient has active AI consent before proceeding. ' +
        'Import it from `@/modules/ai-transcription` or `../lib/consent`.',
    },
    schema: [],
  },

  create(context) {
    /** @type {import('estree').ImportDeclaration[]} */
    const aiTranscriptionImportNodes = [];
    let hasAssertAiConsentActive = false;

    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          const name =
            specifier.type === 'ImportSpecifier'
              ? specifier.imported.name
              : specifier.type === 'ImportDefaultSpecifier'
                ? specifier.local.name
                : null;

          if (name === 'aiTranscriptions') {
            aiTranscriptionImportNodes.push(node);
          }
          if (name === 'assertAiConsentActive') {
            hasAssertAiConsentActive = true;
          }
        }
      },

      'Program:exit'() {
        if (aiTranscriptionImportNodes.length > 0 && !hasAssertAiConsentActive) {
          for (const node of aiTranscriptionImportNodes) {
            context.report({
              node,
              messageId: 'missingConsentAssert',
            });
          }
        }
      },
    };
  },
};
