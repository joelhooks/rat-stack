import { Effect, Option, Schema } from "effect";
import { Command } from "foldkit";

import {
  readerSettingsKeys,
  readerSettingsStorageKey,
} from "../../../../site/src/reader-settings-script.js";
import { Message } from "./message.js";
import { defaultReaderSettings, ReaderSettings } from "./settings.js";
import type { ReaderSettingKey, ReaderSettingsValue } from "./settings.js";

class SettingsStorageFailure extends Schema.TaggedError<
  SettingsStorageFailure,
  { readonly brand: unique symbol }
>()("SettingsStorageFailure", { cause: Schema.Unknown }) {}

const readerRoot = () => document.documentElement;

const fromRoot = <Key extends ReaderSettingKey>(
  key: Key,
  field: Schema.Codec<ReaderSettingsValue[Key]>
) =>
  Schema.decodeUnknownOption(field)(
    readerRoot().getAttribute(`data-${key}`)
  ).pipe(Option.getOrElse(() => defaultReaderSettings[key]));

export const LoadSettings = Command.define("LoadSettings", {
  execute: Effect.sync(() =>
    Message.LoadedSettings({
      settings: {
        accent: fromRoot("accent", ReaderSettings.fields.accent),
        measure: fromRoot("measure", ReaderSettings.fields.measure),
        prose: fromRoot("prose", ReaderSettings.fields.prose),
        size: fromRoot("size", ReaderSettings.fields.size),
        theme: fromRoot("theme", ReaderSettings.fields.theme),
      },
    })
  ),
  messages: [Message.LoadedSettings],
});

export const SaveSettings = Command.define("SaveSettings", {
  args: { settings: ReaderSettings },
  execute: ({ settings }) =>
    Effect.sync(() => {
      for (const key of readerSettingsKeys) {
        readerRoot().setAttribute(`data-${key}`, settings[key]);
      }
    }).pipe(
      Effect.andThen(
        Effect.try({
          catch: (cause) => new SettingsStorageFailure({ cause }),
          try: () => {
            localStorage.setItem(
              readerSettingsStorageKey,
              JSON.stringify(settings)
            );
          },
        })
      ),
      Effect.ignore,
      Effect.as(Message.CompletedSaveSettings())
    ),
  messages: [Message.CompletedSaveSettings],
});
