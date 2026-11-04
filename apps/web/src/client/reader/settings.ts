import { Schema } from "effect";

export const ReaderSettings = Schema.Struct({
  accent: Schema.Literals(["pink", "blue", "ink"]),
  measure: Schema.Literals(["60", "68", "80"]),
  prose: Schema.Literals(["sans", "mono", "serif"]),
  size: Schema.Literals(["s", "m", "l"]),
  theme: Schema.Literals(["system", "light", "dark"]),
});

export type ReaderSettingsValue = typeof ReaderSettings.Type;

export type ReaderSettingKey = keyof ReaderSettingsValue;

export const defaultReaderSettings: ReaderSettingsValue = {
  accent: "pink",
  measure: "68",
  prose: "sans",
  size: "m",
  theme: "system",
};

export interface ReaderSettingControl<Key extends ReaderSettingKey> {
  readonly key: Key;
  readonly label: string;
  readonly options: readonly (readonly [ReaderSettingsValue[Key], string])[];
}

export const readerSettingControls = [
  {
    key: "theme",
    label: "Theme",
    options: [
      ["system", "System"],
      ["light", "Light"],
      ["dark", "Dark"],
    ],
  },
  {
    key: "prose",
    label: "Prose",
    options: [
      ["sans", "Sans"],
      ["mono", "Mono"],
      ["serif", "Serif"],
    ],
  },
  {
    key: "size",
    label: "Size",
    options: [
      ["s", "S"],
      ["m", "M"],
      ["l", "L"],
    ],
  },
  {
    key: "measure",
    label: "Measure",
    options: [
      ["60", "60ch"],
      ["68", "68ch"],
      ["80", "80ch"],
    ],
  },
  {
    key: "accent",
    label: "Accent",
    options: [
      ["pink", "Rat pink"],
      ["blue", "Link blue"],
      ["ink", "Ink"],
    ],
  },
] as const satisfies readonly ReaderSettingControl<ReaderSettingKey>[];
