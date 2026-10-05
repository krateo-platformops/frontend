// @ts-check
import stylisticJs from '@stylistic/eslint-plugin-js'
import stylisticTs from '@stylistic/eslint-plugin-ts'
import pluginQuery from '@tanstack/eslint-plugin-query'
import restrictedGlobals from 'confusing-browser-globals'
// @ts-ignore
import pluginImport from 'eslint-plugin-import'
import pluginJsxA11y from 'eslint-plugin-jsx-a11y'
import pluginNode from 'eslint-plugin-n'
import pluginReact from 'eslint-plugin-react'
import pluginReactHooks from 'eslint-plugin-react-hooks'
import sortDestructureKeys from 'eslint-plugin-sort-destructure-keys'
import sortKeys from 'eslint-plugin-sort-keys'
import globals from 'globals'
import tsEslint from 'typescript-eslint'

const ignoredPaths = [
  '.yarn/**/*',
  '**/node_modules/**/*',
  '.pnp.*',
  'www/**/*',
  '**/dist/**/*',
  '**/build/**/*',
  'loader/**/*',
  'public/**/*',
  'website/**/*',
  'playwright-report/**/*',
  '.vscode/**/*',
  '.idea/**/*',
  '.eslint.config.js',
]

export default tsEslint.config(
  ...pluginQuery.configs['flat/recommended'],
  { ignores: ignoredPaths, name: 'Ignored files' },

  {
    files: ['**/*.{mjs,cjs,js,ts,jsx,tsx}'],
    languageOptions: { ecmaVersion: 12 },
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
    name: 'Base config',
    plugins: {
      '@stylistic/js': stylisticJs,
      import: pluginImport,
      // @ts-ignore
      n: pluginNode,
      'sort-keys': sortKeys,
    },
    rules: {
      // http://eslint.org/docs/rules/
      '@stylistic/js/array-bracket-spacing': ['error', 'never'],
      '@stylistic/js/arrow-spacing': 'error',
      '@stylistic/js/block-spacing': ['error', 'always'],
      '@stylistic/js/brace-style': ['error', '1tbs', { allowSingleLine: true }],
      '@stylistic/js/comma-dangle': [
        'error',
        {
          arrays: 'always-multiline',
          exports: 'always-multiline',
          functions: 'ignore',
          imports: 'always-multiline',
          objects: 'always-multiline',
        },
      ],
      '@stylistic/js/comma-spacing': 'error',
      '@stylistic/js/comma-style': 'error',
      '@stylistic/js/computed-property-spacing': ['error', 'never'],
      '@stylistic/js/dot-location': ['error', 'property'],
      '@stylistic/js/eol-last': 'error',
      '@stylistic/js/func-call-spacing': 'off',
      '@stylistic/js/generator-star-spacing': 'error',
      '@stylistic/js/indent': ['error', 2, { SwitchCase: 1 }],
      '@stylistic/js/key-spacing': 'error',
      '@stylistic/js/keyword-spacing': 'error',
      '@stylistic/js/line-comment-position': 'error',
      // '@stylistic/js/linebreak-style': ['error', 'unix'],
      '@stylistic/js/lines-around-comment': 'off',
      '@stylistic/js/max-statements-per-line': ['error', { max: 2 }],
      '@stylistic/js/new-parens': 'error',
      '@stylistic/js/newline-per-chained-call': ['error', { ignoreChainWithDepth: 3 }],
      '@stylistic/js/no-confusing-arrow': ['error', { allowParens: true }],
      '@stylistic/js/no-extra-parens': ['error', 'functions'],
      '@stylistic/js/no-extra-semi': 'error',
      '@stylistic/js/no-floating-decimal': 'error',
      '@stylistic/js/no-mixed-operators': [
        'error',
        {
          allowSamePrecedence: false,
          groups: [
            ['&', '|', '^', '~', '<<', '>>', '>>>'],
            ['==', '!=', '===', '!==', '>', '>=', '<', '<='],
            ['&&', '||'],
            ['in', 'instanceof'],
          ],
        },
      ],
      '@stylistic/js/no-mixed-spaces-and-tabs': 'error',
      '@stylistic/js/no-multi-spaces': 'error',
      '@stylistic/js/no-multiple-empty-lines': ['error', { max: 1, maxBOF: 0, maxEOF: 0 }],
      '@stylistic/js/no-tabs': 'error',
      '@stylistic/js/no-trailing-spaces': 'error',
      '@stylistic/js/no-whitespace-before-property': 'error',
      '@stylistic/js/nonblock-statement-body-position': 'error',
      '@stylistic/js/object-curly-spacing': ['error', 'always'],
      '@stylistic/js/object-property-newline': ['error', { allowMultiplePropertiesPerLine: true }],
      '@stylistic/js/one-var-declaration-per-line': 'error',
      '@stylistic/js/operator-linebreak': ['error', 'before'],
      '@stylistic/js/padded-blocks': ['error', 'never'],
      '@stylistic/js/quote-props': ['error', 'as-needed'],
      '@stylistic/js/quotes': ['error', 'single', { allowTemplateLiterals: true, avoidEscape: true }],
      '@stylistic/js/rest-spread-spacing': ['error', 'never'],
      '@stylistic/js/semi': ['error', 'never'],
      '@stylistic/js/semi-spacing': 'error',
      '@stylistic/js/space-before-blocks': 'error',
      '@stylistic/js/space-before-function-paren': ['error', { anonymous: 'always', named: 'never' }],
      '@stylistic/js/space-in-parens': 'error',
      '@stylistic/js/space-infix-ops': 'error',
      '@stylistic/js/space-unary-ops': 'error',
      '@stylistic/js/spaced-comment': ['error', 'always', { exceptions: ['!'], markers: ['/'] }],
      '@stylistic/js/template-curly-spacing': 'error',
      '@stylistic/js/template-tag-spacing': 'error',
      '@stylistic/js/wrap-iife': 'error',
      '@stylistic/js/yield-star-spacing': 'error',
      'array-callback-return': 'error',
      'block-scoped-var': 'error',
      camelcase: ['error', { ignoreDestructuring: true, properties: 'never' }],
      'constructor-super': 'error',
      curly: 'error',
      'default-case': ['error', { commentPattern: '^skip\\sdefault' }],
      eqeqeq: ['error', 'smart'],
      'for-direction': 'error',
      'func-name-matching': 'error',
      'func-names': ['error', 'as-needed'],
      'func-style': ['error', 'declaration', { allowArrowFunctions: true }],
      'getter-return': 'error',
      'global-require': 'error',
      'guard-for-in': 'error',
      'handle-callback-err': 'error',
      'id-blacklist': ['error', 'e', 'er', 'cb'],
      'id-length': [
        'error',
        {
          exceptions: ['_', 'i', 'j', 'x', 'y', 'z'],
          min: 2,
          properties: 'never',
        },
      ],
      // https://github.com/benmosher/eslint-plugin-import/tree/master/docs/rules
      'import/export': 'error',
      'import/no-duplicates': 'error',
      'import/order': [
        'error',
        {
          alphabetize: { caseInsensitive: true, order: 'asc' },
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
        },
      ],
      'max-depth': ['error', 4],
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
      'max-statements': ['off'],

      // https://github.com/eslint-community/eslint-plugin-n/tree/master/docs/rules
      'n/callback-return': ['error', ['callback', 'cb', 'next', 'done']],
      'no-array-constructor': 'error',
      'no-async-promise-executor': 'error',
      'no-await-in-loop': 'error',
      'no-caller': 'error',
      'no-case-declarations': 'error',
      'no-class-assign': 'error',
      'no-compare-neg-zero': 'error',
      'no-cond-assign': ['error', 'except-parens'],
      'no-console': ['warn', { allow: ['error', 'warn'] }],
      'no-const-assign': 'error',
      'no-constant-condition': 'error',
      'no-control-regex': 'error',
      'no-debugger': 'error',
      'no-delete-var': 'error',
      'no-dupe-args': 'error',
      'no-dupe-class-members': 'error',
      'no-dupe-else-if': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-duplicate-imports': 'error',
      'no-else-return': 'error',
      'no-empty': 'error',
      'no-empty-character-class': 'error',
      'no-empty-function': 'error',
      'no-empty-pattern': 'error',
      'no-eq-null': 'error',
      'no-eval': 'error',
      'no-ex-assign': 'error',
      'no-extend-native': 'error',
      'no-extra-bind': 'error',
      'no-extra-boolean-cast': 'error',
      'no-extra-label': 'error',
      'no-fallthrough': 'error',
      'no-func-assign': 'error',
      'no-global-assign': 'error',
      'no-implicit-globals': 'error',
      'no-implied-eval': 'error',
      'no-import-assign': 'error',
      'no-inner-declarations': 'error',
      'no-invalid-regexp': 'error',
      'no-irregular-whitespace': 'error',
      'no-iterator': 'error',
      'no-label-var': 'error',
      'no-labels': ['error', { allowLoop: true, allowSwitch: false }],
      'no-lone-blocks': 'error',
      'no-lonely-if': 'error',
      'no-loop-func': 'error',
      'no-loss-of-precision': 'error',
      'no-misleading-character-class': 'error',
      'no-multi-assign': 'error',
      'no-multi-str': 'error',
      'no-nested-ternary': 'error',
      'no-new': 'error',
      'no-new-func': 'error',
      'no-new-object': 'error',
      'no-new-require': 'error',
      'no-new-symbol': 'error',
      'no-new-wrappers': 'error',
      'no-nonoctal-decimal-escape': 'error',
      'no-obj-calls': 'error',
      'no-octal': 'error',
      'no-octal-escape': 'error',
      'no-param-reassign': 'error',
      'no-path-concat': 'error',
      'no-plusplus': ['error', { allowForLoopAfterthoughts: true }],
      'no-proto': 'error',
      'no-prototype-builtins': 'error',
      'no-regex-spaces': 'error',
      // @ts-ignore
      'no-restricted-globals': ['error'].concat(restrictedGlobals),
      // #86 §0.10: don't hand-roll a new antd Drawer — use components/DrawerHeader + drawerCloseProps
      // with an existing drawer surface. The three legitimate surfaces are allow-listed at the end
      // of this config so this ban applies everywhere else.
      'no-restricted-imports': ['error', {
        paths: [{
          importNames: ['Drawer'],
          message: 'Use components/DrawerHeader + drawerCloseProps with an existing drawer surface; do not hand-roll a new antd Drawer (issue #86 §0.10).',
          name: 'antd',
        }],
      }],
      'no-restricted-properties': [
        'error',
        {
          message: 'Please use import() instead',
          object: 'require',
          property: 'ensure',
        },
        {
          message: 'Please use import() instead',
          object: 'System',
          property: 'import',
        },
      ],
      'no-restricted-syntax': ['error', 'WithStatement'],
      'no-return-assign': 'error',
      'no-return-await': 'error',
      'no-script-url': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-setter-return': 'error',
      'no-shadow-restricted-names': 'error',
      'no-sparse-arrays': 'error',
      'no-sync': 'error',
      'no-template-curly-in-string': 'error',
      'no-this-before-super': 'error',
      'no-throw-literal': 'error',
      'no-undef': 'error',
      'no-undef-init': 'error',
      'no-unexpected-multiline': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unneeded-ternary': 'error',
      'no-unreachable': 'error',
      'no-unsafe-finally': 'error',
      'no-unsafe-negation': 'error',
      'no-unsafe-optional-chaining': 'error',
      'no-unused-expressions': [
        'error',
        {
          allowShortCircuit: true,
          allowTaggedTemplates: true,
          allowTernary: true,
        },
      ],
      'no-unused-labels': 'error',
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_(?:[0-9]+)?',
          destructuredArrayIgnorePattern: '^_(?:[0-9]+)?',
          ignoreRestSiblings: true,
        },
      ],
      'no-use-before-define': ['error', { functions: false }],
      'no-useless-backreference': 'error',
      'no-useless-call': 'error',
      'no-useless-catch': 'error',
      'no-useless-computed-key': 'error',
      'no-useless-concat': 'error',
      'no-useless-constructor': 'error',
      'no-useless-escape': 'error',
      'no-useless-rename': [
        'error',
        {
          ignoreDestructuring: false,
          ignoreExport: false,
          ignoreImport: false,
        },
      ],
      'no-useless-return': 'error',
      'no-var': 'error',
      'no-void': ['error', { allowAsStatement: true }],
      'no-with': 'error',
      'object-shorthand': 'error',
      'operator-assignment': 'error',
      'prefer-arrow-callback': ['error', { allowNamedFunctions: true }],
      'prefer-const': 'error',
      'prefer-destructuring': [
        'error',
        {
          AssignmentExpression: { array: false, object: false },
          VariableDeclarator: { array: true, object: true },
        },
        { enforceForRenamedProperties: false },
      ],
      'prefer-object-spread': 'error',
      'prefer-promise-reject-errors': 'error',
      'prefer-rest-params': 'error',
      'prefer-spread': 'error',
      'prefer-template': 'error',
      'require-atomic-updates': 'error',
      'require-yield': 'error',

      'sort-imports': 'off',

      'sort-keys': 0,

      'sort-keys/sort-keys-fix': 1,

      strict: ['error', 'never'],

      'symbol-description': 'error',

      'unicode-bom': ['error', 'never'],
      'use-isnan': 'error',

      // https://eslint.org/blog/2018/11/jsdoc-end-of-life/
      'valid-jsdoc': 'off',

      'valid-typeof': ['error', { requireStringLiterals: true }],

      'vars-on-top': 'error',
    },
  },

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
      '@stylistic/ts': stylisticTs,
      '@typescript-eslint': tsEslint.plugin,
      'sort-destructure-keys': sortDestructureKeys,
    },
    rules: {
      ...tsEslint.configs.strict[2].rules,
      ...tsEslint.configs.recommendedTypeChecked[2].rules,
      '@stylistic/js/object-curly-spacing': ['error', 'always'],
      '@stylistic/ts/member-delimiter-style': [
        2,
        {
          multiline: { delimiter: 'none', requireLast: false },
          multilineDetection: 'brackets',
          singleline: { delimiter: 'semi', requireLast: false },
        },
      ],

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

  {
    files: ['**/*.{jsx,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    name: 'React config',
    plugins: {
      '@stylistic/js': stylisticJs,
      'jsx-a11y': pluginJsxA11y,
      react: pluginReact,
      'react-hooks': pluginReactHooks,
    },
    rules: {
      // http://eslint.org/docs/rules/
      '@stylistic/js/jsx-quotes': ['error', 'prefer-single'],
      '@stylistic/js/object-curly-spacing': ['error', 'always'],
      '@stylistic/js/operator-linebreak': 'off',
      // https://github.com/evcohen/eslint-plugin-jsx-a11y/tree/master/docs/rules
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/anchor-has-content': 'error',
      'jsx-a11y/anchor-is-valid': ['error', { aspects: ['noHref', 'invalidHref'] }],

      'jsx-a11y/aria-activedescendant-has-tabindex': 'error',

      'jsx-a11y/aria-props': 'error',

      'jsx-a11y/aria-proptypes': 'error',
      'jsx-a11y/aria-role': ['error', { ignoreNonDOM: true }],

      'jsx-a11y/aria-unsupported-elements': 'error',
      // C8: a clickable element is focusable, announced, and works from the keyboard.
      'jsx-a11y/click-events-have-key-events': 'error',
      // C9: every icon-only control has an accessible name. A Tooltip does not give it one.
      'jsx-a11y/control-has-associated-label': ['error', { depth: 3, ignoreElements: ['input', 'select', 'td', 'textarea', 'th', 'tr'] }],
      'jsx-a11y/heading-has-content': 'error',
      'jsx-a11y/interactive-supports-focus': 'error',

      'jsx-a11y/iframe-has-title': 'error',
      'jsx-a11y/img-redundant-alt': 'error',

      'jsx-a11y/no-access-key': 'error',

      'jsx-a11y/no-distracting-elements': 'error',
      'jsx-a11y/no-noninteractive-element-interactions': 'error',
      'jsx-a11y/no-redundant-roles': 'error',
      'jsx-a11y/no-static-element-interactions': 'error',
      'jsx-a11y/role-has-required-aria-props': 'error',
      'jsx-a11y/role-supports-aria-props': 'error',
      'jsx-a11y/scope': 'error',
      'object-curly-spacing': ['error', 'always'],
      'react-hooks/exhaustive-deps': 'error',
      // https://github.com/facebook/react/tree/main/packages/eslint-plugin-react-hooks
      'react-hooks/rules-of-hooks': 'error',

      // https://github.com/yannickcr/eslint-plugin-react/tree/master/docs/rules
      // 'react/jsx-uses-react': 'error',
      // 'react/jsx-uses-vars': 'error',
      'react/forbid-foreign-prop-types': ['error', { allowInPropTypes: true }],
      'react/jsx-no-comment-textnodes': 'error',
      'react/jsx-no-duplicate-props': 'error',
      'react/jsx-no-target-blank': 'error',

      // 'react/jsx-no-undef': 'error',
      'react/jsx-pascal-case': ['error', { allowAllCaps: true, ignore: [] }],

      // 'react/react-in-jsx-scope': 'error',
      'react/jsx-sort-props': 'error',

      // 'react/style-prop-object': 'error',

      'react/no-did-update-set-state': 'error',
      // 'react/no-danger-with-children': 'error',
      'react/no-is-mounted': 'error',
      'react/no-unknown-property': 'error',
    },
    settings: {
      // C8–C10 (design/02-components.md). jsx-a11y only sees DOM elements, so an antd `<Card onClick>`
      // or a bare `<Button icon={…} />` was invisible to it: exactly the shapes those rules were
      // written about. Mapping each antd component to the element it renders lets the rules see them.
      'jsx-a11y': {
        components: { Avatar: 'span', Button: 'button', Card: 'div', Col: 'div', Flex: 'div', Row: 'div', Space: 'div', Tag: 'span', Text: 'span', Title: 'h1' },
      },
      react: { version: 'detect' },
    },
  },

  // Tests render fixtures, not product UI: a clickable <div> in a test exercises a handler, it is not
  // a control anyone has to reach. The C8/C9 rules stay on everything that ships.
  {
    files: ['**/*.test.tsx'],
    name: 'C8/C9 a11y rules do not apply to test fixtures',
    rules: {
      'jsx-a11y/click-events-have-key-events': 'off',
      'jsx-a11y/control-has-associated-label': 'off',
      'jsx-a11y/interactive-supports-focus': 'off',
      'jsx-a11y/no-noninteractive-element-interactions': 'off',
      'jsx-a11y/no-static-element-interactions': 'off',
    },
  },

  // #86 §0.10: the shared drawer surfaces legitimately import antd `Drawer`; allow-list them so the
  // ban above applies everywhere else (a 5th hand-rolled drawer can't bypass components/DrawerHeader).
  {
    files: ['src/widgets/Drawer/Drawer.tsx', 'src/components/Notifications/Notifications.tsx', 'src/components/Autopilot/previewSurface.tsx'],
    name: 'Allow raw antd Drawer in the shared drawer surfaces (#86 §0.10)',
    rules: { 'no-restricted-imports': 'off' },
  },

  // Voice spec FR 65/68 — the STRUCTURAL form of two invariants, so neither can be broken by
  // a later edit that merely looks reasonable:
  //   · voice code can never reach the transport ITSELF. Conversation mode does send a
  //     spoken turn, but the send lives outside this fence: the store reports a completed
  //     purely-dictated draft through the sink `voiceWiring` injects, and the RAIL submits.
  //     Voice states that a turn is finished; it never holds the means to send one, and
  //   · SPEAK-BACK can never make a model call — the spoken words are a pure local transform
  //     of the text already written in the chat, never a separately generated summary.
  // A user hearing one account of what the agent found while the transcript records another
  // has no way to know which one the agent will act on, and the transcript is what an incident
  // review reads afterwards. Making the import fail turns that from a promise into a fact.
  {
    files: ['src/components/Autopilot/voice/**/*.{ts,tsx}'],
    name: 'Voice cannot send a turn (voice spec FR 65)',
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          importNames: ['Drawer'],
          message: 'Use components/DrawerHeader + drawerCloseProps with an existing drawer surface (issue #86 §0.10).',
          name: 'antd',
        }],
        patterns: [{
          group: ['**/transport*', '**/AutopilotProvider*'],
          message: 'Nothing under Autopilot/voice/ may import the A2A transport or the provider\'s send(): a spoken turn is submitted by the RAIL, outside this fence, via the sink injected through voiceStore.installConversationSink() — the voice modules report that a draft is complete and never hold the means to send one (voice spec FR 11/65). What the transcription call needs from outside this fence — the portal bearer, the rate-limit detector, the session resume — is INJECTED the same way, through voiceStore.installTranscribeDeps().',
        }],
      }],
    },
  },

  // The second half of FR 65, and it is STRICTLY NARROWER by one directory: speak-back may
  // not import the transcription client either. Its spoken words must be a pure local
  // transform of the text already written in the chat (FR 68) — never a separately
  // generated summary — so a model call on that path must not compile. The dictation half
  // one level up DOES import `transcribe.ts`; that is its whole job, and fencing it there
  // would ban the feature rather than the failure mode.
  //
  // Every pattern ends in `*` deliberately: tsconfig sets `allowImportingTsExtensions`, so
  // `'../speakTts.ts'` compiles and Vite resolves it, and an extensionless-only group would
  // let that spelling walk straight through the fence. A fence with one accepted spelling is
  // not a fence.
  //
  // `speakTts` — the Cloud TTS client — is banned here for the same reason and is WHY it
  // lives one level up, in `voice/speakTts.ts`, rather than beside the store it serves. It
  // is a network call, and this directory makes NO network calls of any kind: that is what
  // reduces FR 68 from a promise to a fact a reader can check by grep. The TTS speaker
  // reaches the store the only way anything crosses this fence — INJECTED, as a `Speaker`,
  // by voiceWiring.ts through speakBackStore.installSpeaker(). Moving the file in here to
  // save an import would quietly re-open the path this rule exists to close.
  {
    files: ['src/components/Autopilot/voice/speak/**/*.{ts,tsx}'],
    name: 'Speak-back cannot call a model (voice spec FR 68)',
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          importNames: ['Drawer'],
          message: 'Use components/DrawerHeader + drawerCloseProps with an existing drawer surface (issue #86 §0.10).',
          name: 'antd',
        }],
        patterns: [{
          group: ['**/transport*', '**/AutopilotProvider*', '**/transcribe*', '**/speakTts*'],
          message: 'Nothing under Autopilot/voice/speak/ may import the A2A transport, the provider\'s send(), the transcription client, or the Cloud TTS client: the spoken answer is a pure local transform of the exact words already written in the chat, never a second model call, and this directory makes no network calls at all (voice spec FR 65/68). The TTS speaker is INJECTED from voiceWiring.ts via speakBackStore.installSpeaker().',
        }],
      }],
    },
  }
)
