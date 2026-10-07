import { homedir } from "node:os";

import type { LearnContext, LearnEvent, Progress } from "@rat-stack/core/learn";
import {
  LearnerProgress,
  LearnerProgressError,
  LearnEventSchema,
  ConceptProgressRowSchema,
  LearnTaskSchema,
  emptyProgress,
} from "@rat-stack/core/learn";
import { Learner, LearnEventWriter, commitEvent } from "@rat-stack/learn";
import {
  Config,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
  Semaphore,
} from "effect";

const storeInstructions = `# Local learning progress\n\nOnly learn capabilities write this folder.\n\n- log.jsonl: append-only version 1 LearnEvent values. This is the source.\n- cards.jsonl: version 1 concept progress rows, rebuilt from the log.\n- tasks.jsonl: version 1 concept ids and depths, rebuilt from the log.\n- README.md: this description.\n\nNo code, file paths, names or prompts belong in these records.\nNew concepts get one walkthrough. Introduced concepts get a line, or a paragraph after seven days. Familiar concepts get a line after seven days. Fluent concepts stay silent unless asked, or after ninety days of inactivity. Dismissed concepts stay silent.\n\nlearnNext selects; only an explicit shown event records a presentation.\nDuplicate identical events are ignored. The log is validated before every operation. Derived files are replaced atomically and are never read as authority. A failed derived write is repaired on the next call.\n\nThe writer lock fails closed if another process owns it. After a crash, confirm that no learning process runs before removing writer.lock. Never truncate a malformed log: preserve it and recover the complete events separately.\n\nThe initial read budget is 16 MiB. It is a local safety limit, not a measured filesystem capacity. Archive support is required before that limit is reached.\n`;

const READ_BUDGET = 16 * 1024 * 1024;

export const localLearnerProgressLayer = Layer.effect(
  LearnerProgress,
  Effect.gen(function* makeLocalProgress() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const learner = yield* Learner;

    const directory = yield* Config.String("RAT_LEARN_DIRECTORY").pipe(
      Config.withDefault(path.join(homedir(), ".rat-learn"))
    );

    const semaphore = yield* Semaphore.make(1);
    const log = path.join(directory, "log.jsonl");
    const lock = path.join(directory, "writer.lock");

    const readEvents = Effect.gen(function* readEvents() {
      if (!(yield* fs.exists(log))) {
        return [];
      }

      const info = yield* fs.stat(log);

      if (info.size > BigInt(READ_BUDGET)) {
        return yield* new LearnerProgressError({
          cause:
            "Log exceeds the 16 MiB safety budget; preserve and archive it before continuing.",
          operation: "read",
        });
      }

      const text = yield* fs.readFileString(log);

      if (text !== "" && !text.endsWith("\n")) {
        return yield* new LearnerProgressError({
          cause: "Incomplete log tail; preserve the source before recovery.",
          operation: "read",
        });
      }

      return yield* Effect.forEach(
        text.split("\n").filter((line) => line !== ""),
        (line) =>
          Schema.decodeUnknownEffect(Schema.fromJsonString(LearnEventSchema))(
            line
          )
      );
    });

    const replay = Effect.fn("LearnerProgress.replay")(function* replay(
      events: readonly LearnEvent[]
    ) {
      let progress = emptyProgress;

      for (const event of events) {
        progress = yield* learner.record(progress, event);
      }

      return progress;
    });

    const replace = Effect.fn("LearnerProgress.replace")(function* replace(
      name: string,
      text: string
    ) {
      const temporary = yield* fs.makeTempFileScoped({
        directory,
        prefix: ".learn-",
      });

      yield* fs.writeFileString(temporary, text, { mode: 0o600 });
      yield* fs.rename(temporary, path.join(directory, name));
    });

    const rebuild = Effect.fn("LearnerProgress.rebuild")(function* rebuild(
      progress: Progress
    ) {
      const cardRows = yield* Effect.forEach(
        (concept: Progress["concepts"][number]) =>
          Schema.encodeEffect(Schema.fromJsonString(ConceptProgressRowSchema))({
            ...concept,
            version: 1,
          })
      )(progress.concepts);

      const cards = cardRows.join("\n");

      const selected = yield* learner.next(progress, {
        at: yield* Effect.clockWith((clock) => clock.currentTimeMillis),
        ids: progress.concepts.map((concept) => concept.id),
      });

      const taskRows = yield* Effect.forEach(
        ({ card, depth }: (typeof selected.cards)[number]) =>
          Schema.encodeEffect(Schema.fromJsonString(LearnTaskSchema))({
            depth,
            id: card.id,
            version: 1,
          })
      )(selected.cards);

      const tasks = taskRows.join("\n");

      yield* replace("cards.jsonl", cards === "" ? "" : `${cards}\n`);
      yield* replace("tasks.jsonl", tasks === "" ? "" : `${tasks}\n`);
      yield* replace("README.md", storeInstructions);
    });

    const transaction = <A, E, R>(
      operation: string,
      body: Effect.Effect<A, E, R>
    ) =>
      semaphore.withPermit(
        Effect.gen(function* lockedOperation() {
          yield* fs.makeDirectory(directory, { mode: 0o700, recursive: true });
          yield* fs.open(lock, { flag: "wx", mode: 0o600 });
          yield* Effect.addFinalizer(() => fs.remove(lock).pipe(Effect.orDie));

          return yield* body;
        }).pipe(
          Effect.scoped,
          Effect.mapError(
            (cause) => new LearnerProgressError({ cause, operation })
          )
        )
      );

    const read = transaction(
      "read",
      Effect.gen(function* readProgress() {
        const progress = yield* replay(yield* readEvents);
        yield* rebuild(progress);

        return progress;
      })
    );

    const record = Effect.fn("LearnerProgress.record")(function* record(
      event: LearnEvent
    ) {
      const decoded = yield* Schema.decodeEffect(LearnEventSchema)(event).pipe(
        Effect.mapError(
          (cause) => new LearnerProgressError({ cause, operation: "validate" })
        )
      );

      return yield* transaction(
        "record",
        Effect.gen(function* appendEvent() {
          const events = yield* readEvents;
          const before = yield* replay(events);

          const encoded = yield* Schema.encodeEffect(
            Schema.fromJsonString(LearnEventSchema)
          )(decoded);

          if (events.some((previous) => JSON.stringify(previous) === encoded)) {
            yield* rebuild(before);

            return before;
          }

          const progress = yield* learner.record(before, decoded);
          yield* commitEvent(decoded).pipe(
            Effect.provideService(LearnEventWriter, {
              append: (entry) =>
                Effect.gen(function* appendToLog() {
                  const line = yield* Schema.encodeEffect(
                    Schema.fromJsonString(LearnEventSchema)
                  )(entry);

                  const file = yield* fs.open(log, { flag: "a", mode: 0o600 });
                  yield* file.writeAll(new TextEncoder().encode(`${line}\n`));
                  yield* file.sync;
                }).pipe(
                  Effect.mapError(
                    (cause) =>
                      new LearnerProgressError({ cause, operation: "append" })
                  )
                ),
            })
          );
          yield* rebuild(progress);

          return progress;
        })
      );
    });

    const next = Effect.fn("LearnerProgress.next")(function* next(
      context: LearnContext
    ) {
      return yield* transaction(
        "next",
        Effect.gen(function* selectNext() {
          const progress = yield* replay(yield* readEvents);
          const result = yield* learner.next(progress, context);
          yield* rebuild(progress);

          return result;
        })
      );
    });

    return LearnerProgress.of({ next, read, record });
  })
);
