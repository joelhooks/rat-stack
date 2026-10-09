import { expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import * as Scene from "foldkit/scene";
import * as Story from "foldkit/story";

import { Inspect } from "../src/dev/client/devtools.js";
import { Message } from "../src/dev/client/message.js";
import { Model } from "../src/dev/client/model.js";
import { init, update, view } from "../src/dev/features/overlay/overlay.js";

const fixture = init().model;

it("opens the server call log and renders recorded calls", () => {
  Scene.scene(
    { update, view },
    Scene.given(fixture),
    Scene.click(Scene.role("button", { name: "Rat devtools (⌘K)" })),
    Scene.Command.resolve(
      Inspect,
      Message.Loaded({
        generation: 1,
        value: {
          entries: [
            {
              as: null,
              capability: "search",
              durationMs: 2,
              index: 0,
              outcome: Schema.TaggedStruct("Succeeded", {}).make({}),
            },
          ],
          firstIndex: 0,
          matched: 1,
          nextIndex: 1,
        },
      })
    ),
    Scene.expect(Scene.role("region", { name: "Rat devtools" })).toExist(),
    Scene.expect(Scene.text("search")).toExist(),
    Scene.expect(Scene.role("button", { name: "Read call" })).toExist(),
    Scene.expect(Scene.role("button", { name: "Replay and diff" })).toExist(),
    Scene.expect(Scene.role("button", { name: "Diff calls" })).toExist()
  );
});

it("signing in selects a person that survives tab changes and closing the inspector", () => {
  Story.story(
    update,
    Story.given({ ...fixture, open: true }),
    Story.message(Message.SelectedTab({ tab: "session" })),
    Story.message(Message.SignedIn()),
    Story.Command.resolve(
      Inspect,
      Message.CreatedPerson({ generation: 1, personId: "person-ada" })
    ),
    Story.message(Message.SelectedTab({ tab: "contracts" })),
    Story.Command.resolve(
      Inspect,
      Message.Loaded({ generation: 2, value: [] })
    ),
    Story.message(Message.Closed()),
    Story.message(Message.Toggled()),
    Story.Command.resolve(
      Inspect,
      Message.Loaded({ generation: 3, value: [] })
    ),
    Story.message(Message.ChangedInput({ value: '{"query":"capability"}' })),
    Story.message(Message.Submitted()),
    (
      simulation: Story.StorySimulation<typeof Model.Type, typeof Message.Type>
    ) => {
      expect(simulation.commands).toHaveLength(1);
      expect(simulation.commands[0]?.name).toBe("Inspect");
      expect(simulation.commands[0]?.args).toMatchObject({
        capability: "search",
        input: '{"query":"capability"}',
        operation: "run",
        person: Option.some("person-ada"),
      });

      return simulation;
    },
    Story.Command.resolve(
      Inspect,
      Message.Loaded({ generation: 4, value: [] })
    ),
    Story.model((model) => {
      expect(model.person).toStrictEqual(Option.some("person-ada"));
    })
  );
});

it.prop(
  "stale inspector results cannot replace a newer panel",
  {
    generation: Arbitrary.schema(Schema.Int),
    value: Arbitrary.schema(Schema.Json),
  },
  ({ generation, value }) => {
    const model = { ...fixture, generation };
    expect(
      update(model, Message.Loaded({ generation: generation - 1, value })).model
    ).toBe(model);
    expect(
      update(
        model,
        Message.CreatedPerson({ generation: generation - 1, personId: "stale" })
      ).model
    ).toBe(model);
  }
);

it.prop(
  "generated inspector histories preserve the Model schema",
  {
    messages: Arbitrary.schema(Schema.Array(Message)),
  },
  ({ messages }) => {
    let model = fixture;

    for (const message of messages) {
      ({ model } = update(model, message));
    }

    expect(Schema.is(Model)(model)).toBe(true);
  }
);
