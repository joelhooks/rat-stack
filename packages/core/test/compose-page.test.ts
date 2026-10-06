import { expect, it } from "@effect/vitest";
import { createSpecStreamCompiler } from "@json-render/core";
import type { Spec } from "@json-render/core";
import { Effect, Result, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { composePage } from "../src/compose-page.js";
import type { composePageContract } from "../src/contracts.js";
import { InvalidPage } from "../src/invalid-page.js";
import {
  inspectCatalogPage,
  pageCatalog,
  pageCatalogMetadata,
} from "../src/page-catalog.js";
import {
  FeaturedSite,
  PageSpec,
  PageSubmission,
  pageCatalogMetadata as generatedMetadata,
} from "../src/page-spec.js";

const validatePage = (input: typeof composePageContract.input.Type) => {
  const result = inspectCatalogPage(input.spec);

  return result.spec === undefined
    ? Result.fail(new InvalidPage({ issues: result.issues }))
    : Result.succeed(result.spec);
};

it("the build-derived wire hint describes the live catalogue instead of an empty Unknown", () => {
  const document = Schema.toJsonSchemaDocument(
    Schema.toCodecJson(PageSubmission)
  );

  const hint = Schema.decodeUnknownSync(
    Schema.Struct({ properties: Schema.Struct({ spec: Schema.JsonObject }) })
  )(document.schema);

  expect(hint.properties.spec).toEqual(pageCatalog.jsonSchema());
  expect(generatedMetadata).toEqual(pageCatalogMetadata);
});

it.effect.prop(
  "a spec accepted by the shallow wire codec still fails native catalogue validation with its typed failure",
  { intro: Schema.Boolean, title: Schema.Finite },
  ({ intro, title }) =>
    Effect.gen(function* nativeBoundarySplit() {
      const spec = {
        elements: {
          page: { children: [], props: { intro, title }, type: "Page" },
        },
        root: "page",
      };

      const shallow = yield* Schema.decodeEffect(PageSpec)(spec);

      const failure = yield* composePage
        .handler({ spec: shallow })
        .pipe(Effect.flip);

      expect(failure._tag).toBe("InvalidPage");
      expect(failure.issues.map((issue) => issue.path)).toEqual([
        "elements.page.props.intro",
        "elements.page.props.title",
      ]);
    })
);

const Edit = Schema.Struct({
  change: Schema.Literals([
    "title",
    "breakProps",
    "repairProps",
    "missingChild",
    "repairChild",
    "unknown",
    "repairType",
  ]),
  title: FeaturedSite.fields.name,
});

it.effect.prop(
  "composition validates each generated edit independently without retaining a previous page",
  {
    edits: Arbitrary.array(Arbitrary.schema(Edit), { maxLength: 40 }),
    title: FeaturedSite.fields.name,
  },
  ({ edits, title }) =>
    Effect.gen(function* composeEdits() {
      let submission: Spec = {
        elements: {
          page: { children: [], props: { intro: "", title }, type: "Page" },
        },
        root: "page",
      };

      let validProps = true;
      let validChildren = true;
      let validType = true;

      for (const edit of edits) {
        const { page } = submission.elements;

        if (page === undefined) {
          throw new Error("The model always owns its page.");
        }

        switch (edit.change) {
          case "title": {
            submission = {
              elements: {
                page: { ...page, props: { intro: "", title: edit.title } },
              },
              root: "page",
            };
            validProps = true;
            break;
          }

          case "breakProps": {
            submission = {
              elements: { page: { ...page, props: { intro: "", title: 123 } } },
              root: "page",
            };
            validProps = false;
            break;
          }

          case "repairProps": {
            submission = {
              elements: {
                page: { ...page, props: { intro: "", title: edit.title } },
              },
              root: "page",
            };
            validProps = true;
            break;
          }

          case "missingChild": {
            submission = {
              elements: { page: { ...page, children: ["absent"] } },
              root: "page",
            };
            validChildren = false;
            break;
          }

          case "repairChild": {
            submission = {
              elements: { page: { ...page, children: [] } },
              root: "page",
            };
            validChildren = true;
            break;
          }

          case "unknown": {
            submission = {
              elements: { page: { ...page, type: "NotInCatalog" } },
              root: "page",
            };
            validType = false;
            break;
          }

          case "repairType": {
            submission = {
              elements: { page: { ...page, type: "Page" } },
              root: "page",
            };
            validType = true;
            break;
          }

          default: {
            break;
          }
        }

        const result = yield* Effect.result(
          composePage.handler({ spec: submission })
        );

        expect(Result.isSuccess(result)).toBe(
          validProps && validChildren && validType
        );

        if (Result.isFailure(result)) {
          const failures = result.failure.issues;

          if (!validType) {
            expect(failures).toContainEqual(
              expect.objectContaining({
                kind: "UnknownComponent",
                path: "elements.page",
              })
            );
          }

          if (validType && !validProps) {
            expect(failures).toContainEqual(
              expect.objectContaining({
                kind: "InvalidProps",
                path: "elements.page.props.title",
              })
            );
          }

          if (!validChildren) {
            expect(failures).toContainEqual(
              expect.objectContaining({
                kind: "MissingChild",
                path: "elements.page.children.0",
              })
            );
          }
        } else {
          expect(result.success).toEqual(submission);
        }
      }
    }),
  { arbitrary: { runs: 150 } }
);

it.prop(
  "invalid props report every independent field at its repair path",
  { intro: Schema.Finite, title: Schema.Boolean },
  ({ intro, title }) => {
    const result = validatePage({
      spec: {
        elements: {
          page: { children: [], props: { intro, title }, type: "Page" },
        },
        root: "page",
      },
    });

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure.issues.map((issue) => issue.path)).toEqual([
        "elements.page.props.intro",
        "elements.page.props.title",
      ]);
    }
  }
);

