import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { Sandbox } from "../src/sandbox-service.js";
import { layerSubprocess } from "../src/sandbox-subprocess.js";

const proof = Effect.fn("sandboxLifetimeProof")(
  function* proof(mode: string) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const handle = yield* spawner.spawn(
      ChildProcess.make(process.execPath, [
        "scripts/sandbox-lifetime-proof.mjs",
        mode,
      ])
    );

    expect(yield* handle.exitCode).toBe(0);
  },
  Effect.scoped,
  Effect.provide(NodeServices.layer)
);

const scopedRun = Effect.fn("scopedSandboxRun")(function* scopedRun(
  interrupt: boolean
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const started =
    yield* Deferred.make<ChildProcessSpawner.ChildProcessHandle>();

  const observed = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, {
    ...spawner,
    spawn: (command) =>
      spawner
        .spawn(command)
        .pipe(Effect.tap((handle) => Deferred.succeed(started, handle))),
  });

  const handle = yield* Effect.scoped(
    Effect.gen(function* handle() {
      const sandbox = yield* Sandbox;

      const fiber = yield* sandbox
        .run("for (;;) {}", () => Effect.succeed({ ok: true, value: null }))
        .pipe(Effect.forkScoped);

      const child = yield* Deferred.await(started);

      if (interrupt) {
        yield* Fiber.interrupt(fiber);
      }

      return child;
    }).pipe(
      Effect.provide(
        layerSubprocess({ timeout: "60 seconds" }).pipe(Layer.provide(observed))
      )
    )
  );

  expect(yield* handle.isRunning).toBe(false);
}, Effect.provide(NodeServices.layer));

describe("sandbox lifetime", () => {
  it.live("kills its child when the run is interrupted", () => scopedRun(true));
  it.live("kills its child when the owning scope closes", () =>
    scopedRun(false)
  );
  it.live("escalates scope close and kills resistant descendants", () =>
    proof("scope")
  );
  it.live("escalates interruption and kills resistant descendants", () =>
    proof("interrupt")
  );
  it.live("bounds an infinite loop after a capability reply", () =>
    Effect.gen(function* boundsContinuation() {
      const sandbox = yield* Sandbox;

      const error = yield* sandbox
        .run("await tools.ready({}); for (;;) {}", () =>
          Effect.succeed({ ok: true, value: null })
        )
        .pipe(Effect.flip);

      expect(error.reason).toBe("timeout");
    }).pipe(
      Effect.provide(
        layerSubprocess({ timeout: "300 millis" }).pipe(
          Layer.provide(NodeServices.layer)
        )
      )
    )
  );
  it.live("exits on stdin EOF", () => proof("eof"));
  it.live("bounds a synchronous infinite loop inside the child", () =>
    proof("cpu")
  );
  it.live("enforces a child-side wall clock without a caller", () =>
    proof("deadline")
  );
  it.live("survives SIGKILL of its parent without an orphan", () =>
    proof("kill-parent")
  );
});
