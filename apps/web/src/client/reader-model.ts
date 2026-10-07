import { Schema } from "effect";

import { bibliographySourceSchema } from "../../../mischief/scripts/component-data.js";
import { ReaderPageDescriptor } from "../page-descriptor.js";
import { ReaderBlock } from "./reader-document.js";

export const ReaderReferences = Schema.Struct({
  anchors: Schema.Array(
    Schema.Struct({ id: Schema.String, text: Schema.String })
  ),
  backlinks: Schema.Array(
    Schema.Struct({
      context: Schema.String,
      description: Schema.String,
      route: Schema.String,
      title: Schema.String,
    })
  ),
  inboundCounts: Schema.Record(Schema.String, Schema.Int),
  lastChange: Schema.optional(
    Schema.Struct({
      date: Schema.String,
      hash: Schema.String,
      short: Schema.String,
    })
  ),
});

export const ReaderFlags = Schema.Struct({
  bibliography: Schema.Array(bibliographySourceSchema),
  blocks: Schema.Array(ReaderBlock),
  codeFences: Schema.Array(
    Schema.Struct({ html: Schema.String, value: Schema.String })
  ),
  copyPrompts: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      label: Schema.String,
      text: Schema.String,
    })
  ),
  heading: Schema.String,
  origin: Schema.String,
  page: ReaderPageDescriptor,
  references: Schema.optional(ReaderReferences),
  snippets: Schema.Array(
    Schema.Struct({
      at: Schema.String,
      html: Schema.String,
      lines: Schema.String,
      path: Schema.String,
      repo: Schema.String,
    })
  ),
  terms: Schema.Array(Schema.String),
  workshop: Schema.Struct({
    href: Schema.String,
    label: Schema.String,
    line: Schema.String,
    link: Schema.String,
    note: Schema.String,
  }),
});

export type ReaderModel = typeof ReaderFlags.Type;

export const readerInit = (flags: ReaderModel) => ({ model: flags });
