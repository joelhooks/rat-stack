import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Option, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const parentSource = (code: string) => `
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Sandbox } from ${JSON.stringify(new URL("../dist/sandbox-service.js", import.meta.url).href)};
import { layerSubprocess } from ${JSON.stringify(new URL("../dist/sandbox-subprocess.js", import.meta.url).href)};
const program = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  let childPid;
  const marker = "sandbox-orphan-" + process.pid;
  const observed = {
    ...spawner,
    spawn: (command) => spawner.spawn(ChildProcess.make(command.command, [...command.args, "--", marker], command.options)).pipe(
      Effect.tap((handle) => Effect.sync(() => { childPid = handle.pid; }))
    ),
  };
  yield* Effect.gen(function* () {
    const sandbox = yield* Sandbox;
    yield* sandbox.run(${JSON.stringify(code)}, (name) => name === "start"
      ? Effect.succeed({ ok: true, value: null })
      : Effect.sync(() => {
        process.stdout.write(String(childPid) + "\\n");
      }).pipe(Effect.andThen(Effect.never)));
  }).pipe(Effect.provide(Layer.provide(layerSubprocess({ timeout: "1 minute" }),
    Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, observed)
  )));
}).pipe(Effect.provide(NodeServices.layer));
Effect.runPromise(Effect.scoped(program)).catch((error) => {
  process.stderr.write(String(error));
  process.exit(1);
});
`;

const observeExitSource = (pid: number) => `
const pid = ${pid};
const deadline = Date.now() + 3000;
const timer = setInterval(() => {
  try { process.kill(pid, 0); } catch (error) {
    if (error.code !== "ESRCH") throw error;
    clearInterval(timer);
    process.stdout.write("exited");
    return;
  }
  if (Date.now() >= deadline) {
    clearInterval(timer);
    process.kill(pid, "SIGKILL");
    process.stdout.write("survived");
  }
}, 20);
`;

const decodePid = Schema.decodeUnknownEffect(Schema.FiniteFromString);

const orphanCases = [
  { code: "await tools.ready({});", name: "waiting for a capability" },
  { code: "void tools.ready({}); for (;;) {}", name: "spinning synchronously" },
  {
    code: "void tools.ready({}); await 0; for (;;) {}",
    name: "spinning in a microtask",
  },
  {
    code: "await tools.start({}); void tools.ready({}); for (;;) {}",
    name: "spinning after a capability reply",
  },
];

describe("sandbox parent lifetime", () => {
  for (const { name, code } of orphanCases) {
    it.live(`exits after SIGKILL of its parent while ${name}`, () =>
      Effect.gen(function* parentLifetime() {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

        const parent = yield* spawner.spawn(
          ChildProcess.make(process.execPath, [
            "--input-type=module",
            "-e",
            parentSource(code),
          ])
        );

        const ready = yield* Stream.decodeText(parent.stdout).pipe(
          Stream.splitLines,
          Stream.runHead,
          Effect.timeout("5 seconds")
        );

        expect(Option.isSome(ready)).toBe(true);

        const childPid = yield* decodePid(Option.getOrElse(ready, () => ""));

        yield* Effect.addFinalizer(() =>
          spawner
            .exitCode(
              ChildProcess.make(process.execPath, [
                "-e",
                `try { process.kill(${childPid}, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }`,
              ])
            )
            .pipe(Effect.asVoid, Effect.orDie)
        );

        const killed = yield* spawner.exitCode(
          ChildProcess.make(process.execPath, [
            "-e",
            `process.kill(${parent.pid}, "SIGKILL");`,
          ])
        );

        expect(killed).toBe(0);

        const outcome = yield* spawner.string(
          ChildProcess.make(process.execPath, [
            "-e",
            observeExitSource(childPid),
          ])
        );

        expect(outcome).toBe("exited");
      }).pipe(Effect.provide(NodeServices.layer))
    );
  }
});
