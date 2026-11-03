import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { HOOK_BYPASS_REASON } from "../../../scripts/vcs-command-policy.js";
import { fenceMessage, placeholderValue } from "./fixtures/fence-message.js";

const repoRoot = new URL("../../../", import.meta.url);

const LocalPlugin = Schema.Union([
  Schema.String,
  Schema.Struct({ specifier: Schema.String }),
]);

const OxlintConfig = Schema.Struct({
  default: Schema.Struct({ jsPlugins: Schema.Array(LocalPlugin) }),
});

const PluginModule = Schema.Struct({
  default: Schema.Struct({
    meta: Schema.Struct({ name: Schema.String }),
    rules: Schema.Record(
      Schema.String,
      Schema.Struct({
        meta: Schema.Struct({
          messages: Schema.Record(Schema.String, Schema.String),
        }),
      })
    ),
  }),
});

const importFromRoot = (file: string) =>
  Effect.promise(
    // oxlint-disable-next-line promise-function-async -- Effect.promise consumes a Promise factory directly.
    () => import(new URL(file, repoRoot).href)
  );

const loadRegistry = Effect.gen(function* loadRegistry() {
  const config = yield* Schema.decodeUnknownEffect(OxlintConfig)(
    yield* importFromRoot("oxlint.config.ts")
  );

  const localPlugins = config.default.jsPlugins
    .map((plugin) =>
      Schema.is(Schema.String)(plugin) ? plugin : plugin.specifier
    )
    .filter((specifier) => specifier.startsWith("./"));

  const plugins = yield* Effect.all(
    localPlugins.map((specifier) =>
      importFromRoot(specifier).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(PluginModule))
      )
    )
  );

  const entries = plugins.flatMap(({ default: plugin }) =>
    Object.entries(plugin.rules).flatMap(([rule, { meta }]) =>
      Object.entries(meta.messages).map(([messageId, template]) => ({
        id: `${plugin.meta.name}/${rule}#${messageId}`,
        plugin: plugin.meta.name,
        template,
      }))
    )
  );

  return { entries, plugins: plugins.map(({ default: plugin }) => plugin) };
});

const render = (template: string, value: string) =>
  template.replaceAll(/\{\{\s*\w+\s*\}\}/gu, () => value);

describe("fence messages", () => {
  it.effect("covers every rule of every local oxlint plugin", () =>
    Effect.gen(function* coverage() {
      const registry = yield* loadRegistry;
      expect(registry.plugins.length).toBeGreaterThanOrEqual(6);

      for (const plugin of registry.plugins) {
        expect(
          registry.entries.filter((entry) => entry.plugin === plugin.meta.name)
        ).not.toHaveLength(0);
      }
    })
  );

  it("names the fix when the VCS policy blocks a hook bypass", () => {
    expect(fenceMessage(HOOK_BYPASS_REASON)).toBeDefined();
  });

  it.effect.prop(
    "every rendered rule message says what is wrong, why, and the fix",
    { value: Arbitrary.schema(placeholderValue) },
    ({ value }) =>
      Effect.gen(function* renderedMessages() {
        const registry = yield* loadRegistry;

        const unparsed = registry.entries
          .filter(
            ({ template }) =>
              fenceMessage(render(template, value)) === undefined
          )
          .map(({ id }) => id);

        expect(unparsed.join(", ")).toBe("");
      })
  );
});
