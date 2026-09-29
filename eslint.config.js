import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'test-results', 'playwright-report', 'scripts/out'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // Systems must stay deterministic and I/O-free (CLAUDE.md).
    files: ['src/systems/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', 'Date', 'localStorage', 'document', 'window'],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random' }],
    },
  },
);
