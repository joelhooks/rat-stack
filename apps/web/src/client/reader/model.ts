import { Array, Option, Record, Schema } from "effect";
import { defineTaggedUnion } from "foldkit/schema";

import { bibliographySourceSchema } from "../../../../site/scripts/component-data.js";
import {
  ReaderPageDescriptor,
  ReaderReferences,
} from "../../page-descriptor.js";
import { Model as CafeModel } from "../cafe/model.js";
import { Model as DocsModel } from "../docs/model.js";
import { Model as MotionDemoModel } from "../motion/model.js";
import { ReaderBlock } from "../reader-document.js";
import { ReaderBreadcrumb, ReaderNodeSchema } from "../reader-node.js";
import { OutlineRange } from "./outline-range.js";
import { Peek, PeekCard } from "./peek.js";
import { defaultReaderSettings, ReaderSettings } from "./settings.js";

export { ReaderReferences } from "../../page-descriptor.js";

export const CopyPrompt = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  showText: Schema.Boolean,
  text: Schema.String,
});

export const SectionPage = Schema.Struct({
  path: Schema.String,
  title: Schema.String,
});

export const SectionIndex = Schema.Struct({
  href: Schema.String,
  pages: Schema.Array(SectionPage),
  title: Schema.String,
});

export const ReaderFlags = Schema.Struct({
  agentMarkdown: Schema.OptionFromOptional(Schema.String),
  bibliography: Schema.Array(bibliographySourceSchema),
  blocks: Schema.Array(ReaderBlock),
  bodyNodes: Schema.OptionFromOptional(Schema.Array(ReaderNodeSchema)),
  breadcrumb: Schema.OptionFromOptional(ReaderBreadcrumb),
  cafe: Schema.OptionFromOptional(CafeModel),
  codeFences: Schema.Array(
    Schema.Struct({ html: Schema.String, value: Schema.String })
  ),
  copyPrompts: Schema.Array(CopyPrompt),
  docs: Schema.OptionFromOptional(DocsModel),
  heading: Schema.String,
  motion: Schema.OptionFromOptional(MotionDemoModel),
  newsTitle: Schema.OptionFromOptional(Schema.String),
  origin: Schema.String,
  page: ReaderPageDescriptor,
  references: Schema.OptionFromOptional(ReaderReferences),
  sectionIndex: Schema.OptionFromOptional(SectionIndex),
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

export const Disclosure = defineTaggedUnion({
  Closed: {},
  Open: {},
  Unavailable: {},
});

export type DisclosureValue = typeof Disclosure.Type;

export const toggleDisclosure = Disclosure.match({
  Closed: () => Disclosure.Open(),
  Open: () => Disclosure.Closed(),
  Unavailable: () => Disclosure.Unavailable(),
});

export const closeDisclosure = (disclosure: DisclosureValue) =>
  Disclosure.guards.Open(disclosure) ? Disclosure.Closed() : disclosure;

export const Model = Schema.Struct({
  ...ReaderFlags.fields,
  clipboardAccess: ClipboardAccess,
  copyStatuses: Schema.Record(Schema.String, CopyStatus),
  graphLit: Schema.Option(Schema.String),
  menu: Disclosure,
  outlineRange: Schema.Option(OutlineRange),
  peek: Peek,
  peekCards: Schema.Record(Schema.String, PeekCard),
  settings: ReaderSettings,
  settingsPanel: Disclosure,
});

export type ReaderModel = typeof Model.Type;

export const initialModel = (flags: ReaderPageFlags): ReaderModel => ({
  ...flags,
  clipboardAccess: ClipboardAccess.Unknown(),
  copyStatuses: {},
  graphLit: Option.none(),
  menu: Disclosure.Unavailable(),
  outlineRange: Option.none(),
  peek: Peek.Hidden(),
  peekCards: {},
  settings: defaultReaderSettings,
  settingsPanel: Disclosure.Unavailable(),
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
