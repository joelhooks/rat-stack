import { Html } from "@effect/ui/html";
import { Record } from "effect";

import { view } from "../../features/reader-effect-ui/view.js";
import {
  CopyReaderText,
  DetectClipboard,
  WaitBeforeCopyReset,
} from "./command.js";
import {
  findCopyPrompt,
  ReaderMessage,
  ReaderModel,
  ReaderProps,
} from "./model.js";

export const ReaderPage = Html.component({
  name: "ReaderPage",
  props: ReaderProps,
  model: ReaderModel,
  message: ReaderMessage,
}).make({
  init: ($) => {
    const initial = $.set({ clipboard: "unknown", copyStatuses: {} });

    return $.props.copyPrompts.length === 0
      ? initial
      : initial.run(DetectClipboard.make({}));
  },
  update: ($, message) =>
    ReaderMessage.match(message, {
      ClickedCopy: ({ id }) => {
        const status = $.model.copyStatuses[id];
        const prompt = findCopyPrompt($.props, id);

        if (
          $.model.clipboard !== "available" ||
          status === "copying" ||
          status === "copied" ||
          prompt === undefined
        ) {
          return $.model;
        }

        return $.evolve({
          copyStatuses: Record.set($.model.copyStatuses, id, "copying"),
        }).run(CopyReaderText.make({ id, text: prompt.text }));
      },
      CompletedDetectClipboard: ({ available }) =>
        $.evolve({ clipboard: available ? "available" : "unavailable" }),
      CompletedWaitBeforeCopyReset: ({ id }) =>
        $.model.copyStatuses[id] === "copied"
          ? $.evolve({ copyStatuses: Record.remove(id) })
          : $.model,
      FailedCopyReaderText: ({ id }) =>
        $.model.copyStatuses[id] === "copying"
          ? $.evolve({
              copyStatuses: Record.set($.model.copyStatuses, id, "failed"),
            })
          : $.model,
      SucceededCopyReaderText: ({ id }) =>
        $.model.copyStatuses[id] === "copying"
          ? $.evolve({
              copyStatuses: Record.set($.model.copyStatuses, id, "copied"),
            }).run(WaitBeforeCopyReset.make({ id }))
          : $.model,
    }),
  view: (h, model) => view(h, h.props, model),
});
