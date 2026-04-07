import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  // 忽略的文件/目录
  {
    ignores: [
      'node_modules/**',
      'out/**',
      'dist/**',
      'build/**',
      '*.config.js',
      '*.config.ts',
      'scripts/**',
    ],
  },

  // JavaScript/TypeScript 基础配置
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      // TypeScript 规则
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'off',

      // React 规则
      'react/react-in-jsx-scope': 'off', // React 17+ 不需要
      'react/prop-types': 'off', // 用 TypeScript 代替
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // 通用规则
      'no-console': 'off',
      'prefer-const': 'warn',
      'no-unused-vars': 'off', // 用 @typescript-eslint/no-unused-vars 代替

      // Drag region contract: draggable wrappers must not host custom context menus
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXOpeningElement[name.name='DragRegionContainer'] > JSXAttribute[name.name='onContextMenu']",
          message: 'Do not attach onContextMenu to DragRegionContainer. Put context menu handlers on no-drag interactive content only.',
        },
        {
          selector: "JSXOpeningElement[name.name='DragRegionContainer'] > JSXAttribute[name.name='onContextMenuCapture']",
          message: 'Do not attach onContextMenuCapture to DragRegionContainer. Put context menu handlers on no-drag interactive content only.',
        },
        {
          selector: "JSXOpeningElement[name.name='WindowDragStrip'] > JSXAttribute[name.name='onContextMenu']",
          message: 'Do not attach onContextMenu to WindowDragStrip. Put context menu handlers on no-drag interactive content only.',
        },
        {
          selector: "JSXOpeningElement[name.name='WindowDragStrip'] > JSXAttribute[name.name='onContextMenuCapture']",
          message: 'Do not attach onContextMenuCapture to WindowDragStrip. Put context menu handlers on no-drag interactive content only.',
        },
      ],
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
]
