// eslint.config.js
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginGoogleAppsScript from "eslint-plugin-googleappsscript"; // Corrected import name
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["dist/", "node_modules/"],
  },
  // ESLint's own recommended rules (usually a good base)
  // For ESLint v9, you might need to import it if not using `tseslint.config` in a way that includes it.
  // Let's assume tseslint.config handles some base JS linting for now.
  // If pure JS files were also in src, you might add: js.configs.recommended, after importing 'js' from '@eslint/js'

  // TypeScript specific configurations
  // Apply these to .ts files
  {
    files: ["**/*.ts"], // Target only TypeScript files for these rules
    extends: [
      ...tseslint.configs.recommendedTypeChecked, // Or .recommended for less strictness
    ],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Google Apps Script specific configurations
  // Apply these to .ts files (or .js if you had them for Apps Script)
  {
    files: ["src/**/*.ts"], // Or ["src/**/*.{js,ts}"] if you have JS files for Apps Script
    plugins: {
      googleappsscript: pluginGoogleAppsScript,
    },
    // Instead of spreading rules and globals directly from pluginGoogleAppsScript.configs.recommended,
    // we will apply its config object structure if available, or manually add rules/globals.
    // Let's try applying its 'recommended' config directly if it's structured for flat config.
    // If pluginGoogleAppsScript.configs.recommended is a valid flat config object:
    // (This is a guess, as plugin structures vary)
    // pluginGoogleAppsScript.configs.recommended, // This might not work if not designed for direct merge

    // Safer approach: Manually specify what you need or check plugin docs for v9
    rules: {
      // You might need to look at what rules are in pluginGoogleAppsScript.configs.recommended
      // and list them here if the direct spread doesn't work.
      // For now, let's assume the plugin enables rules when its name is in plugins.
      // We can add specific googleappsscript rules later if needed.
      // e.g., "googleappsscript/some-rule": "error"
    },
    languageOptions: {
      globals: {
        ...globals.browser, // For client-side HTML context if any
        ...(pluginGoogleAppsScript.environments?.['google-apps-script']?.globals || {}),
        // Or more directly if the plugin exposes globals for flat config:
        // ...pluginGoogleAppsScript.configs.recommended.globals // This caused the error
      },
    },
  },

  // Prettier - This should be last to override other style rules
  prettierConfig
);