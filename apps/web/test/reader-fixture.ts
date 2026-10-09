import { Option } from "effect";

import { ReaderBlock } from "../src/client/reader-document.js";
import { initialModel } from "../src/client/reader/model.js";
import type { ReaderPageFlags } from "../src/client/reader/model.js";

export const promptFixture = {
  id: "start-prompt",
  label: "Copy the start prompt",
  showText: false,
  text: "Read https://ratstack.sh/llms.txt and start a rat-stack project.",
};

export const readerFlagsFixture: ReaderPageFlags = {
  agentMarkdown: Option.none(),
  bibliography: [],
  blocks: [ReaderBlock.CopyPrompt({ id: promptFixture.id })],
  bodyNodes: Option.none(),
  breadcrumb: Option.none(),
  codeFences: [],
  copyPrompts: [promptFixture],
  heading: "Rat Stack",
  origin: "https://ratstack.sh",
  page: {
    generation: "0".repeat(64),
    metadata: {
      canonicalPath: "/",
      description: "A fixture page with one copy prompt.",
      discoveryLinks: [],
      jsonLd: "none",
      ogImagePath: "/og.png",
      robots: "noindex",
      title: "Rat Stack",
    },
    path: "/",
    sourcePath: "README.md",
    status: 200,
  },
  references: Option.none(),
  snippets: [],
  terms: [],
  workshop: Option.none(),
};

export const readerModelFixture = initialModel(readerFlagsFixture);
