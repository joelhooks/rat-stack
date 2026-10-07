import { Data, Schema } from "effect";
import { defineTaggedUnion } from "foldkit/schema";

export type ReaderInlineValue = Data.TaggedEnum<{
  Code: { readonly value: string };
  Emphasis: { readonly content: readonly ReaderInlineValue[] };
  Link: { readonly href: string; readonly value: string };
  Strong: { readonly content: readonly ReaderInlineValue[] };
  Text: { readonly value: string };
}>;

export const ReaderInline = Data.taggedEnum<ReaderInlineValue>();

export const ReaderInlineSchema: Schema.Codec<ReaderInlineValue> =
  Schema.suspend(() =>
    Schema.Union([
      Schema.TaggedStruct("Code", { value: Schema.String }),
      Schema.TaggedStruct("Emphasis", {
        content: Schema.Array(ReaderInlineSchema),
      }),
      Schema.TaggedStruct("Link", {
        href: Schema.String,
        value: Schema.String,
      }),
      Schema.TaggedStruct("Strong", {
        content: Schema.Array(ReaderInlineSchema),
      }),
      Schema.TaggedStruct("Text", { value: Schema.String }),
    ])
  );

export const ReaderBlock = defineTaggedUnion({
  CodeFence: {
    language: Schema.String,
    meta: Schema.String,
    value: Schema.String,
  },
  CopyPrompt: { id: Schema.String },
  Diagram: { alt: Schema.String, value: Schema.String },
  Heading: {
    id: Schema.String,
    level: Schema.optional(Schema.Literals([2, 3, 4])),
    title: Schema.String,
  },
  List: { items: Schema.Array(Schema.Array(ReaderInlineSchema)) },
  Paragraph: { content: Schema.Array(ReaderInlineSchema) },
  PromptText: { value: Schema.String },
  Snippet: {
    at: Schema.String,
    lines: Schema.String,
    path: Schema.String,
    repo: Schema.String,
  },
});

export type ReaderBlockValue = typeof ReaderBlock.Type;
