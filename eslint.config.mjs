import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import prettierConfig from 'eslint-config-prettier';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'e2e/.cache/**',
      'next-env.d.ts',
      '.husky/**',
      '.claude/**',
      'prd/**',
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
            'Do not access `process.env` outside `lib/env.ts`. Import the validated `serverEnv` or `clientEnv` instead.',
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
  // `lib/env.ts` is the validation boundary itself; CLI files run outside the
  // Next.js bundle and therefore cannot import `server-only` to reach
  // `serverEnv`. Both are allowed to read `process.env` directly.
  {
    files: [
      'lib/env.ts',
      'lib/env/client.ts',
      'drizzle.config.ts',
      'db/migrate.ts',
      'vitest.setup.ts',
      'playwright.config.ts',
      '__tests__/integration/setup/**',
      'e2e/global-setup.ts',
      'e2e/global-teardown.ts',
      'e2e/auth.setup.ts',
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
  prettierConfig,
];

export default config;
