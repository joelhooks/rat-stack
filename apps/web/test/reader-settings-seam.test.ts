import { expect, it } from "@effect/vitest";

import {
  readerSettingsKeys,
  readerSettingsStorageKey as headScriptStorageKey,
} from "../../site/src/reader-settings-script.js";
import {
  readerSettingKeys,
  readerSettingsStorageKey,
} from "../src/client/reader/settings.js";

it("the head script reads the same storage key and settings the client writes", () => {
  expect(headScriptStorageKey).toBe(readerSettingsStorageKey);
  expect(readerSettingsKeys.toSorted()).toStrictEqual(
    readerSettingKeys.toSorted()
  );
});
