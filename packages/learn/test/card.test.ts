import { expect, it } from "@effect/vitest";
import {
  CardSchema,
  DIAGRAM_COLUMNS,
  DIAGRAM_ROWS,
  DiagramSchema,
  emptyProgress,
  LearnContextSchema,
  LearnEventSchema,
  PlainLineSchema,
  SNIPPET_LINES,
  SnippetSchema,
  learnNextContract,
  learnRecordContract,
} from "@rat-stack/core/learn";
import { Effect, Exit, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

const line = Arbitrary.map(
  Arbitrary.schema(
    Schema.Struct({
      text: Schema.String,
      width: Schema.Int.check(
        Schema.isBetween({ maximum: DIAGRAM_COLUMNS + 3, minimum: 0 })
      ),
    })
  ),
  ({ text, width }) =>
    `${text.replaceAll(/[\r\n]/gu, "x")}${"x".repeat(width)}`.slice(0, width)
);

const lines = Arbitrary.array(line, {
  maxLength: Math.max(DIAGRAM_ROWS, SNIPPET_LINES) + 3,
  minLength: 1,
});

const decodes = <A>(schema: Schema.Codec<A, string>, value: string) =>
  Exit.isSuccess(Schema.decodeUnknownExit(schema)(value));

it.prop(
  "a diagram decodes exactly when it is non-empty and fits the column and row limits",
  { rows: lines },
  ({ rows }) => {
    const fits =
      rows.length <= DIAGRAM_ROWS &&
      rows.every((row) => row.length <= DIAGRAM_COLUMNS);

    const text = rows.join("\n");

    expect(decodes(DiagramSchema, text)).toBe(fits && text !== "");
  }
);

it.prop(
  "a snippet decodes exactly when it is non-empty and within the line limit",
  { rows: lines },
  ({ rows }) => {
    const text = rows.join("\n");

    expect(decodes(SnippetSchema, text)).toBe(
      rows.length <= SNIPPET_LINES && text !== ""
    );
  }
);

it.prop(
  "a plain line decodes exactly when it is one non-empty line of at most 160 characters",
  { rows: lines },
  ({ rows }) => {
    const text = rows.join("\n").repeat(5);

    expect(decodes(PlainLineSchema, text)).toBe(
      rows.length === 1 && text !== "" && text.length <= 160
    );
  }
);

it.prop(
  "cards with teaching fields survive the JSON round trip that learn.json and every surface use",
  { card: Arbitrary.schema(CardSchema) },
  ({ card }) => {
    const json = Schema.fromJsonString(CardSchema);

    expect(
      Schema.decodeUnknownSync(json)(Schema.encodeSync(json)(card))
    ).toEqual(card);
  }
);

it.effect.prop(
  "omitted progress decodes as empty progress for selection and recording",
  {
    context: Arbitrary.schema(LearnContextSchema),
    event: Arbitrary.schema(LearnEventSchema),
  },
  ({ context, event }) =>
    Effect.gen(function* omitProgress() {
      const encodedContext =
        yield* Schema.encodeEffect(LearnContextSchema)(context);

      const next = yield* Schema.decodeUnknownEffect(learnNextContract.input)({
        context: encodedContext,
      });

      const nextWithEmpty = yield* Schema.decodeUnknownEffect(
        learnNextContract.input
      )({ context: encodedContext, progress: emptyProgress });

      const bare = yield* Schema.decodeUnknownEffect(learnNextContract.input)(
        {}
      );

      const record = yield* Schema.decodeUnknownEffect(
        learnRecordContract.input
      )({ event });

      expect(next).toStrictEqual(nextWithEmpty);
      expect(bare.progress).toStrictEqual(emptyProgress);
      expect(record.progress).toStrictEqual(emptyProgress);
    })
);
