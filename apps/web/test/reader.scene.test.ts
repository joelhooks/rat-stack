import { it } from "@effect/vitest";
import {
  Command,
  Subscription,
  click,
  expect,
  given,
  role,
  scene,
  text,
} from "foldkit/scene";

import { ReaderBlock } from "../src/client/reader-document.js";
import {
  CopyReaderText,
  WaitBeforeCopyReset,
} from "../src/client/reader/command.js";
import { Message } from "../src/client/reader/message.js";
import { ClipboardAccess } from "../src/client/reader/model.js";
import { update } from "../src/client/reader/update.js";
import { view } from "../src/features/reader.js";
import { promptFixture, readerModelFixture } from "./reader-fixture.js";

const { id, label, text: promptText } = promptFixture;

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
    Command.expectExact(CopyReaderText({ id, text: promptText })),
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
    Command.expectExact(CopyReaderText({ id, text: promptText })),
    expect(role("status")).toHaveText(""),
    Command.resolve(CopyReaderText, Message.SucceededCopyReaderText({ id })),
    Command.resolve(
      WaitBeforeCopyReset,
      Message.CompletedWaitBeforeCopyReset({ id })
    )
  );
});

it("a page whose built references are missing still renders and names each gap", () => {
  scene(
    { update, view },
    given({
      ...clipboardReady,
      blocks: [
        ReaderBlock.CopyPrompt({ id: "retired-prompt" }),
        ReaderBlock.CodeFence({ language: "ts", meta: "", value: "gone" }),
        ReaderBlock.Snippet({
          at: "0".repeat(40),
          lines: "1-3",
          path: "apps/web/src/gone.ts",
          repo: "rat-stack",
        }),
      ],
    }),
    expect(role("heading", { name: "Rat Stack" })).toExist(),
    expect(text("The retired-prompt prompt is not in this page.")).toExist(),
    expect(text("This code block is not in the built page.")).toExist(),
    expect(
      text(
        "The excerpt apps/web/src/gone.ts lines 1-3 is not in the built page."
      )
    ).toExist()
  );
});
