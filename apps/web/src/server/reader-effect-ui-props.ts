import { Option } from "effect";

import type { ReaderPageProps } from "../client/reader-effect-ui/model.js";
import { ReaderNode } from "../client/reader-node.js";
import type { ReaderPageFlags } from "../client/reader/model.js";

export const readerSupportsEffectUi = (flags: ReaderPageFlags) =>
  flags.blocks.length === 0 &&
  Option.isNone(flags.docs) &&
  Option.isNone(flags.motion) &&
  Option.isNone(flags.tube);

export const readerProps = (flags: ReaderPageFlags): ReaderPageProps => {
  const { path, sourcePath, status } = flags.page;

  return {
    bibliography: flags.bibliography,
    breadcrumb: flags.breadcrumb,
    copyPrompts: flags.copyPrompts,
    heading: flags.heading,
    newsTitle: flags.newsTitle,
    nodes: Option.getOrElse(flags.bodyNodes, () => [
      ReaderNode.Element({
        attributes: [],
        children: [ReaderNode.Text({ value: flags.heading })],
        tag: "h1",
      }),
    ]),
    origin: flags.origin,
    page: { path, sourcePath, status },
    references: flags.references,
  };
};
