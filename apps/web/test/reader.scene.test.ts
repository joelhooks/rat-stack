import { it } from "@effect/vitest";
import {
  Command,
  Subscription,
  click,
  expect,
  given,
  role,
  scene,
} from "foldkit/scene";

import {
  CopyReaderText,
  WaitBeforeCopyReset,
} from "../src/client/reader/command.js";
import { Message } from "../src/client/reader/message.js";
import { ClipboardAccess } from "../src/client/reader/model.js";
import { update } from "../src/client/reader/update.js";
import { view } from "../src/features/reader.js";
import { promptFixture, readerModelFixture } from "./reader-fixture.js";

const { id, label, text } = promptFixture;

const clipboardReady = {
  ...readerModelFixture,
  clipboardAccess: ClipboardAccess.Available(),
};

const copyButton = role("button", { name: label });

it("the copy button stays hidden until the clipboard is detected", () => {
  scene(
    { update, view },
    given(readerModelFixture),
    expect(copyButton).not.toBeVisible(),
    Subscription.emit(
      Message.CompletedDetectClipboard({
        access: ClipboardAccess.Unavailable(),
      })
    ),
    expect(copyButton).not.toBeVisible(),
    Subscription.emit(
      Message.CompletedDetectClipboard({ access: ClipboardAccess.Available() })
    ),
    expect(copyButton).toBeVisible()
  );
});

it("a copy confirms with text the reader can see and hear, then resets after the wait", () => {
  scene(
    { update, view },
    given(clipboardReady),
    click(copyButton),
    Command.expectExact(CopyReaderText({ id, text })),
    Command.resolve(CopyReaderText, Message.SucceededCopyReaderText({ id })),
    expect(role("status")).toHaveText("Copied ✓"),
    expect(copyButton).toContainText("Copied ✓"),
    Command.expectExact(WaitBeforeCopyReset({ id })),
    Command.resolve(
      WaitBeforeCopyReset,
      Message.CompletedWaitBeforeCopyReset({ id })
    ),
    expect(role("status")).toHaveText(""),
    expect(copyButton).toContainText(label),
    Command.expectNone()
  );
});

it("a failed copy tells the reader to copy by hand and allows a retry", () => {
  scene(
    { update, view },
    given(clipboardReady),
    click(copyButton),
    Command.resolve(CopyReaderText, Message.FailedCopyReaderText({ id })),
    expect(role("status")).toHaveText(
      "Copy failed. Select the text and copy it."
    ),
    Command.expectNone(),
    click(copyButton),
    Command.expectExact(CopyReaderText({ id, text })),
    expect(role("status")).toHaveText(""),
    Command.resolve(CopyReaderText, Message.SucceededCopyReaderText({ id })),
    Command.resolve(
      WaitBeforeCopyReset,
      Message.CompletedWaitBeforeCopyReset({ id })
    )
  );
});