it.prop(
  "cycles, missing children, unknown components and orphans accumulate instead of hiding each other",
  {
    id: Schema.String.check(Schema.isPattern(/^node-[a-z]{1,12}$/u)),
    missing: Schema.Literals([
      "missing!",
      "constructor",
      "__proto__",
      "toString",
    ]),
  },
  ({ id, missing }) => {
    const result = validatePage({
      spec: {
        elements: {
          [id]: { children: [id, missing], props: {}, type: "Grid" },
          "orphan!": { children: ["orphan!"], props: {}, type: "Other" },
        },
        root: id,
      },
    });

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "UnknownComponent",
            path: "elements.orphan!",
          }),
          expect.objectContaining({
            kind: "MissingChild",
            path: `elements.${id}.children.1`,
          }),
          expect.objectContaining({
            kind: "Cycle",
            path: `elements.${id}.children`,
          }),
          expect.objectContaining({
            kind: "Cycle",
            path: "elements.orphan!.children",
          }),
          expect.objectContaining({ kind: "Orphan", path: "elements.orphan!" }),
        ])
      );
    }
  }
);

it.effect.prop(
  "native streaming patches yield composable pages at every generated chunk boundary",
  {
    chunkSize: Schema.Int.check(Schema.isBetween({ maximum: 80, minimum: 1 })),
    title: FeaturedSite.fields.name,
  },
  ({ chunkSize, title }) =>
    Effect.gen(function* streamedComposition() {
      const compiler = createSpecStreamCompiler();

      const stream = `${[
        { op: "add", path: "/root", value: "page" },
        {
          op: "add",
          path: "/elements",
          value: {
            page: { children: [], props: { intro: "", title }, type: "Page" },
          },
        },
      ]
        .map((patch) => JSON.stringify(patch))
        .join("\n")}\n`;

      for (let offset = 0; offset < stream.length; offset += chunkSize) {
        compiler.push(stream.slice(offset, offset + chunkSize));
      }

      const result = yield* composePage.handler({ spec: compiler.getResult() });

      expect(result.root).toBe("page");
      expect(result.elements.page?.props.title).toBe(title);
      expect(result.elements.page?.children).toEqual([]);
    })
);

it.prop(
  "one accent means one rendered Callout, including shared children and repeat scopes",
  {
    copies: Schema.Int.check(Schema.isBetween({ maximum: 10, minimum: 2 })),
    repeated: Schema.Boolean,
    title: FeaturedSite.fields.name,
  },
  ({ copies, repeated, title }) => {
    const grid = repeated
      ? {
          children: ["note"],
          props: {},
          repeat: { statePath: "/items" },
          type: "Grid",
        }
      : {
          children: Array.from({ length: copies }, () => "note"),
          props: {},
          type: "Grid",
        };

    const result = validatePage({
      spec: {
        elements: {
          grid,
          note: { children: [], props: { text: "", title }, type: "Callout" },
        },
        root: "grid",
      },
    });

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure.issues).toContainEqual(
        expect.objectContaining({
          kind: "MultipleCallouts",
          path: "elements.note",
        })
      );
    }
  }
);
