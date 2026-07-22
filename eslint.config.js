import js from '@eslint/js';
export default [js.configs.recommended, {
  rules: {
    'no-unused-vars': 'warn',
    'no-undef': 'error'
  },
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    globals: {
      console: 'readonly',
      process: 'readonly',
      setTimeout: 'readonly',
      setInterval: 'readonly',
      clearTimeout: 'readonly',
      clearInterval: 'readonly',
      Math: 'readonly',
      parseInt: 'readonly',
      isNaN: 'readonly',
      Promise: 'readonly',
      Buffer: 'readonly',
      URL: 'readonly',
      fetch: 'readonly'
    }
  }
}];
