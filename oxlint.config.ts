import foldkitRecommended from "@foldkit/oxlint-plugin/recommended.json" with { type: "json" };
import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";

const foldkitScope = (pattern: string) => `apps/web/src/${pattern}`;

const foldkitSeverity = ([rule, severity]: readonly [string, string]) => {
  if (severity === "error" || severity === "off") {
    return [rule, severity] as const;
  }

  throw new Error(
    `@foldkit/oxlint-plugin/recommended.json sets ${rule} to ${severity}. Map that severity in oxlint.config.ts before bumping the plugin.`
  );
};

const foldkitRules = (rules: Readonly<Record<string, string>>) =>
  Object.fromEntries(Object.entries(rules).map(foldkitSeverity));

const foldkitOverrides = [
  {
    files: [foldkitScope("**/*.ts")],
    rules: foldkitRules(foldkitRecommended.rules),
  },
  ...foldkitRecommended.overrides.map(({ excludeFiles, files, rules }) => ({
    excludeFiles: excludeFiles?.map(foldkitScope),
    files: files.map(foldkitScope),
    rules: foldkitRules(rules),
  })),
];

export default defineConfig({
  extends: [core],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    ".agent_sources/**",
    ".agent-sources/**",
    "**/dist/**",
    "node_modules/**",
    ".pi/**",
    ".cursor/**",
    ".claude/**",
    "scripts/hooks/**",
    "tools/oxlint/anti-slop/**",
  ],
  jsPlugins: [
    { name: "foldkit", specifier: "@foldkit/oxlint-plugin" },
    "./scripts/oxlint-plugin-xstate-effect.ts",
    "./scripts/oxlint-plugin-effect-tests.ts",
    "./scripts/oxlint-plugin-no-comments.ts",
    {
      name: "rat-stack-boundaries",
      specifier: "./scripts/oxlint-plugin-boundaries.ts",
    },
    {
      name: "rat-stack-patterns",
      specifier: "./scripts/oxlint-plugin-patterns.ts",
    },
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    {
      name: "anti-slop-effect",
      specifier: "./tools/oxlint/anti-slop/effect/index.ts",
    },
  ],
  options: {
    typeAware: true,
  },
  overrides: [
    ...foldkitOverrides,
    {
      files: [
        "apps/*/src/features/**",
        "apps/*/src/client/**",
        "apps/*/src/dev/features/**",
        "apps/*/src/dev/client/**",
      ],
      rules: {
        "rat-stack-boundaries/no-browser-server-imports": "error",
      },
    },
    {
      files: ["apps/*/src/features/**", "apps/*/src/dev/features/**"],
      rules: {
        "rat-stack-boundaries/no-feature-transport": "error",
      },
    },
    {
      files: [
        "apps/mischief/scripts/content-lib.ts",
        "apps/mischief/scripts/generate-content.ts",
        "apps/mischief/scripts/wiki-prose.ts",
      ],
      rules: {
        "rat-stack-patterns/audited-content-regex": "error",
      },
    },
  ],
  rules: {
    "anti-slop-effect/no-manual-effect-error-tag": "error",
    "anti-slop-effect/no-manual-tag-comparison": "error",
    "anti-slop-effect/no-manual-tagged-construction": "error",
    "anti-slop-effect/no-service-constructor-imports": "error",
    "anti-slop-effect/prefer-effect-match": "error",
    "anti-slop/no-array-filter-map": "error",
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reduce-accumulator-copy": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-readable-spacing": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",
    "effect-tests/no-manual-effect-runtime-in-tests": "error",
    "jsdoc/require-param-description": "off",
    "jsdoc/require-returns-description": "off",
    "no-comments/no-comments": "error",
    "oxc/no-accumulating-spread": "error",
    "rat-stack-boundaries/no-browser-globals-on-server": "error",
    "rat-stack-boundaries/no-code-snippets-in-runtime": "error",
    "rat-stack-boundaries/no-core-adapters": "error",
    "rat-stack-boundaries/no-cross-layer-imports": "error",
    "rat-stack-boundaries/no-devtools-in-production": "error",
    "rat-stack-boundaries/no-hand-rolled-surface": "error",
    "rat-stack-patterns/acquire-release-constructs-in-acquire-body": "error",
    "rat-stack-patterns/contract-binding-matches-name": "error",
    "rat-stack-patterns/flag-removal-date": "error",
    "rat-stack-patterns/learn-snippet-idiom": "error",
    "rat-stack-patterns/no-module-level-mutable-state": "error",
    "rat-stack-patterns/no-shared-pending-cache": "error",
    "rat-stack-patterns/watch-effect-actors": "error",
    "unicorn/throw-new-error": "off",
    "xstate-effect/no-inline-effect": "error",
  },
});
