import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Fiber, Layer, Predicate, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { Sandbox } from "../dist/sandbox-service.js";
import { RUNNER_SOURCE, layerSubprocess } from "../dist/sandbox-subprocess.js";

const marker = process.argv[3] ?? `sandbox-proof-${process.pid}`;

const [mode = "kill-parent"] = process.argv.slice(2);

const isAlive = (pid) => {
  try {
    process.kill(Schema.decodeUnknownSync(Schema.Int)(pid), 0);

    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return false;
    }

    throw error;
  }
};

const waitForDeath = async (pid, remaining = 60) => {
  if (!isAlive(pid)) {
    return;
  }

  assert.ok(remaining > 0, `sandbox ${pid} survived`);
  await delay(50);
  await waitForDeath(pid, remaining - 1);
};

const invoke = () =>
  Effect.sync(() => {
    process.stdout.write("READY\n");

    return { ok: true, value: null };
  });

const stubbornSource = `
import { spawn } from "node:child_process";
process.on("SIGTERM", () => {});
const descendant = spawn(process.execPath, ["-e", 'process.on("SIGTERM", () => {}); process.stdout.write("ready"); setInterval(() => {}, 1000);'], { stdio: ["ignore", "pipe", "ignore"] });
descendant.stdout.once("data", () => {
  process.stdout.write(JSON.stringify({ type: "call", id: 1, name: "ready", input: { descendant: descendant.pid } }) + "\\n");
});
setInterval(() => {}, 1000);
`;

const parent = Effect.gen(function* parent() {
  const ready = yield* Deferred.make();
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const observed = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, {
    ...spawner,
    spawn: (command) => {
      if (!Predicate.isTagged(command, "StandardCommand")) {
        throw new Error("Expected a standard sandbox command");
      }

      return spawner
        .spawn(
          ChildProcess.make(
            command.command,
            mode === "parent"
              ? [...command.args, "--", marker]
              : ["--input-type=module", "-e", stubbornSource, "--", marker],
            command.options
          )
        )
        .pipe(
          Effect.tap((handle) =>
            Effect.sync(() => process.stdout.write(`PID ${handle.pid}\n`))
          )
        );
    },
  });

  const run = Sandbox.use((sandbox) =>
    sandbox.run("tools.ready({}); for (;;) {}", (_name, input) =>
      Effect.gen(function* announceReady() {
        if (mode !== "parent") {
          process.stdout.write(`DESCENDANT ${input.descendant}\n`);
        }

        yield* invoke();
        yield* Deferred.succeed(ready);

        return { ok: true, value: null };
      })
    )
  );

  yield* Effect.scoped(
    Effect.gen(function* closeParentScope() {
      const fiber = yield* run.pipe(Effect.forkScoped);
      yield* Deferred.await(ready);

      if (mode === "interrupt-parent") {
        yield* Fiber.interrupt(fiber);
      }

      if (mode === "parent") {
        yield* Fiber.join(fiber);
      }
    })
  ).pipe(
    Effect.provide(
      layerSubprocess({ timeout: "60 seconds" }).pipe(Layer.provide(observed))
    )
  );
}).pipe(Effect.provide(NodeServices.layer));

const killParent = async () => {
  const child = spawn(
    process.execPath,
    [
      import.meta.filename,
      mode === "kill-parent" ? "parent" : `${mode}-parent`,
      marker,
    ],
    { killSignal: "SIGKILL", stdio: ["pipe", "pipe", "pipe"], timeout: 10_000 }
  );

  let sandboxPid;
  let descendantPid;

  try {
    let output = "";

    for await (const chunk of child.stdout) {
      output += chunk;
      const match = /PID (?<pid>\d+)/u.exec(output);

      if (match) {
        sandboxPid = Number(match.groups?.pid);
      }

      const descendant = /DESCENDANT (?<pid>\d+)/u.exec(output);

      if (descendant) {
        descendantPid = Number(descendant.groups?.pid);
      }

      if (output.includes("READY\n")) {
        break;
      }
    }

    assert.ok(
      output.includes("READY\n"),
      "sandbox did not execute its program"
    );
    assert.ok(sandboxPid !== undefined, "sandbox did not start");

    if (mode === "kill-parent") {
      child.kill("SIGKILL");
    }

    await waitForDeath(sandboxPid);

    if (descendantPid !== undefined) {
      await waitForDeath(descendantPid);
    }

    const rows = execFileSync("ps", ["-axo", "pid,ppid,command"], {
      encoding: "utf-8",
    }).split("\n");

    assert.equal(
      rows.filter(
        (row) =>
          row.includes("--disallow-code-generation-from-strings") &&
          row.endsWith(marker)
      ).length,
      0
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }

    if (sandboxPid !== undefined && isAlive(sandboxPid)) {
      process.kill(sandboxPid, "SIGKILL");
    }

    if (descendantPid !== undefined && isAlive(descendantPid)) {
      process.kill(descendantPid, "SIGKILL");
    }
  }
};

const rawRunner = async () => {
  const child = spawn(
    process.execPath,
    [
      "--permission",
      "--disallow-code-generation-from-strings",
      "--input-type=module",
      "-e",
      RUNNER_SOURCE,
      "--",
      marker,
    ],
    { env: {}, stdio: ["pipe", "pipe", "pipe"] }
  );

  try {
    child.stdin.write(
      `${JSON.stringify({ code: mode === "cpu" ? "for (;;) {}" : "await new Promise(() => {})", names: [], timeoutMillis: mode === "eof" ? 60_000 : 200, type: "run" })}\n`
    );

    if (mode === "eof") {
      child.stdin.end();
    }

    await waitForDeath(child.pid);
  } finally {
    if (isAlive(child.pid)) {
      child.kill("SIGKILL");
    }
  }
};

const repeatParent = async (remaining) => {
  if (remaining <= 0) {
    return;
  }

  await killParent();
  process.stdout.write(`PASS ${mode} iteration ${remaining}\n`);
  await repeatParent(remaining - 1);
};

if (mode.endsWith("parent") && mode !== "kill-parent") {
  await Effect.runPromise(parent);
} else if (["kill-parent", "scope", "interrupt"].includes(mode)) {
  await repeatParent(Number(process.argv[4] ?? 1));
} else {
  await rawRunner();
}
