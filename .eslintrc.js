// .eslintrc.js
module.exports = {
  parser: '@typescript-eslint/parser',
      extends: [
'plugin:@typescript-eslint/recommended',
'prettier',
'plugin:prettier/recommended',
],
parserOptions: {
ecmaVersion: 2020,
sourceType: 'module',
},
rules: {
// Add any custom rules here if needed
},
env: { // Add this to define global variables for Apps Script environment
"google-apps-script/google-apps-script": true
},
plugins: [ // Add this if you want ESLint to understand Apps Script globals
"google-apps-script"
]
};