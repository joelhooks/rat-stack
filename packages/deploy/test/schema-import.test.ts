import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Config, Effect, FileSystem, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { requiredProdKeys } from "../src/inputs.js";

const repository = new URL("../../../", import.meta.url).pathname;

const ResolvedSchema = Schema.Struct({
  config: Schema.Record(
    Schema.String,
    Schema.Struct({ value: Schema.optional(Schema.Unknown) })
  ),
  sources: Schema.Array(Schema.Struct({ label: Schema.String })),
});

it.layer(NodeServices.layer)((test) => {
  test.effect(
    "no imported schema supplies a value for a key production must set",
    () =>
      Effect.gen(function* importedDefaultsLeaveRequiredKeysEmpty() {
        const fileSystem = yield* FileSystem.FileSystem;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const searchPath = yield* Config.String("PATH");
        const home = yield* Config.String("HOME");

        const handle = yield* spawner.spawn(
          ChildProcess.make(
            "pnpm",
            [
              "exec",
              "varlock",
              "load",
              "--path",
              ".env.schema",
              "--format",
              "json-full",
              "--compact",
            ],
            {
              cwd: repository,
              env: { APP_ENV: "production", HOME: home, PATH: searchPath },
            }
          )
        );

        const output = yield* Stream.mkString(Stream.decodeText(handle.stdout));
        yield* handle.exitCode;

        const resolved = yield* Schema.decodeEffect(
          Schema.fromJsonString(ResolvedSchema)
        )(output);

        const required = requiredProdKeys(
          yield* fileSystem.readFileString(`${repository}.env.schema`)
        );

        expect(resolved.sources.map((source) => source.label)).toContain(
          "apps/mischief/.env.schema"
        );
        expect(required.length).toBeGreaterThan(0);
        expect(
          required.filter((key) => resolved.config[key]?.value !== undefined)
        ).toStrictEqual([]);
      }),
    { timeout: 60_000 }
  );
});
