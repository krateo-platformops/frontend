// @ts-check
import stylistic from '@stylistic/eslint-plugin'
import pluginJsxA11y from 'eslint-plugin-jsx-a11y'
import pluginReact from 'eslint-plugin-react'
import pluginReactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

/** JSX, hooks and a11y rules for the component tree. */
export const reactConfig = {
  files: ['**/*.{jsx,tsx}'],
  languageOptions: {
    globals: { ...globals.browser },
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
  name: 'React config',
  plugins: {
    '@stylistic': stylistic,
    'jsx-a11y': pluginJsxA11y,
    react: pluginReact,
    'react-hooks': pluginReactHooks,
  },
  rules: {
    // http://eslint.org/docs/rules/
    '@stylistic/jsx-quotes': ['error', 'prefer-single'],
    '@stylistic/object-curly-spacing': ['error', 'always'],
    '@stylistic/operator-linebreak': 'off',
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
    'jsx-a11y/iframe-has-title': 'error',

    'jsx-a11y/img-redundant-alt': 'error',
    'jsx-a11y/interactive-supports-focus': 'error',

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
}
