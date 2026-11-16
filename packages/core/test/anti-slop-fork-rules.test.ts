import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

RuleTester.describe = (name, run) => {
  describe(name, run);
};

RuleTester.it = (name, run) => {
  it(name, run);
};

await import(
  new URL(
    "../../../tools/oxlint/anti-slop/effect/rules/no-manual-tagged-type.test.ts",
    import.meta.url
  ).href
);

await import(
  new URL(
    "../../../tools/oxlint/anti-slop/effect/rules/prefer-tagged-error-handling.test.ts",
    import.meta.url
  ).href
);

await import(
  new URL(
    "../../../tools/oxlint/anti-slop/effect/rules/require-operation-span.test.ts",
    import.meta.url
  ).href
);

await import(
  new URL(
    "../../../tools/oxlint/anti-slop/effect/rules/require-cause-when-narrowing.test.ts",
    import.meta.url
  ).href
);

await import(
  new URL(
    "../../../tools/oxlint/anti-slop/rules/max-ternary-depth.test.ts",
    import.meta.url
  ).href
);
