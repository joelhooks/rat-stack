import { Array, Option, Record, Schema } from "effect";
import { defineTaggedUnion } from "foldkit/schema";

import { bibliographySourceSchema } from "../../../../mischief/scripts/component-data.js";
import {
  ReaderPageDescriptor,
  ReaderReferences,
} from "../../page-descriptor.js";
import { ReaderBlock } from "../reader-document.js";
import { ReaderBreadcrumb, ReaderNodeSchema } from "../reader-node.js";

export { ReaderReferences } from "../../page-descriptor.js";

export const CopyPrompt = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  showText: Schema.Boolean,
  text: Schema.String,
});

export const ReaderFlags = Schema.Struct({
  agentMarkdown: Schema.OptionFromOptional(Schema.String),
  bibliography: Schema.Array(bibliographySourceSchema),
  blocks: Schema.Array(ReaderBlock),
  bodyNodes: Schema.OptionFromOptional(Schema.Array(ReaderNodeSchema)),
  breadcrumb: Schema.OptionFromOptional(ReaderBreadcrumb),
  codeFences: Schema.Array(
    Schema.Struct({ html: Schema.String, value: Schema.String })
  ),
  copyPrompts: Schema.Array(CopyPrompt),
  heading: Schema.String,
  origin: Schema.String,
  page: ReaderPageDescriptor,
  references: Schema.OptionFromOptional(ReaderReferences),
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
  workshop: Schema.OptionFromOptional(
    Schema.Struct({
      href: Schema.String,
      label: Schema.String,
      line: Schema.String,
      link: Schema.String,
    })
  ),
});

export type ReaderPageFlags = typeof ReaderFlags.Type;

export const CopyStatus = defineTaggedUnion({
  Copied: {},
  Copying: {},
  Failed: {},
  Idle: {},
});

export const ClipboardAccess = defineTaggedUnion({
  Available: {},
  Unavailable: {},
  Unknown: {},
});

export const DetectedClipboardAccess = ClipboardAccess.subset([
  "Available",
  "Unavailable",
]);

export const Model = Schema.Struct({
  ...ReaderFlags.fields,
  clipboardAccess: ClipboardAccess,
  copyStatuses: Schema.Record(Schema.String, CopyStatus),
});

export type ReaderModel = typeof Model.Type;

export const initialModel = (flags: ReaderPageFlags): ReaderModel => ({
  ...flags,
  clipboardAccess: ClipboardAccess.Unknown(),
  copyStatuses: {},
});

export const copyStatusOf = (
  model: Pick<ReaderModel, "copyStatuses">,
  id: string
): typeof CopyStatus.Type =>
  Option.getOrElse(Record.get(model.copyStatuses, id), () => CopyStatus.Idle());

export const findCopyPrompt = (
  model: Pick<ReaderModel, "copyPrompts">,
  id: string
) => Array.findFirst(model.copyPrompts, (prompt) => prompt.id === id);
