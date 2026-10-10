import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const RootScripts = Schema.fromJsonString(
  Schema.Struct({ scripts: Schema.Record(Schema.String, Schema.String) })
);

const driverScripts = [
  ["deploy:plan", "deployPlan"],
  ["deploy:prod", "deployProd"],
  ["deploy:rollback", "deployRollback"],
] as const;

const escalated = 6;

it.layer(NodeServices.layer)("deploy script exit codes", (test) => {
  test.effect(
    "every production deploy script hands the driver's exit code to CD unchanged",
    () =>
      Effect.gen(function* scriptExitCodes() {
        const fs = yield* FileSystem.FileSystem;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const root = new URL("../../../", import.meta.url).pathname;

        const { scripts } = yield* fs
          .readFileString(`${root}package.json`)
          .pipe(Effect.flatMap(Schema.decodeEffect(RootScripts)));

        const dir = yield* fs.makeTempDirectoryScoped({
          prefix: "deploy-exit-",
        });

        const stub = `${dir}/cli.mjs`;

        yield* fs.writeFileString(
          stub,
          `process.exit(process.argv.slice(2).join(" ") === process.env.EXPECTED_ARGV ? ${escalated} : 9);`
        );

        for (const [name, command] of driverScripts) {
          const script = scripts[name] ?? "";
          const [, driver = ""] = script.split("varlock run -- ");

          expect(driver).toContain("packages/deploy/dist/cli.js");

          const exitCode = yield* spawner.exitCode(
            ChildProcess.make(
              "sh",
              [
                "-c",
                `${driver.replace("../../packages/deploy/dist/cli.js", stub)} --profile ratstack`,
              ],
              {
                cwd: root,
                env: { EXPECTED_ARGV: `${command} --profile ratstack` },
                extendEnv: true,
                stderr: "ignore",
                stdout: "ignore",
              }
            )
          );

          expect({ exitCode, name }).toEqual({ exitCode: escalated, name });
        }
      }).pipe(Effect.scoped),
    30_000
  );
});
