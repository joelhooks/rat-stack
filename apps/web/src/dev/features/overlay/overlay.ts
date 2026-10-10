import { Button, Input, Textarea } from "@foldkit/ui";
import {
  ratListActors,
  ratListCalls,
  ratListContracts,
} from "@rat-stack/devtools/contracts";
import * as stylex from "@stylexjs/stylex";
import { Match, Option, Schema } from "effect";
import type { Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import { styles } from "../../../features/chrome.stylex.js";
import { Inspect } from "../../client/devtools.js";
import { Message } from "../../client/message.js";
import type { InspectorMessage } from "../../client/message.js";
import { Model } from "../../client/model.js";
import type { InspectorModel } from "../../client/model.js";

export const init = () => ({
  model: Model.make({
    capability: "search",
    error: "",
    from: "0",
    generation: 0,
    input: "{}",
    open: false,
    pending: false,
    person: Option.none(),
    personName: "ada",
    tab: "calls",
    to: "1",
    value: null,
  }),
});

const request = (
  model: InspectorModel,
  operation: Parameters<typeof Inspect>[0]["operation"]
): Update.Return<InspectorModel, InspectorMessage> => {
  const next = {
    ...model,
    error: "",
    generation: model.generation + 1,
    pending: true,
  };

  return { commands: [Inspect({ ...next, operation })], model: next };
};

const refresh = (
  model: InspectorModel
): Update.Return<InspectorModel, InspectorMessage> =>
  model.tab === "session" ? { model } : request(model, model.tab);

export const update = (
  model: InspectorModel,
  message: InspectorMessage
): Update.Return<InspectorModel, InspectorMessage> =>
  Message.match<Update.Return<InspectorModel, InspectorMessage>>(message, {
    ChangedCapability: ({ value }) => ({
      model: { ...model, capability: value },
    }),
    ChangedFrom: ({ value }) => ({ model: { ...model, from: value } }),
    ChangedInput: ({ value }) => ({ model: { ...model, input: value } }),
    ChangedPersonName: ({ value }) => ({
      model: { ...model, personName: value },
    }),
    ChangedTo: ({ value }) => ({ model: { ...model, to: value } }),
    Closed: () => ({ model: { ...model, open: false } }),
    Compared: () => request(model, "diff"),
    CreatedPerson: ({ generation, personId }) => ({
      model:
        generation === model.generation
          ? { ...model, pending: false, person: Option.some(personId) }
          : model,
    }),
    Described: () => request(model, "describe"),
    Failed: ({ generation, message: error }) => ({
      model:
        generation === model.generation
          ? { ...model, error, pending: false }
          : model,
    }),
    Loaded: ({ generation, value }) => ({
      model:
        generation === model.generation
          ? { ...model, pending: false, value }
          : model,
    }),
    ReadRecorded: () => request(model, "get"),
    Refreshed: () => refresh(model),
    Replayed: () => request(model, "replay"),
    SelectedContract: ({ name }) =>
      request({ ...model, capability: name }, "describe"),
    SelectedTab: ({ tab }) => refresh({ ...model, tab, value: null }),
    SignedIn: () => request(model, "person"),
    Submitted: () => request(model, "run"),
    Toggled: () =>
      model.open
        ? { model: { ...model, open: false } }
        : refresh({ ...model, open: true }),
    UsedDefaultPerson: () => ({ model: { ...model, person: Option.none() } }),
  });

const CallRow = Schema.Struct({
  as: Schema.Json,
  capability: Schema.String,
  durationMs: Schema.Int,
  index: Schema.Int,
  outcome: Schema.Struct({ _tag: Schema.String }),
});

const panelValue = (
  model: InspectorModel,
  h: HtmlBuilder<InspectorMessage>
): Html => {
  if (Schema.is(ratListCalls.output)(model.value)) {
    const rows = model.value.entries
      .toReversed()
      .flatMap((entry) => (Schema.is(CallRow)(entry) ? [entry] : []));

    return h.table(
      [h.AriaBusy(model.pending)],
      [
        h.caption([], ["Recent server calls"]),
        h.thead(
          [],
          [
            h.tr(
              [],
              ["#", "Capability", "Outcome", "ms", "Identity"].map((label) =>
                h.th([h.Scope("col")], [label])
              )
            ),
          ]
        ),
        h.tbody(
          [],
          rows.map((row) =>
            h.tr(
              [h.Key(String(row.index))],
              [
                h.td(
                  [],
                  [
                    Button.view(
                      {
                        onClick: Message.ChangedFrom({
                          value: String(row.index),
                        }),
                        toView: ({ button }) =>
                          h.button(
                            [
                              ...button,
                              h.Class(
                                stylex.props(styles.focus).className ?? ""
                              ),
                              h.AriaLabel(`Select call ${row.index}`),
                            ],
                            [String(row.index)]
                          ),
                      },
                      h
                    ),
                  ]
                ),
                h.td([], [row.capability]),
                h.td([], [row.outcome._tag]),
                h.td([], [String(row.durationMs)]),
                h.td([], [row.as === null ? "" : JSON.stringify(row.as)]),
              ]
            )
          )
        ),
      ]
    );
  }

  if (Schema.is(ratListContracts.output)(model.value)) {
    return h.div(
      [],
      model.value.contracts.map((contract) =>
        Button.view(
          {
            onClick: Message.SelectedContract({ name: contract.name }),
            toView: ({ button }) =>
              h.button(
                [
                  ...button,
                  h.Key(contract.name),
                  h.Class(stylex.props(styles.focus).className ?? ""),
                  h.Title(contract.description),
                ],
                [contract.name]
              ),
          },
          h
        )
      )
    );
  }

  if (Schema.is(ratListActors.output)(model.value)) {
    return h.table(
      [],
      [
        h.caption([], ["Server machine actors"]),
        h.thead(
          [],
          [
            h.tr(
              [],
              ["Machine", "State", "Status", "Transitions"].map((label) =>
                h.th([h.Scope("col")], [label])
              )
            ),
          ]
        ),
        h.tbody(
          [],
          model.value.actors.map((actor) =>
            h.tr(
              [h.Key(actor.actorId)],
              [
                h.td([], [actor.machine]),
                h.td([], [JSON.stringify(actor.state)]),
                h.td([], [actor.status]),
                h.td([], [String(actor.transitions)]),
              ]
            )
          )
        ),
      ]
    );
  }

  return h.pre([], [JSON.stringify(model.value, null, 2)]);
};

export const view = (
  model: InspectorModel,
  h: HtmlBuilder<InspectorMessage>
): Html => {
  const actionButton = (name: string, message: InspectorMessage) =>
    Button.view(
      {
        onClick: message,
        toView: ({ button }) =>
          h.button(
            [...button, h.Class(stylex.props(styles.focus).className ?? "")],
            [name]
          ),
      },
      h
    );

  const fields = Match.value(model.tab).pipe(
    Match.when("contracts", () => [
      Input.view(
        {
          id: "rat-capability",
          onInput: (value) => Message.ChangedCapability({ value }),
          toView: ({ input }) =>
            h.input([...input, h.AriaLabel("Capability name")]),
          value: model.capability,
        },
        h
      ),
      actionButton("Describe", Message.Described()),
      Textarea.view(
        {
          id: "rat-input",
          onInput: (value) => Message.ChangedInput({ value }),
          toView: ({ textarea }) =>
            h.textarea([...textarea, h.AriaLabel("Input as JSON")]),
          value: model.input,
        },
        h
      ),
      actionButton(`Run ${model.capability}`, Message.Submitted()),
    ]),
    Match.when("calls", () => [
      Input.view(
        {
          id: "rat-recorded-call",
          onInput: (value) => Message.ChangedFrom({ value }),
          toView: ({ input }) =>
            h.input([...input, h.AriaLabel("Recorded call index")]),
          value: model.from,
        },
        h
      ),
      actionButton("Read call", Message.ReadRecorded()),
      actionButton("Replay and diff", Message.Replayed()),
      Input.view(
        {
          id: "rat-comparison-call",
          onInput: (value) => Message.ChangedTo({ value }),
          toView: ({ input }) =>
            h.input([...input, h.AriaLabel("Comparison call index")]),
          value: model.to,
        },
        h
      ),
      actionButton("Diff calls", Message.Compared()),
    ]),
    Match.when("session", () => [
      Input.view(
        {
          id: "rat-person-name",
          onInput: (value) => Message.ChangedPersonName({ value }),
          toView: ({ input }) =>
            h.input([...input, h.AriaLabel("Test person name")]),
          value: model.personName,
        },
        h
      ),
      actionButton(`Sign in ${model.personName}@rat.test`, Message.SignedIn()),
      h.p(
        [],
        [
          Option.match(model.person, {
            onNone: () => "Contracts run as the dev server's default person.",
            onSome: (person) => `Contracts run as ${person}.`,
          }),
        ]
      ),
      actionButton("Use the default person", Message.UsedDefaultPerson()),
    ]),
    Match.when("machines", () => []),
    Match.exhaustive
  );

  return h.div(
    [],
    [
      Button.view(
        {
          onClick: Message.Toggled(),
          toView: ({ button }) =>
            h.button(
              [
                ...button,
                h.AriaLabel("Rat devtools (⌘K)"),
                h.AriaExpanded(model.open),
                h.Class(
                  `rat-trigger ${stylex.props(styles.focus).className ?? ""}`
                ),
              ],
              ["🐀"]
            ),
        },
        h
      ),
      ...(model.open
        ? [
            h.section(
              [h.AriaLabel("Rat devtools"), h.Class("rat-panel")],
              [
                h.header(
                  [],
                  [
                    h.nav(
                      [],
                      ["calls", "contracts", "machines", "session"].flatMap(
                        (name) =>
                          Schema.is(Model.fields.tab)(name)
                            ? [
                                Button.view(
                                  {
                                    onClick: Message.SelectedTab({ tab: name }),
                                    toView: ({ button }) =>
                                      h.button(
                                        [
                                          ...button,
                                          h.AriaPressed(
                                            model.tab === name
                                              ? "true"
                                              : "false"
                                          ),
                                        ],
                                        [name]
                                      ),
                                  },
                                  h
                                ),
                              ]
                            : []
                      )
                    ),
                    actionButton("Close", Message.Closed()),
                  ]
                ),
                h.div(
                  [h.Class("rat-body")],
                  [
                    actionButton("Refresh", Message.Refreshed()),
                    ...fields,
                    ...(model.pending
                      ? [h.p([h.Role("status")], ["Loading…"])]
                      : []),
                    ...(model.error.length > 0
                      ? [h.p([h.Role("alert")], [model.error])]
                      : []),
                    panelValue(model, h),
                  ]
                ),
              ]
            ),
          ]
        : []),
    ]
  );
};
