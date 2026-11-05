import { it } from "@effect/vitest";
import { Option } from "effect";
import {
  Command,
  Subscription,
  expect,
  given,
  role,
  scene,
} from "foldkit/scene";

import { ReaderNode } from "../src/client/reader-node.js";
import { Message } from "../src/client/reader/message.js";
import { ReadPeek, WaitBeforePeek } from "../src/client/reader/peek-command.js";
import { PeekCard } from "../src/client/reader/peek.js";
import { update } from "../src/client/reader/update.js";
import { readerPeekId } from "../src/features/reader-node.js";
import { view } from "../src/features/reader.js";
import { readerModelFixture } from "./reader-fixture.js";

const anchor = {
  above: false,
  inbound: Option.some(46),
  label: "The fence",
  left: 120,
  top: 300,
};

const card = role("tooltip", { name: /Fence/u });

const fenceLink = role("link", { name: "the fence" });

it("hovering an internal link fetches the page and shows a card after the delay", () => {
  scene(
    { update, view },
    given(readerModelFixture),
    Subscription.emit(
      Message.PointedAtLink({ anchor, route: "/systems/fence" })
    ),
    Command.expectHas(WaitBeforePeek({ route: "/systems/fence" })),
    Command.expectHas(ReadPeek({ route: "/systems/fence" })),
    Command.resolve(
      ReadPeek,
      Message.SucceededReadPeek({
        route: "/systems/fence",
        summary: "Compiler checks, lint rules, and hooks.",
        title: "Fence",
      })
    ),
    expect(card).not.toExist(),
    Command.resolve(
      WaitBeforePeek,
      Message.ElapsedPeekWait({ route: "/systems/fence" })
    ),
    expect(card).toHaveText(
      "systems · /systems/fence Fence Compiler checks, lint rules, and hooks. ← 46 pages link here"
    ),
    Subscription.emit(Message.LeftLink()),
    expect(card).not.toExist()
  );
});

it("focusing a link whose page is cached shows its card at once without a fetch", () => {
  scene(
    { update, view },
    given({
      ...readerModelFixture,
      bodyNodes: Option.some([
        ReaderNode.Element({
          attributes: [{ name: "href", value: "/systems/fence" }],
          children: [ReaderNode.Text({ value: "the fence" })],
          tag: "a",
        }),
      ]),
      peekCards: {
        "/systems/fence": PeekCard.Loaded({
          summary: "Compiler checks.",
          title: "Fence",
        }),
      },
    }),
    Subscription.emit(Message.FocusedLink({ anchor, route: "/systems/fence" })),
    Command.expectNone(),
    expect(card).toExist(),
    expect(fenceLink).toHaveAttr("aria-describedby", readerPeekId),
    Subscription.emit(Message.PressedEscape()),
    expect(card).not.toExist(),
    expect(fenceLink).not.toHaveAttr("aria-describedby")
  );
});

it("a failed read leaves no card behind, so the next hover asks again", () => {
  scene(
    { update, view },
    given(readerModelFixture),
    Subscription.emit(
      Message.PointedAtLink({ anchor, route: "/systems/fence" })
    ),
    Command.resolve(
      ReadPeek,
      Message.FailedReadPeek({ route: "/systems/fence" })
    ),
    Command.resolve(
      WaitBeforePeek,
      Message.ElapsedPeekWait({ route: "/systems/fence" })
    ),
    expect(card).not.toExist(),
    Subscription.emit(Message.LeftLink()),
    Subscription.emit(
      Message.PointedAtLink({ anchor, route: "/systems/fence" })
    ),
    Command.expectHas(ReadPeek({ route: "/systems/fence" })),
    Command.resolve(
      ReadPeek,
      Message.FailedReadPeek({ route: "/systems/fence" })
    ),
    Command.resolve(
      WaitBeforePeek,
      Message.ElapsedPeekWait({ route: "/systems/fence" })
    )
  );
});
