import { Button } from "@foldkit/ui";
import type { Html, HtmlBuilder } from "foldkit/html";

import { readerSettingControls } from "../client/reader/settings.js";
import type {
  ReaderSettingKey,
  ReaderSettingsValue,
} from "../client/reader/settings.js";

export type SettingsControl<Message> =
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "available";
      readonly onChoose: (settings: ReaderSettingsValue) => Message;
      readonly onToggle: Message;
      readonly open: boolean;
      readonly settings: ReaderSettingsValue;
    };

const settingsIcon = <Message>(h: HtmlBuilder<Message>) =>
  h.svg(
    [
      h.ViewBox("0 0 16 16"),
      h.Width("16"),
      h.Height("16"),
      h.AriaHidden(true),
      h.Attribute("focusable", "false"),
    ],
    [
      h.path([
        h.D("M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7"),
        h.Stroke("currentColor"),
        h.StrokeWidth("1.4"),
        h.StrokeLinecap("round"),
      ]),
      h.circle([
        h.Cx("10.5"),
        h.Cy("4.5"),
        h.R("1.6"),
        h.Fill("none"),
        h.Stroke("currentColor"),
        h.StrokeWidth("1.4"),
      ]),
      h.circle([
        h.Cx("5.5"),
        h.Cy("11.5"),
        h.R("1.6"),
        h.Fill("none"),
        h.Stroke("currentColor"),
        h.StrokeWidth("1.4"),
      ]),
    ]
  );

const segment = <Message, Key extends ReaderSettingKey>(
  h: HtmlBuilder<Message>,
  control: {
    readonly key: Key;
    readonly label: string;
    readonly options: readonly (readonly [ReaderSettingsValue[Key], string])[];
  },
  settings: ReaderSettingsValue,
  onChoose: (settings: ReaderSettingsValue) => Message
): Html =>
  h.div(
    [h.Class("setting")],
    [
      h.span(
        [h.Class("setting-label"), h.Id(`setting-${control.key}`)],
        [control.label]
      ),
      h.div(
        [
          h.Class("segmented"),
          h.Role("group"),
          h.AriaLabelledBy(`setting-${control.key}`),
        ],
        control.options.map(([value, label]) =>
          Button.view(
            {
              onClick: onChoose({ ...settings, [control.key]: value }),
              toView: ({ button }) =>
                h.button(
                  [
                    ...button,
                    h.AriaPressed(String(settings[control.key] === value)),
                  ],
                  [label]
                ),
            },
            h
          )
        )
      ),
    ]
  );

export const readerSettingsView = <Message>(
  h: HtmlBuilder<Message>,
  control: SettingsControl<Message>
): readonly Html[] =>
  control.kind === "unavailable"
    ? []
    : [
        h.div(
          [h.Class("reader-settings")],
          [
            Button.view(
              {
                onClick: control.onToggle,
                toView: ({ button }) =>
                  h.button(
                    [
                      ...button,
                      h.Class("settings-button"),
                      h.AriaLabel("Reader settings"),
                      h.AriaExpanded(control.open),
                      h.AriaControls("reader-settings"),
                    ],
                    [settingsIcon(h)]
                  ),
              },
              h
            ),
            h.div(
              [
                h.Id("reader-settings"),
                h.Class("settings-panel"),
                h.Role("group"),
                h.AriaLabel("Reader settings"),
                h.Hidden(!control.open),
              ],
              readerSettingControls.map((setting) =>
                segment(h, setting, control.settings, control.onChoose)
              )
            ),
          ]
        ),
      ];
