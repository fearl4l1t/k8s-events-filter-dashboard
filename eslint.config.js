// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'bench/results.json',
      'node_modules/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      'no-console': 'error',
    },
  },
  {
    files: ['packages/server/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['**/tests/**/*.{ts,tsx}', '**/vitest.config.ts', 'packages/web/vite.config.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['scripts/**/*.{ts,mjs}', 'eslint.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['packages/web/src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
      ...jsxA11y.configs.recommended.rules,
    },
  },
  {
    files: ['packages/domain/src/**/*.ts'],
    languageOptions: {
      globals: { ...globals.es2021 },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'Domain layer must not import React.' },
            { name: 'react-dom', message: 'Domain layer must not import React DOM.' },
            { name: 'recharts', message: 'Domain layer must not import Recharts.' },
          ],
          patterns: [
            {
              group: ['node:*', 'fs', 'net', 'http', 'https', 'path', 'os', 'crypto', 'child_process'],
              message: 'Domain layer must not import Node built-ins.',
            },
            {
              group: ['@k8s-events/server', '@k8s-events/web', '**/server/**', '**/web/**', '**/ui/**'],
              message: 'Domain layer must not import from the server or UI layers.',
            },
          ],
        },
      ],
    },
  }
);
