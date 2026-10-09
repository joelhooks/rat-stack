import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import {
  Arbitrary,
  ConfigProvider,
  Context,
  Effect,
  FileSystem,
  Layer,
  Schema,
} from "effect";

import { prepareReader } from "../scripts/reader-build.ts";
import { init } from "../src/client/reader/init.js";
import { Message } from "../src/client/reader/message.js";
import {
  ClipboardAccess,
  copyStatusOf,
  ReaderFlags,
} from "../src/client/reader/model.js";
import type { ReaderPageFlags } from "../src/client/reader/model.js";
import { update } from "../src/client/reader/update.js";

class ClipboardPage extends Context.Service<
  ClipboardPage,
  { readonly flags: ReaderPageFlags }
>()("test/ClipboardPage") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* prepareClipboardPage() {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped();

      yield* prepareReader(root).pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({})
        )
      );

      const pages = yield* Schema.decodeEffect(
        Schema.fromJsonString(Schema.Array(ReaderFlags))
      )(yield* fs.readFileString(`${root}/dist/reader-pages.json`));

      const flags = pages.find((page) => page.page.path === "/");

      if (flags === undefined || flags.copyPrompts.length === 0) {
        return yield* Effect.die(
          new Error("Prepared home has no copy prompts")
        );
      }

      return { flags };
    })
  ).pipe(Layer.provideMerge(NodeServices.layer));
}

const histories = Arbitrary.schema(
  Schema.Array(
    Schema.Struct({
      action: Schema.Literals([
        "ready",
        "unavailable",
        "request",
        "succeed",
        "fail",
        "expire",
      ]),
      target: Schema.Int.check(Schema.isBetween({ maximum: 8, minimum: 0 })),
    })
  ).check(Schema.isMaxLength(60))
);

const expectedCopyStatus = (
  id: string,
  pending: ReadonlySet<string>,
  copied: ReadonlySet<string>,
  failed: ReadonlySet<string>
) => {
  if (pending.has(id)) {
    return "Copying";
  }

  if (copied.has(id)) {
    return "Copied";
  }

  if (failed.has(id)) {
    return "Failed";
  }

  return "Idle";
};

it.layer(ClipboardPage.layer)((test) => {
  test.effect.prop(
    "clipboard work belongs to known prompts and only pending writes can complete",
    { history: histories },
    ({ history }) =>
      Effect.gen(function* clipboardHistory() {
        const { flags } = yield* ClipboardPage;
        const known = new Set(flags.copyPrompts.map((prompt) => prompt.id));
        const pending = new Set<string>();
        const copied = new Set<string>();
        const failed = new Set<string>();
        let access: (typeof ClipboardAccess.Type)["_tag"] = "Unknown";
        let { model } = init(flags);

        for (const step of history) {
          const id =
            flags.copyPrompts[step.target]?.id ?? `unknown-${step.target}`;

          const messages = {
            expire: Message.CompletedWaitBeforeCopyReset({ id }),
            fail: Message.FailedCopyReaderText({ id }),
            ready: Message.CompletedDetectClipboard({
              access: ClipboardAccess.Available(),
            }),
            request: Message.ClickedCopy({ id }),
            succeed: Message.SucceededCopyReaderText({ id }),
            unavailable: Message.CompletedDetectClipboard({
              access: ClipboardAccess.Unavailable(),
            }),
          };

          switch (step.action) {
            case "ready": {
              access = "Available";
              break;
            }

            case "unavailable": {
              access = "Unavailable";
              break;
            }

            case "request": {
              if (
                known.has(id) &&
                access === "Available" &&
                !pending.has(id) &&
                !copied.has(id)
              ) {
                pending.add(id);
                failed.delete(id);
              }

              break;
            }

            case "succeed": {
              if (pending.delete(id)) {
                copied.add(id);
              }

              break;
            }

            case "fail": {
              if (pending.delete(id)) {
                failed.add(id);
              }

              break;
            }

            case "expire": {
              copied.delete(id);
              break;
            }

            default: {
              const unexpected: never = step.action;
              throw new Error(
                `Unexpected clipboard action: ${String(unexpected)}`
              );
            }
          }

          ({ model } = update(model, messages[step.action]));
          expect(model.clipboardAccess._tag).toBe(access);
          expect(
            Object.keys(model.copyStatuses).every((key) => known.has(key))
          ).toBe(true);
          expect(model.blocks).toBe(flags.blocks);
          expect(model.copyPrompts).toBe(flags.copyPrompts);

          for (const prompt of flags.copyPrompts) {
            expect(copyStatusOf(model, prompt.id)._tag).toBe(
              expectedCopyStatus(prompt.id, pending, copied, failed)
            );
          }
        }
      }),
    { arbitrary: { runs: 100 } }
  );
});
