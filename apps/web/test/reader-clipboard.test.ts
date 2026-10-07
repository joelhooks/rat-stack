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
import { ReaderMessage } from "../src/client/reader-message.js";
import { ReaderFlags, readerInit } from "../src/client/reader-model.js";
import type { ReaderPageFlags } from "../src/client/reader-model.js";
import { readerUpdate } from "../src/client/reader-update.js";

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
    return "copying";
  }

  if (copied.has(id)) {
    return "copied";
  }

  if (failed.has(id)) {
    return "failed";
  }

  return "idle";
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
        let available = false;
        let { model } = readerInit(flags);

        for (const step of history) {
          const id =
            flags.copyPrompts[step.target]?.id ?? `unknown-${step.target}`;

          const messages = {
            expire: ReaderMessage.CopyStatusExpired({ id }),
            fail: ReaderMessage.CopyFailed({ id }),
            ready: ReaderMessage.ClipboardReady({ available: true }),
            request: ReaderMessage.CopyRequested({ id }),
            succeed: ReaderMessage.CopySucceeded({ id }),
            unavailable: ReaderMessage.ClipboardReady({ available: false }),
          };

          switch (step.action) {
            case "ready": {
              available = true;
              break;
            }

            case "unavailable": {
              available = false;
              break;
            }

            case "request": {
              if (
                known.has(id) &&
                available &&
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

          ({ model } = readerUpdate(model, messages[step.action]));
          expect(model.clipboardReady).toBe(available);
          expect(
            Object.keys(model.copyStates).every((key) => known.has(key))
          ).toBe(true);
          expect(model.blocks).toBe(flags.blocks);
          expect(model.copyPrompts).toBe(flags.copyPrompts);

          for (const prompt of flags.copyPrompts) {
            const observed = model.copyStates[prompt.id] ?? "idle";
            expect(observed).toBe(
              expectedCopyStatus(prompt.id, pending, copied, failed)
            );
          }
        }
      }),
    { arbitrary: { runs: 100 } }
  );
});
