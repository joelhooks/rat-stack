import type { Html } from "@effect/ui/html";

import {
  findCopyPrompt,
  ReaderMessage,
} from "../../client/reader-effect-ui/model.js";
import type {
  ReaderPageProps,
  ReaderState,
} from "../../client/reader-effect-ui/model.js";

type ReaderHtml = Html.H<typeof ReaderMessage.Type>;

const missingReference = (h: ReaderHtml, description: string) =>
  h.p.attrs({ class: "reader-missing", role: "note" }).children(description);

const icon = (h: ReaderHtml, copied: boolean) =>
  h
    .el("svg")
    .attrs({
      "aria-hidden": "true",
      class: copied ? "icon icon-done" : "icon",
      fill: "none",
      focusable: "false",
      height: "16",
      stroke: "currentColor",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "stroke-width": copied ? "1.5" : "2",
      viewBox: "0 0 24 24",
      width: "16",
    })
    .children(
      ...(copied
        ? [h.el("path").attr("d", "M5 14L8.5 17.5L19 6.5")]
        : [
            h.el("path").attr("d", "M12 8V4H8"),
            h
              .el("rect")
              .attrs({ height: "12", rx: "2", width: "16", x: "4", y: "8" }),
            h.el("path").attr("d", "M2 14h2m16 0h2m-7-1v2m-6-2v2"),
          ])
    );

const copyStatusText = {
  copied: "Copied ✓",
  copying: "",
  failed: "Copy failed. Select the text and copy it.",
};

export const copyControl = (
  h: ReaderHtml,
  props: ReaderPageProps,
  model: ReaderState,
  id: string,
  primary: boolean
) => {
  const prompt = findCopyPrompt(props, id);

  if (prompt === undefined) {
    return missingReference(h, `The ${id} prompt is not in this page.`);
  }

  const status = model.copyStatuses[id];
  const copied = status === "copied";
  const statusText = status === undefined ? "" : copyStatusText[status];

  return h.span.class("copy-actions").children(
    h.button
      .attrs({
        "aria-label": prompt.label,
        class: primary ? "copy copy-primary" : "copy",
        "data-copied": String(copied),
        "data-text": prompt.text,
        hidden: model.clipboard === "available" ? undefined : "",
        type: "button",
      })
      .on("click", ReaderMessage.ClickedCopy({ id }))
      .children(
        icon(h, copied),
        h.span.class("copy-label").children(copied ? "Copied ✓" : prompt.label)
      ),
    h.span
      .attrs({ "aria-live": "polite", class: "copy-status", role: "status" })
      .children(statusText)
  );
};
