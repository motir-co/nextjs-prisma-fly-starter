import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // Project-specific rules. These come AFTER the Next config so they win on conflict.
  {
    rules: {
      // Unused vars are errors, EXCEPT names prefixed with `_` (intentional unused).
      // Disable the base rule first; the TS version handles types correctly.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // console.log is a smell in committed code; warn (not error) so it surfaces in
      // CI but doesn't block a developer mid-debug. console.warn/.error are fine.
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Implicit any is already forbidden by tsconfig's `noImplicitAny`; this rule
      // catches the lint-side equivalent for completeness.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // MUST come last: turns off ESLint rules that conflict with Prettier formatting.
  // Without this, ESLint and Prettier fight over things like trailing commas.
  prettier,

  globalIgnores([
    // Defaults inherited from eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Project additions:
    'node_modules/**',
    'prisma/migrations/**',
  ]),
]);

export default eslintConfig;
