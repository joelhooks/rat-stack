import { Effect, Schema } from "effect";

export const ConceptIdSchema = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/u)
);

export const LearnTimestampSchema = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0)
);

export const LearnDepthSchema = Schema.Literals([
  "line",
  "paragraph",
  "walkthrough",
]);

export const FamiliaritySchema = Schema.Literals([0, 1, 2, 3]);

export const DIAGRAM_COLUMNS = 30;

export const DIAGRAM_ROWS = 12;

export const SNIPPET_LINES = 25;

export const PlainLineSchema = Schema.NonEmptyString.check(
  Schema.isMaxLength(160),
  Schema.isPattern(/^[^\n]+$/u)
);

export const SnippetSchema = Schema.NonEmptyString.check(
  Schema.isPattern(
    new RegExp(`^[^\\n]*(?:\\n[^\\n]*){0,${SNIPPET_LINES - 1}}$`, "u")
  )
);

const oneColumnCharacter = String.raw`[^\p{Cc}\p{Cf}\p{Cn}\p{Co}\p{Cs}\p{M}\p{Zl}\p{Zp}\p{Emoji_Presentation}\u{1100}-\u{115F}\u{2E80}-\u{A4CF}\u{AC00}-\u{D7A3}\u{F900}-\u{FAFF}\u{FE30}-\u{FE4F}\u{FF00}-\u{FF60}\u{FFE0}-\u{FFE6}\u{10000}-\u{10FFFF}]`;

const diagramRow = `${oneColumnCharacter}{0,${DIAGRAM_COLUMNS}}`;

export const DiagramSchema = Schema.NonEmptyString.check(
  Schema.isPattern(
    new RegExp(
      `^${diagramRow}(?:\\n${diagramRow}){0,${DIAGRAM_ROWS - 1}}$`,
      "u"
    )
  )
);

export const CardSchema = Schema.Struct({
  claim: Schema.NonEmptyString,
  diagram: Schema.optionalKey(DiagramSchema),
  id: ConceptIdSchema,
  kind: Schema.Literals(["lore", "system", "skill"]),
  plain: Schema.optionalKey(PlainLineSchema),
  prerequisites: Schema.Array(ConceptIdSchema),
  references: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)),
  routePath: Schema.String.check(
    Schema.isPattern(/^\/(?:lore|systems|skills)\/[a-z0-9-]+$/u)
  ),
  snippet: Schema.optionalKey(SnippetSchema),
  summary: Schema.NonEmptyString.check(Schema.isMaxLength(400)),
  terms: Schema.Array(Schema.NonEmptyString),
  version: Schema.Literal(1),
});

export const LearnEventSchema = Schema.Union([
  Schema.Struct({
    at: LearnTimestampSchema,
    depth: LearnDepthSchema,
    id: ConceptIdSchema,
    kind: Schema.Literal("shown"),
    version: Schema.Literal(1),
  }),
  Schema.Struct({
    at: LearnTimestampSchema,
    id: ConceptIdSchema,
    kind: Schema.Literals(["used", "got-it", "skipped", "dismissed"]),
    version: Schema.Literal(1),
  }),
]);

export const ConceptProgressSchema = Schema.Struct({
  dismissed: Schema.Boolean,
  familiarity: FamiliaritySchema,
  id: ConceptIdSchema,
  lastPracticedAt: Schema.NullOr(LearnTimestampSchema),
  lastShownAt: Schema.NullOr(LearnTimestampSchema),
});

export const ProgressSchema = Schema.Struct({
  concepts: Schema.Array(ConceptProgressSchema),
  version: Schema.Literal(1),
});

export const SuppliedProgressSchema = ProgressSchema.pipe(
  Schema.withDecodingDefaultKey(
    Effect.succeed({ concepts: [], version: 1 } as const)
  )
);

export const ConceptProgressRowSchema = Schema.Struct({
  ...ConceptProgressSchema.fields,
  version: Schema.Literal(1),
});

export const LearnTaskSchema = Schema.Struct({
  depth: LearnDepthSchema,
  id: ConceptIdSchema,
  version: Schema.Literal(1),
});

export const LearnContextSchema = Schema.Struct({
  asked: Schema.optional(Schema.Boolean),
  at: LearnTimestampSchema,
  ids: Schema.Array(ConceptIdSchema).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]))
  ),
  terms: Schema.optional(Schema.Array(Schema.NonEmptyString)),
});

export const PresentationSchema = Schema.Struct({
  card: CardSchema,
  depth: LearnDepthSchema,
});

export const LearnSelectionSchema = Schema.Struct({
  cards: Schema.Array(PresentationSchema),
  progress: ProgressSchema,
});

export const SnippetStyleSchema = Schema.Literals(["full", "terse"]);

export const VisualStyleSchema = Schema.Literals(["inline-text", "rich"]);

export const DisplayWidthSchema = Schema.Literals(["narrow", "wide"]);

export const LearnPreferencesSchema = Schema.Struct({
  snippet: SnippetStyleSchema.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("full" as const))
  ),
  version: Schema.Literal(1),
  visual: VisualStyleSchema.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("inline-text" as const))
  ),
  width: DisplayWidthSchema.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("narrow" as const))
  ),
});

export const LearnPreferencesChangeSchema = Schema.Struct({
  snippet: Schema.optionalKey(SnippetStyleSchema),
  visual: Schema.optionalKey(VisualStyleSchema),
  width: Schema.optionalKey(DisplayWidthSchema),
});

export class LearnError extends Schema.TaggedError<LearnError>()("LearnError", {
  id: Schema.String,
  reason: Schema.String,
}) {}

export type Card = typeof CardSchema.Type;

export type LearnEvent = typeof LearnEventSchema.Type;

export type ConceptProgress = typeof ConceptProgressSchema.Type;

export type Progress = typeof ProgressSchema.Type;

export type LearnDepth = typeof LearnDepthSchema.Type;

export type LearnContext = typeof LearnContextSchema.Type;

export type LearnSelection = typeof LearnSelectionSchema.Type;

export type LearnPreferences = typeof LearnPreferencesSchema.Type;

export type LearnPreferencesChange = typeof LearnPreferencesChangeSchema.Type;

export const defaultPreferences: LearnPreferences = {
  snippet: "full",
  version: 1,
  visual: "inline-text",
  width: "narrow",
};

export const emptyProgress: Progress = { concepts: [], version: 1 };

export const newConcept = (id: string): ConceptProgress => ({
  dismissed: false,
  familiarity: 0,
  id,
  lastPracticedAt: null,
  lastShownAt: null,
});
