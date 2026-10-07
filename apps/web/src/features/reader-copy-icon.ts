import type { HtmlBuilder } from "foldkit/html";

export const readerCopyIcon = <Message>(
  h: HtmlBuilder<Message>,
  copied: boolean
) =>
  h.svg(
    [
      h.Class(copied ? "icon icon-done" : "icon"),
      h.Width("16"),
      h.Height("16"),
      h.ViewBox("0 0 24 24"),
      h.Fill("none"),
      h.Stroke("currentColor"),
      h.StrokeWidth(copied ? "1.5" : "2"),
      h.StrokeLinecap("round"),
      h.StrokeLinejoin("round"),
      h.AriaHidden(true),
      h.Attribute("focusable", "false"),
    ],
    copied
      ? [h.path([h.D("M5 14L8.5 17.5L19 6.5")])]
      : [
          h.path([h.D("M12 8V4H8")]),
          h.rect([
            h.Width("16"),
            h.Height("12"),
            h.X("4"),
            h.Y("8"),
            h.Rx("2"),
          ]),
          h.path([h.D("M2 14h2m16 0h2m-7-1v2m-6-2v2")]),
        ]
  );
