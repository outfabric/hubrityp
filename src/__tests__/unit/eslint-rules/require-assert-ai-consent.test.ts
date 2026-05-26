/**
 * Tests for the `require-assert-ai-consent` custom ESLint rule.
 *
 * Uses ESLint's RuleTester to feed fixture code (valid and invalid) through
 * the rule and assert the correct pass/fail behavior. This ensures the
 * guardrail is effective before it ever encounters real source code.
 */

import { type Rule, RuleTester } from 'eslint';
import { describe, it, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS rule loaded for ESLint
const rule = require('../../../../eslint-rules/require-assert-ai-consent.cjs') as Rule.RuleModule;

// RuleTester needs a parser that understands TypeScript import syntax.
// ESLint 9's default parser handles standard ES module syntax fine.
const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
});

describe('eslint: require-assert-ai-consent', () => {
  it('passes when both aiTranscriptions and assertAiConsentActive are imported', () => {
    ruleTester.run('require-assert-ai-consent', rule, {
      valid: [
        {
          // Named imports from the same module
          code: `
            import { aiTranscriptions } from '@/shared/db/schema';
            import { assertAiConsentActive } from '../lib/consent';
          `,
        },
        {
          // Named imports from different modules
          code: `
            import { aiTranscriptions } from '@/shared/db/schema/ai-transcription/tables';
            import { assertAiConsentActive } from '@/modules/ai-transcription';
          `,
        },
        {
          // Both in the same import statement
          code: `
            import { aiTranscriptions } from '@/shared/db/schema';
            import { assertAiConsentActive, createTranscriptionLogger } from '@/modules/ai-transcription';
          `,
        },
      ],
      invalid: [],
    });
  });

  it('fails when aiTranscriptions is imported without assertAiConsentActive', () => {
    ruleTester.run('require-assert-ai-consent', rule, {
      valid: [],
      invalid: [
        {
          // Missing assertAiConsentActive entirely
          code: `
            import { aiTranscriptions } from '@/shared/db/schema';
            import { createTranscriptionLogger } from '@/modules/ai-transcription';
          `,
          errors: [{ messageId: 'missingConsentAssert' }],
        },
        {
          // Only imports the table, nothing else from the module
          code: `
            import { aiTranscriptions } from '@/shared/db/schema/ai-transcription/tables';
          `,
          errors: [{ messageId: 'missingConsentAssert' }],
        },
      ],
    });
  });

  it('passes when neither aiTranscriptions nor assertAiConsentActive are imported', () => {
    ruleTester.run('require-assert-ai-consent', rule, {
      valid: [
        {
          // Unrelated imports — rule should not fire
          code: `
            import { consentTerms } from '@/shared/db/schema';
            import { createTranscriptionLogger } from '@/modules/ai-transcription';
          `,
        },
        {
          // Only assertAiConsentActive without aiTranscriptions — fine
          code: `
            import { assertAiConsentActive } from '@/modules/ai-transcription';
          `,
        },
        {
          // Empty file
          code: `export {};`,
        },
      ],
      invalid: [],
    });
  });

  it('reports one error per aiTranscriptions import node', () => {
    // Edge case: if someone imports aiTranscriptions from two different
    // paths (unusual but possible), both import nodes should be flagged.
    ruleTester.run('require-assert-ai-consent', rule, {
      valid: [],
      invalid: [
        {
          code: `
            import { aiTranscriptions } from '@/shared/db/schema';
            import { aiTranscriptions as t2 } from '@/shared/db/schema/ai-transcription/tables';
          `,
          errors: [{ messageId: 'missingConsentAssert' }, { messageId: 'missingConsentAssert' }],
        },
      ],
    });
  });

  it('verifies the error message mentions the consent requirement', () => {
    const invalidCode = `
      import { aiTranscriptions } from '@/shared/db/schema';
    `;

    // Run through RuleTester and also verify the message content manually
    // by checking that the rule metadata contains the expected guidance.
    const messages = rule.meta?.messages;
    expect(messages).toBeDefined();
    expect(messages!.missingConsentAssert).toContain('assertAiConsentActive');
    expect(messages!.missingConsentAssert).toContain('aiTranscriptions');
    expect(messages!.missingConsentAssert).toContain('active AI consent');

    ruleTester.run('require-assert-ai-consent', rule, {
      valid: [],
      invalid: [
        {
          code: invalidCode,
          errors: [{ messageId: 'missingConsentAssert' }],
        },
      ],
    });
  });
});
