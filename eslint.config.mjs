import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import prettierConfig from 'eslint-config-prettier';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'playwright/.cache/**',
      // Generated Playwright run artifacts (gitignored). Their bundled,
      // minified JS must never be linted — linting it produces hundreds of
      // false positives after an e2e run.
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
      '.husky/**',
      '.claude/**',
      'openspec/**',
      'docs/**',
      '.temp/**',
    ],
  },
  ...nextCoreWebVitals,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      import: importPlugin,
    },
    rules: {
      ...tsPlugin.configs['recommended-type-checked'].rules,
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 5,
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message: 'Do not use enum. Use a union of string literals or `as const` object instead.',
        },
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'Do not access `process.env` outside `src/shared/env/`. Import the validated `serverEnv` or `clientEnv` instead.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../*'],
              message: 'Use the @/ path alias instead of deep relative imports.',
            },
          ],
        },
      ],
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'vitest.setup.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  // `src/shared/env/` is the validation boundary itself; CLI files and
  // `next.config.ts` run outside the Next.js bundle and therefore cannot
  // import `server-only` to reach `serverEnv`. All are allowed to read
  // `process.env` directly.
  {
    files: [
      'src/shared/env/index.ts',
      'src/shared/env/client.ts',
      'next.config.ts',
      'drizzle.config.ts',
      'scripts/db-migrate.ts',
      'vitest.setup.ts',
      'playwright.seeded.config.ts',
      'playwright.real.config.ts',
      'src/__tests__/integration/setup/**',
      'src/__tests__/e2e/_shared/**',
      'src/__tests__/e2e/seeded/setup/**',
      'src/__tests__/e2e/real/setup/**',
      'src/__tests__/e2e/real/**',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message: 'Do not use enum. Use a union of string literals or `as const` object instead.',
        },
      ],
    },
  },
  // ── ai-transcription module: restrict direct pino / @google/genai imports ──
  // Only lib/logger.ts may import pino; only the future gemini-client.ts may
  // import @google/genai.  These two overrides are carved out below.
  {
    files: ['src/modules/ai-transcription/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'pino',
              message:
                'Import the module logger from @/modules/ai-transcription (lib/logger.ts) instead of pino directly.',
            },
            {
              name: 'pino-pretty',
              message:
                'Import the module logger from @/modules/ai-transcription (lib/logger.ts) instead of pino-pretty directly.',
            },
            {
              name: '@google/genai',
              message:
                'Import the Gemini client from the dedicated gemini-client.ts wrapper instead of @google/genai directly.',
            },
          ],
          patterns: [
            {
              group: ['../../*'],
              message: 'Use the @/ path alias instead of deep relative imports.',
            },
          ],
        },
      ],
    },
  },
  // Allow lib/logger.ts to import pino (it IS the logger boundary).
  {
    files: ['src/modules/ai-transcription/lib/logger.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'pino-pretty',
              message:
                'Import the module logger from @/modules/ai-transcription (lib/logger.ts) instead of pino-pretty directly.',
            },
            {
              name: '@google/genai',
              message:
                'Import the Gemini client from the dedicated gemini-client.ts wrapper instead of @google/genai directly.',
            },
          ],
          patterns: [
            {
              group: ['../../*'],
              message: 'Use the @/ path alias instead of deep relative imports.',
            },
          ],
        },
      ],
    },
  },
  // Allow gemini-client.ts to import @google/genai (it IS the SDK boundary).
  {
    files: ['src/modules/ai-transcription/server/gemini-client.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'pino',
              message:
                'Import the module logger from @/modules/ai-transcription (lib/logger.ts) instead of pino directly.',
            },
            {
              name: 'pino-pretty',
              message:
                'Import the module logger from @/modules/ai-transcription (lib/logger.ts) instead of pino-pretty directly.',
            },
          ],
          patterns: [
            {
              group: ['../../*'],
              message: 'Use the @/ path alias instead of deep relative imports.',
            },
          ],
        },
      ],
    },
  },
  // ── ai-transcription consent guardrail (custom rule) ──────────────────────
  // Any file in `server/**` or `inngest/**` that imports `aiTranscriptions`
  // (the Drizzle table for audio data) MUST also import `assertAiConsentActive`
  // to verify the patient's AI consent before touching the data. See design
  // decision D6 in openspec/changes/ai-transcription-consent/design.md.
  {
    files: [
      'src/modules/ai-transcription/server/**/*.{ts,tsx}',
      'src/modules/ai-transcription/inngest/**/*.{ts,tsx}',
    ],
    plugins: {
      'ai-transcription-consent': {
        rules: {
          'require-assert-ai-consent': require('./eslint-rules/require-assert-ai-consent.cjs'),
        },
      },
    },
    rules: {
      'ai-transcription-consent/require-assert-ai-consent': 'error',
    },
  },
  prettierConfig,
];

export default config;
