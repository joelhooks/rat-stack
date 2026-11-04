import { it } from "@effect/vitest";
import {
  Command,
  Subscription,
  click,
  expect,
  given,
  role,
  scene,
  within,
} from "foldkit/scene";

import { Message } from "../src/client/reader/message.js";
import { SettingsPanel } from "../src/client/reader/model.js";
import { SaveSettings } from "../src/client/reader/settings-command.js";
import { defaultReaderSettings } from "../src/client/reader/settings.js";
import { update } from "../src/client/reader/update.js";
import { view } from "../src/features/reader.js";
import { readerModelFixture } from "./reader-fixture.js";

const settingsButton = role("button", { name: "Reader settings" });

const settingsPanel = role("group", { name: "Reader settings" });

const themeGroup = within(settingsPanel, role("group", { name: "Theme" }));

const withSettings = {
  ...readerModelFixture,
  settingsPanel: SettingsPanel.Closed(),
};

it("the server render has no settings control, so the defaults apply without JS", () => {
  scene(
    { update, view },
    given(readerModelFixture),
    expect(settingsButton).not.toExist()
  );
});

it("choosing a setting marks it pressed and saves the whole set", () => {
  scene(
    { update, view },
    given(withSettings),
    expect(settingsPanel).not.toBeVisible(),
    click(settingsButton),
    expect(within(themeGroup, role("button", { name: "System" }))).toHaveAttr(
      "aria-pressed",
      "true"
    ),
    click(within(themeGroup, role("button", { name: "Dark" }))),
    Command.expectExact(
      SaveSettings({ settings: { ...defaultReaderSettings, theme: "dark" } })
    ),
    Command.resolve(SaveSettings, Message.CompletedSaveSettings()),
    expect(within(themeGroup, role("button", { name: "Dark" }))).toHaveAttr(
      "aria-pressed",
      "true"
    ),
    expect(within(themeGroup, role("button", { name: "System" }))).toHaveAttr(
      "aria-pressed",
      "false"
    ),
    Subscription.emit(Message.PressedEscape()),
    expect(settingsPanel).not.toBeVisible()
  );
});

it("settings already applied by the head script show as pressed once loaded", () => {
  scene(
    { update, view },
    given(withSettings),
    Subscription.emit(
      Message.LoadedSettings({
        settings: { ...defaultReaderSettings, measure: "80", prose: "mono" },
      })
    ),
    click(settingsButton),
    expect(
      within(
        within(settingsPanel, role("group", { name: "Measure" })),
        role("button", { name: "80ch" })
      )
    ).toHaveAttr("aria-pressed", "true"),
    expect(
      within(
        within(settingsPanel, role("group", { name: "Prose" })),
        role("button", { name: "Mono" })
      )
    ).toHaveAttr("aria-pressed", "true")
  );
});
