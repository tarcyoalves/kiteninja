import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Android generated artifacts (keep sources checkable)
    "android/.gradle/**",
    "android/build/**",
    "android/app/build/**",
    "android/app/.gradle/**",
    "android/capacitor-cordova-android-plugins/**",
    "android/app/src/main/assets/**",
    "android/app/src/main/res/xml/config.xml",
    // Mobile shell rebuilt by capacitor sync (static placeholder)
    "mobile-shell/*.js",
    "mobile-shell/*.css",
    "mobile-shell/*.map",
    // Claude worktrees
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
