import { expect, it } from "@effect/vitest";
import { Effect, Predicate, Schema } from "effect";
import { Arbitrary } from "effect/unstable/arbitrary";
import { compile } from "mdsvex";
import { compile as compileSvelte } from "svelte/compiler";
import { render } from "svelte/server";

import {
  buildBlockIndex,
  paragraphAnchors,
} from "../scripts/content-blocks.ts";
import { buildError, escapeSvelteBraces } from "../scripts/content-lib.ts";

const indexFor = (rawText: string) =>
  buildBlockIndex([
    { rawText, routePath: "/lore/source", title: "Source page" },
  ]);

it.effect.prop(
  "unrelated edits preserve paragraph and list-item IDs",
  {
    edit: Arbitrary.schema(Schema.String),
  },
  ({ edit }) =>
    Effect.gen(function* stableBlockIds() {
      const before = yield* indexFor(
        "Original paragraph.\n\nUnchanged paragraph.\n\n- Unchanged item."
      );

      const after = yield* indexFor(
        `Changed ${JSON.stringify(edit)}.\n\nUnchanged paragraph.\n\n- Unchanged item.`
      );

      const stableBlocks = before
        .get("/lore/source")
        ?.blocks.filter((block) => block.text.includes("Unchanged"));

      expect(stableBlocks?.length).toBe(2);

      for (const block of stableBlocks ?? []) {
        expect(
          after
            .get("/lore/source")
            ?.blocks.find((candidate) => candidate.text === block.text)?.id
        ).toBe(block.id);
      }
    })
);

it.effect("explicit IDs win and collisions remain unique", () =>
  Effect.gen(function* explicitBlockIds() {
    const initial = yield* indexFor("Repeated.\n\nRepeated.");
    const generatedId = initial.get("/lore/source")?.blocks[0]?.id;

    const index = yield* indexFor(
      `Repeated.\n\nExplicit. {#${generatedId}}\n\nRepeated.`
    );

    const blocks = index.get("/lore/source")?.blocks ?? [];

    expect(blocks.find((block) => block.text === "Explicit.")?.id).toBe(
      generatedId
    );
    expect(new Set(blocks.map((block) => block.id)).size).toBe(blocks.length);
  })
);

const compiledModule = Schema.Struct({
  default: Schema.declare((value): value is Parameters<typeof render>[0] =>
    Predicate.isFunction(value)
  ),
});

const renderMarkdown = Effect.fn("renderMarkdown")(function* renderMarkdown(
  source: string
) {
  const compiled = yield* Effect.tryPromise({
    catch: (cause) => buildError("test compile", "fixture.svx", cause),
    // @effect-diagnostics-next-line asyncFunction:off -- mdsvex owns this rendering-test Promise boundary.
    try: async () =>
      await compile(source, {
        rehypePlugins: [paragraphAnchors(), escapeSvelteBraces],
      }),
  });

  const compiledCode = yield* Schema.decodeUnknownEffect(
    Schema.Struct({ code: Schema.String })
  )(compiled);

  const output = compileSvelte(compiledCode.code, { generate: "server" }).js
    .code;

  const executable = output.replaceAll(
    "'svelte/internal/server'",
    JSON.stringify(import.meta.resolve("svelte/internal/server"))
  );

  const moduleUrl = `data:text/javascript;base64,${Buffer.from(executable).toString("base64")}`;

  const moduleValue: unknown = yield* Effect.tryPromise({
    catch: (cause) => buildError("test module", "fixture.svx", cause),
    // oxlint-disable-next-line typescript/promise-function-async -- Node owns the module-loader Promise boundary.
    try: () => import(moduleUrl),
  });

  const component =
    yield* Schema.decodeUnknownEffect(compiledModule)(moduleValue);

  return render(component.default, { props: {} }).body;
});

it.effect("paragraph links resolve in tight, loose and nested lists", () =>
  Effect.gen(function* renderedAnchors() {
    const html = yield* renderMarkdown(
      "Claim. {#claim}\n\n- Tight item. {#item}\n- Next item.\n  - Nested item.\n\n- Loose item.\n\n  Second paragraph."
    );

    const ids = [...html.matchAll(/ id="(?<id>[^"]+)"/gu)].map(
      (match) => match.groups?.id
    );

    expect(ids).toContain("claim");
    expect(ids).toContain("item");
    expect(new Set(ids).size).toBe(ids.length);
    expect(html).not.toContain("{#");

    for (const match of html.matchAll(
      /class="paragraph-link" href="#(?<id>[^"]+)"/gu
    )) {
      expect(ids).toContain(match.groups?.id);
    }

    expect(
      [...html.matchAll(/aria-label="Link to this paragraph"/gu)].length
    ).toBe(ids.length);
  })
);
