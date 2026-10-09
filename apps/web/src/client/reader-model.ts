import { Schema } from "effect";
import type { ApplicationInit } from "foldkit/runtime";

import { bibliographySourceSchema } from "../../../mischief/scripts/component-data.js";
import { ReaderPageDescriptor, ReaderReferences } from "../page-descriptor.js";
import { ReaderBlock } from "./reader-document.js";
import type { ReaderMessage } from "./reader-message.js";
import { ReaderBreadcrumb, ReaderNodeSchema } from "./reader-node.js";

export { ReaderReferences } from "../page-descriptor.js";

export const ReaderFlags = Schema.Struct({
  agentMarkdown: Schema.optional(Schema.String),
  bibliography: Schema.Array(bibliographySourceSchema),
  blocks: Schema.Array(ReaderBlock),
  bodyNodes: Schema.optional(Schema.Array(ReaderNodeSchema)),
  breadcrumb: Schema.optional(ReaderBreadcrumb),
  codeFences: Schema.Array(
    Schema.Struct({ html: Schema.String, value: Schema.String })
  ),
  copyPrompts: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      label: Schema.String,
      showText: Schema.Boolean,
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
  workshop: Schema.optional(
    Schema.Struct({
      href: Schema.String,
      label: Schema.String,
      line: Schema.String,
      link: Schema.String,
    })
  ),
});

export const CopyStatus = Schema.Literals([
  "idle",
  "copying",
  "copied",
  "failed",
]);

export const ReaderState = Schema.Struct({
  ...ReaderFlags.fields,
  clipboardReady: Schema.Boolean,
  copyStates: Schema.Record(Schema.String, CopyStatus),
});

export type ReaderModel = typeof ReaderState.Type;

export type ReaderPageFlags = typeof ReaderFlags.Type;

export const readerInit: ApplicationInit<
  ReaderModel,
  typeof ReaderMessage.Type,
  ReaderPageFlags
> = (flags) => ({
  model: { ...flags, clipboardReady: false, copyStates: {} },
});
