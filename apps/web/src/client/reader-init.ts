import { DetectClipboard } from "./reader-clipboard.js";
import type { ReaderPageFlags } from "./reader-model.js";
import { readerInit } from "./reader-model.js";

export const readerBrowserInit = (
  flags: ReaderPageFlags
): ReturnType<typeof readerInit> => ({
  ...readerInit(flags),
  commands: [DetectClipboard()],
});
