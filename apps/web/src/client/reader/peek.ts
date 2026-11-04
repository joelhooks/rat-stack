import { Schema } from "effect";
import { defineTaggedUnion } from "foldkit/schema";

export const PeekAnchor = Schema.Struct({
  above: Schema.Boolean,
  inbound: Schema.Option(Schema.Int),
  label: Schema.String,
  left: Schema.Finite,
  top: Schema.Finite,
});

export type PeekAnchorValue = typeof PeekAnchor.Type;

export const Peek = defineTaggedUnion({
  Hidden: {},
  Open: { anchor: PeekAnchor, route: Schema.String },
  Waiting: { anchor: PeekAnchor, route: Schema.String },
});

export const PeekCard = defineTaggedUnion({
  Loaded: { summary: Schema.String, title: Schema.String },
  Loading: {},
  Missing: {},
});

const firstParagraph = (text: string) =>
  text
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .find(
      (block) =>
        block !== "" &&
        !block.startsWith("#") &&
        !block.startsWith("---") &&
        !block.startsWith("```")
    ) ?? "";

export const peekSummary = (document: {
  readonly description: string;
  readonly text: string;
}) =>
  document.description.trim() === ""
    ? firstParagraph(document.text)
    : document.description.trim();

export const routeOfPath = (pathname: string) =>
  pathname.replace(/\/$/u, "") || "/";
