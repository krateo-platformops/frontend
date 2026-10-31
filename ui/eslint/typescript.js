// @ts-check
import stylistic from '@stylistic/eslint-plugin'
import sortDestructureKeys from 'eslint-plugin-sort-destructure-keys'
import tsEslint from 'typescript-eslint'

/** Type-aware rules, plus the generated-widget-types carve-out they do not apply to. */
export const typescriptConfigs = [
  {
    files: ['src/widgets/**/*.d.ts'],
    ignores: ['.src/**'],
  },

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsEslint.parser,
      parserOptions: {
        project: './tsconfig.eslint.json',
      },
    },
    name: 'Typescript config',
    plugins: {
      '@stylistic': stylistic,
      '@typescript-eslint': tsEslint.plugin,
      'sort-destructure-keys': sortDestructureKeys,
    },
    rules: {
      ...tsEslint.configs.strict[2].rules,
      ...tsEslint.configs.recommendedTypeChecked[2].rules,
      '@stylistic/member-delimiter-style': [
        2,
        {
          multiline: { delimiter: 'none', requireLast: false },
          multilineDetection: 'brackets',
          singleline: { delimiter: 'semi', requireLast: false },
        },
      ],
      '@stylistic/object-curly-spacing': ['error', 'always'],

      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-invalid-void-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',

      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_(?:[0-9]+)?',
          destructuredArrayIgnorePattern: '^_(?:[0-9]+)?',
          ignoreRestSiblings: true,
        },
      ],

      '@typescript-eslint/no-use-before-define': ['error', { typedefs: false }],

      '@typescript-eslint/non-nullable-type-assertion-style': 'off',

      // TypeScript's `noFallthroughCasesInSwitch` option is more robust (#6906)

      'default-case': 'off',

      'n/no-missing-import': 'off',

      'n/no-unpublished-import': 'off',

      // 'tsc' already handles this (https://github.com/typescript-eslint/typescript-eslint/issues/291)
      'no-dupe-class-members': 'off',
      'no-duplicate-imports': 'off',
      'no-shadow': 'off',
      // 'tsc' already handles this (https://github.com/typescript-eslint/typescript-eslint/issues/477)
      'no-undef': 'off',

      'no-use-before-define': 'off',
      'sort-destructure-keys/sort-destructure-keys': ['error', { caseSensitive: true }],
      'sort-imports': 'off',
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.eslint.json',
        },
      },
    },
  },
]
