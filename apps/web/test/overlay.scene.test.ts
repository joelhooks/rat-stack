import { it } from "@effect/vitest";
import {
  Command,
  click,
  expect,
  given,
  role,
  scene,
  text,
  type,
} from "foldkit/scene";

import { Inspect } from "../src/dev/client/devtools.js";
import { Message } from "../src/dev/client/message.js";
import { Model } from "../src/dev/client/model.js";
import { init, update, view } from "../src/dev/features/overlay/overlay.js";

it("the overlay opens, announces a failed inspection, retries, and closes", () => {
  scene(
    { update, view },
    given(init().model),
    click(role("button", { name: "Rat devtools (⌘K)" })),
    expect(text("Loading…")).toExist(),
    Command.resolve(
      Inspect,
      Message.Failed({ generation: 1, message: "Inspection failed" })
    ),
    expect(role("alert")).toHaveText("Inspection failed"),
    click(role("button", { name: "Refresh" })),
    expect(role("alert")).toBeAbsent(),
    expect(text("Loading…")).toExist(),
    Command.resolve(
      Inspect,
      Message.Loaded({ generation: 2, value: "Inspection complete" })
    ),
    expect(text('"Inspection complete"')).toExist(),
    expect(text("Loading…")).toBeAbsent(),
    click(role("button", { name: "Close" })),
    expect(role("region", { name: "Rat devtools" })).toBeAbsent(),
    Command.expectNone()
  );
});

it("the accessible capability input and JSON textarea supply the submitted inspection", () => {
  const initial = Model.make({ ...init().model, open: true, tab: "contracts" });

  const submitted = {
    ...initial,
    capability: "read",
    generation: 1,
    input: '{"id":"vision"}',
    pending: true,
  };

  scene(
    { update, view },
    given(initial),
    type(role("textbox", { name: "Capability name" }), "read"),
    type(role("textbox", { name: "Input as JSON" }), '{"id":"vision"}'),
    click(role("button", { name: "Run read" })),
    Command.expectExact(Inspect({ ...submitted, operation: "run" })),
    Command.resolve(
      Inspect,
      Message.Loaded({ generation: 1, value: "Document result" })
    ),
    expect(text('"Document result"')).toExist(),
    Command.expectNone()
  );
});
