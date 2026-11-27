import { UiSchema } from "@effect/ui";
import { Schema } from "effect";

import { bibliographySourceSchema } from "../../../../site/scripts/component-data.js";
import { ReaderReferences } from "../../page-descriptor.js";
import { effectUiHandoff } from "../effect-ui-handoff.js";
import { CopyPrompt } from "../reader-copy-prompt.js";
import { ReaderBreadcrumb, ReaderNodeSchema } from "../reader-node.js";

export const ReaderProps = Schema.Struct({
  bibliography: Schema.Array(bibliographySourceSchema),
  breadcrumb: Schema.OptionFromOptional(ReaderBreadcrumb),
  copyPrompts: Schema.Array(CopyPrompt),
  heading: Schema.String,
  newsTitle: Schema.OptionFromOptional(Schema.String),
  nodes: Schema.Array(ReaderNodeSchema),
  origin: Schema.String,
  page: Schema.Struct({
    path: Schema.String,
    sourcePath: Schema.String,
    status: Schema.Int,
  }),
  references: Schema.OptionFromOptional(ReaderReferences),
});

export const ReaderHandoff = effectUiHandoff(ReaderProps);

export const readerRootId = "reader-effect-ui";

export const readerHandoffId = "reader-effect-ui-handoff";

export type ReaderPageProps = typeof ReaderProps.Type;

const CopyStatus = Schema.Literals(["copying", "copied", "failed"]);

export const ReaderModel = Schema.Struct({
  clipboard: Schema.Literals(["unknown", "unavailable", "available"]),
  copyStatuses: Schema.Record(Schema.String, CopyStatus),
});

export type ReaderState = typeof ReaderModel.Type;

export const ReaderMessage = UiSchema.TaggedEnum({
  ClickedCopy: { id: Schema.String },
  CompletedDetectClipboard: { available: Schema.Boolean },
  CompletedWaitBeforeCopyReset: { id: Schema.String },
  FailedCopyReaderText: { id: Schema.String },
  SucceededCopyReaderText: { id: Schema.String },
});

export const findCopyPrompt = (props: ReaderPageProps, id: string) =>
  props.copyPrompts.find((prompt) => prompt.id === id);
