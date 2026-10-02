import { expect, it } from "@effect/vitest";
import { Effect, Layer, Predicate, Schema, Sink, Stream } from "effect";
import type { ChildProcess } from "effect/process";
import { ChildProcessSpawner } from "effect/process";

import { fetchSources } from "../src/fetch.ts";
import { gitLayer } from "../src/git.ts";
import { SourceRepository } from "../src/index.ts";

const sha = "a".repeat(40);

const job = {
  node: {
    lang: "ts",
    line: 7,
    meta: `repo=local path=example.ts at=${sha} lines=1-2`,
    value: "",
  },
  sourcePath: "page.svx",
};

const config = [
  {
    adapter: "git",
    id: "local",
    location: ".",
    remote: "https://example.test/repo.git",
  },
];

type Mode = "present" | "missing" | "offline" | "success";

const fixture = (mode: Mode) =>
  Effect.sync(() => {
    const base = ChildProcessSpawner.make(() =>
      Effect.die(new Error("Unexpected spawn in Git fixture"))
    );

    const recorded: string[][] = [];
    let fetched = false;
    let head = "one\ntwo\n";

    const record = (command: ChildProcess.Command) => {
      if (Predicate.isTagged(command, "StandardCommand")) {
        recorded.push([...command.args]);
      }
    };

    const service = ChildProcessSpawner.ChildProcessSpawner.of({
      ...base,
      exitCode: (command) => {
        record(command);
        const present = mode === "present" || fetched;

        return Effect.succeed(ChildProcessSpawner.ExitCode(present ? 0 : 128));
      },
      spawn: (command) => {
        record(command);

        if (mode === "success") {
          fetched = true;
        }

        const message =
          mode === "missing"
            ? "fatal: remote error: upload-pack: not our ref"
            : "Could not resolve host";

        const stderr = Stream.make(new TextEncoder().encode(message));

        const handle: ChildProcessSpawner.ChildProcessHandle = {
          all: stderr,
          exitCode: Effect.succeed(
            ChildProcessSpawner.ExitCode(mode === "success" ? 0 : 1)
          ),
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          pid: ChildProcessSpawner.ProcessId(42),
          stderr,
          stdin: Sink.drain,
          stdout: Stream.empty,
          unref: Effect.succeed(Effect.void),
          "~effect/process/ChildProcessSpawner/ChildProcessHandle":
            "~effect/process/ChildProcessSpawner/ChildProcessHandle",
        };

        return Effect.succeed(handle);
      },
      string: (command) => {
        record(command);

        if (!Predicate.isTagged(command, "StandardCommand")) {
          return Effect.die(new Error("Unexpected pipeline in Git fixture"));
        }

        if (command.args.includes("-t")) {
          return Effect.succeed("blob\n");
        }

        if (command.args.includes("show")) {
          return Effect.succeed(
            command.args.includes("HEAD:example.ts") ? head : "one\ntwo\n"
          );
        }

        return Effect.succeed("false\n");
      },
    });

    const changeHead = (text: string) => {
      head = text;
    };

    return { changeHead, recorded, service };
  });

it.layer(Layer.empty)("local Git and explicit bootstrap", (test) => {
  test.effect(
    "build resolution reads local objects only, under any configured id",
    () =>
      Effect.gen(function* offlineBuild() {
        const fake = yield* fixture("present");

        const resolved = yield* SourceRepository.use((source) =>
          source.resolve("local", sha, "example.ts")
        ).pipe(
          Effect.provide(gitLayer(config)),
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            fake.service
          )
        );

        expect(resolved).toBe("one\ntwo\n");
        expect(fake.recorded.some((args) => args.includes("fetch"))).toBe(
          false
        );
        expect(fake.recorded.map((args) => args[2])).toEqual([
          "rev-parse",
          "cat-file",
          "cat-file",
          "show",
        ]);
      })
  );

  test.effect.prop(
    "Git cache keeps pins fixed across changing HEAD values",
    {
      history: Schema.Array(
        Schema.String.check(Schema.isPattern(/^[a-z]{1,8}$/u))
      ).check(Schema.isMinLength(2), Schema.isMaxLength(8)),
    },
    ({ history }) =>
      Effect.gen(function* headHistory() {
        const fake = yield* fixture("present");
        yield* SourceRepository.use((source) =>
          Effect.gen(function* replayHeadChanges() {
            for (const value of history) {
              fake.changeHead(`one\n${value}\n`);
              expect(yield* source.resolve("local", "HEAD", "example.ts")).toBe(
                `one\n${value}\n`
              );
              expect(yield* source.resolve("local", sha, "example.ts")).toBe(
                "one\ntwo\n"
              );
            }
          })
        ).pipe(
          Effect.provide(gitLayer(config)),
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            fake.service
          )
        );
        expect(
          fake.recorded.filter(
            (args) =>
              args.includes("show") && args.includes(`${sha}:example.ts`)
          )
        ).toHaveLength(1);
      }),
    { arbitrary: { runs: 40, size: 8 } }
  );

  test.effect("bootstrap skips a SHA already in local objects", () =>
    Effect.gen(function* skipPresent() {
      const fake = yield* fixture("present");

      const result = yield* fetchSources([job], config).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          fake.service
        )
      );

      expect(result).toEqual([{ commit: sha, fetched: false, repo: "local" }]);
      expect(fake.recorded).toHaveLength(1);
      expect(fake.recorded[0]).toContain("cat-file");
    })
  );

  test.effect(
    "bootstrap fetches the configured remote and verifies the object",
    () =>
      Effect.gen(function* explicitFetch() {
        const fake = yield* fixture("success");

        const result = yield* fetchSources([job], config).pipe(
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            fake.service
          )
        );

        expect(result).toEqual([{ commit: sha, fetched: true, repo: "local" }]);
        expect(fake.recorded[1]).toEqual([
          "-C",
          ".",
          "fetch",
          "--depth=1",
          "--",
          "https://example.test/repo.git",
          sha,
        ]);
        expect(fake.recorded[2]).toContain("cat-file");
      })
  );

  test.effect(
    "bootstrap reports every missing remote with exact repair messages",
    () =>
      Effect.gen(function* remoteErrors() {
        const fake = yield* fixture("missing");

        const error = yield* fetchSources(
          [
            job,
            {
              node: {
                ...job.node,
                meta: job.node.meta.replace(sha, "b".repeat(40)),
              },
              sourcePath: job.sourcePath,
            },
          ],
          [{ adapter: "git", id: "local", location: "." }]
        ).pipe(
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            fake.service
          ),
          Effect.flip
        );

        expect(error.message).toBe(
          `page.svx:7 [SourceFetchUnknownRemote] local@${sha}; Configure remote for this repository before running pnpm sources:fetch.\npage.svx:7 [SourceFetchUnknownRemote] local@${"b".repeat(40)}; Configure remote for this repository before running pnpm sources:fetch.`
        );
      })
  );

  for (const mode of ["missing", "offline"] satisfies readonly Mode[]) {
    test.effect(`bootstrap reports exact ${mode} repair messages`, () =>
      Effect.gen(function* fetchError() {
        const fake = yield* fixture(mode);

        const error = yield* fetchSources([job], config).pipe(
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            fake.service
          ),
          Effect.flip
        );

        const expected =
          mode === "missing"
            ? `page.svx:7 [SourceFetchMissingCommit] local@${sha}; The configured remote has no requested SHA; correct at or remote.`
            : `page.svx:7 [SourceFetchOffline] local@${sha}; Fetch failed; check the configured remote, authentication and connectivity, then retry pnpm sources:fetch.`;

        expect(error.message).toBe(expected);
      })
    );
  }
});
