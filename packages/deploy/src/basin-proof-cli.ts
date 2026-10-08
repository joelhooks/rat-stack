import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as Stacks from "alchemy/Alchemist/routes/stack";
import { AlchemyContextLive } from "alchemy/AlchemyContext";
import { CredentialsStoreLive } from "alchemy/Auth/Credentials";
import { ProfileStoreLive } from "alchemy/Auth/Profile";
import { layerNonInteractive } from "alchemy/Interaction";
import { Progress } from "alchemy/Report";
import type { ProgressReporter } from "alchemy/Report";
import {
  Config,
  Console,
  Effect,
  FileSystem,
  Layer,
  Logger,
  Option,
  Predicate,
  Ref,
  Schema,
  Stream,
} from "effect";
import { FetchHttpClient } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import {
  BasinProof,
  BasinProofFailure,
  ErasureCountsSchema,
  runBasinProof,
} from "./basin-proof-machine.js";

const InputSchema = Schema.Struct({
  deadlineSeconds: Schema.Int.check(Schema.isGreaterThan(0)),
  pollSeconds: Schema.Int.check(Schema.isGreaterThan(0)),
  python: Schema.NonEmptyString,
  script: Schema.NonEmptyString,
  snapshotAgeSeconds: Schema.Int.check(Schema.isGreaterThan(0)),
});

const ResourcesSchema = Schema.Struct({
  accountId: Schema.NonEmptyString,
  bucket: Schema.NonEmptyString,
  uri: Schema.NonEmptyString,
  warehouse: Schema.NonEmptyString,
});

const expectedTypes = new Map([
  ["ErasureProofBucket", "Cloudflare.R2.Bucket"],
  ["ErasureProofStream", "Cloudflare.Pipelines.Stream"],
  ["ErasureProofCatalog", "Cloudflare.R2.DataCatalog"],
  ["ErasureProofSink", "Cloudflare.Pipelines.Sink"],
  ["ErasureProofPipeline", "Cloudflare.Pipelines.Pipeline"],
]);

const scopeMessage =
  "R2 Data Catalog REST token requires Workers R2 Data Catalog Read and Write plus Workers R2 Storage Bucket Item Read and Write, scoped to the throwaway bucket.";

const fail = (reason: BasinProofFailure["reason"], completed = 0) =>
  new BasinProofFailure({ completed, reason });

const program = Effect.gen(function* basinProofProgram() {
  const input = yield* Schema.decodeEffect(Schema.fromJsonString(InputSchema))(
    process.argv[2] ?? ""
  );

  const runId = yield* Config.schema(
    Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/u)),
    "BASIN_PROOF_RUN_ID"
  );

  const profile = yield* Config.String("ALCHEMY_PROFILE");
  yield* Config.Redacted("BASIN_PROOF_TOKEN");

  if (
    profile !== "ratstack" ||
    input.pollSeconds >= input.deadlineSeconds ||
    input.snapshotAgeSeconds >= input.deadlineSeconds
  ) {
    return yield* new BasinProofFailure({
      completed: 0,
      reason: "plan-refused",
    });
  }

  for (const key of [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_API_KEY",
    "CLOUDFLARE_EMAIL",
    "CLOUDFLARE_ACCOUNT_ID",
    "CI",
  ]) {
    if (Option.isSome(yield* Config.option(Config.NonEmptyString(key)))) {
      return yield* new BasinProofFailure({
        completed: 0,
        reason: "plan-refused",
      });
    }
  }

  const target = {
    entrypoint: "scripts/proofs/basin-proof.run.ts",
    envFile: "../../packages/deploy/empty.env",
    profile,
    stage: `proof-${runId}`,
  };

  const planned = yield* Ref.make<
    Option.Option<Stacks.PlanSnapshot<typeof ResourcesSchema.Type>>
  >(Option.none());

  const deployed = yield* Ref.make<Option.Option<typeof ResourcesSchema.Type>>(
    Option.none()
  );

  const created = yield* Ref.make<ReadonlySet<string>>(new Set());
  const destroyed = yield* Ref.make<ReadonlySet<string>>(new Set());
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fs = yield* FileSystem.FileSystem;
  const receiptPath = `../../.rat/proofs/${runId}.json`;

  const saveReceipt = (counts: Readonly<Record<string, number | string>>) =>
    Effect.gen(function* saveProofReceipt() {
      yield* fs.makeDirectory("../../.rat/proofs", { recursive: true });
      yield* fs.writeFileString(
        `${receiptPath}.tmp`,
        JSON.stringify({ ...counts, target }),
        { mode: 0o600 }
      );
      yield* fs.rename(`${receiptPath}.tmp`, receiptPath);
    }).pipe(Effect.mapError(() => fail("engine-failed")));

  const reporter: ProgressReporter = (event) => {
    if (Predicate.isTagged(event, "state.bootstrap.started")) {
      return Effect.die("basin-proof-state-bootstrap-refused");
    }

    if (
      Predicate.isTagged(event, "apply.resource.status") &&
      (event.status === "created" || event.status === "deleted")
    ) {
      return Ref.update(
        event.status === "created" ? created : destroyed,
        (seen) => new Set([...seen, event.fqn])
      );
    }

    return Effect.void;
  };

  const operations = {
    create: Effect.fn("BasinProof.create")(function* create() {
      const snapshot = Option.getOrThrow(yield* Ref.get(planned));

      const resources = yield* Stacks.apply(snapshot).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ResourcesSchema)),
        Effect.mapError(() => fail("apply-failed")),
        Effect.catchTag("BasinProofFailure", (failure) =>
          Ref.get(created).pipe(
            Effect.flatMap((seen) =>
              Effect.fail(fail(failure.reason, seen.size))
            )
          )
        )
      );

      yield* Ref.set(deployed, Option.some(resources));

      return (yield* Ref.get(created)).size;
    }),
    destroy: Effect.fn("BasinProof.destroy")(function* destroy() {
      const allowed = new Set(
        Option.getOrThrow(yield* Ref.get(planned)).resources.map(
          (row) => row.fqn
        )
      );

      // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- dynamic destroy-plan failures are sanitized; only the original approved FQNs may be deleted.
      const snapshot = yield* Stacks.plan<{
        default: Effect.Effect<{ output: typeof ResourcesSchema.Type }>;
      }>({
        operation: "destroy",
        target,
        updateStateStore: false,
      }).pipe(Effect.mapError(() => fail("destroy-failed")));

      if (
        snapshot.actions.length !== 0 ||
        snapshot.resources.some(
          (row) =>
            !allowed.has(row.fqn) ||
            row.action !== "delete" ||
            expectedTypes.get(row.logicalId) !== row.resourceType
        )
      ) {
        return yield* fail("destroy-failed");
      }

      yield* Stacks.apply(snapshot).pipe(
        Effect.mapError(() => fail("destroy-failed")),
        Effect.catchTag("BasinProofFailure", () =>
          Ref.get(destroyed).pipe(
            Effect.flatMap((seen) =>
              Effect.fail(fail("destroy-failed", seen.size))
            )
          )
        )
      );

      return (yield* Ref.get(destroyed)).size;
    }),
    plan: Effect.fn("BasinProof.plan")(function* plan() {
      // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- dynamic stack import failures are sanitized at this proof boundary.
      const snapshot = yield* Stacks.plan<{
        default: Effect.Effect<{ output: typeof ResourcesSchema.Type }>;
      }>({
        operation: "deploy",
        target,
        updateStateStore: false,
      }).pipe(Effect.mapError(() => fail("plan-refused")));

      if (
        snapshot.stack.name !== "BasinErasureProof" ||
        snapshot.stack.stage !== target.stage ||
        snapshot.resources.length !== 5 ||
        snapshot.actions.length !== 0 ||
        snapshot.resources.some(
          (row) =>
            row.action !== "create" ||
            expectedTypes.get(row.logicalId) !== row.resourceType ||
            row.bindings.length !== 0
        )
      ) {
        return yield* fail("plan-refused");
      }

      yield* saveReceipt({
        phase: "approved",
        resourcesCreated: 0,
        resourcesDestroyed: 0,
      });

      return yield* Ref.set(planned, Option.some(snapshot));
    }),
    prove: Effect.fn("BasinProof.prove")(
      function* prove() {
        const resources = Option.getOrThrow(yield* Ref.get(deployed));

        const command = ChildProcess.make(
          input.python,
          [input.script, "--engine"],
          {
            stderr: "pipe",
            stdin: Stream.make(
              new TextEncoder().encode(
                JSON.stringify({
                  ...resources,
                  deadlineSeconds: input.deadlineSeconds,
                  pollSeconds: input.pollSeconds,
                  runId,
                  snapshotAgeSeconds: input.snapshotAgeSeconds,
                })
              )
            ),
            stdout: "pipe",
          }
        );

        const handle = yield* spawner
          .spawn(command)
          .pipe(Effect.mapError(() => fail("engine-failed")));

        yield* Stream.runDrain(handle.stderr).pipe(
          Effect.ignore,
          Effect.forkScoped
        );

        const output = yield* Stream.mkString(
          Stream.decodeText(handle.stdout)
        ).pipe(Effect.mapError(() => fail("engine-failed")));

        const exit = yield* handle.exitCode.pipe(
          Effect.mapError(() => fail("engine-failed"))
        );

        if (exit !== 0) {
          return yield* fail(
            exit === 3 ? "catalog-token-scope-required" : "engine-failed"
          );
        }

        return yield* Schema.decodeEffect(
          Schema.fromJsonString(ErasureCountsSchema)
        )(output.trim()).pipe(Effect.mapError(() => fail("engine-failed")));
      },
      Effect.scoped,
      Effect.timeout(input.deadlineSeconds * 1000),
      Effect.mapError((failure) =>
        Schema.is(BasinProofFailure)(failure) ? failure : fail("engine-failed")
      )
    ),
  };

  const services = yield* Effect.context<
    Effect.Services<
      | ReturnType<typeof operations.plan>
      | ReturnType<typeof operations.create>
      | ReturnType<typeof operations.destroy>
    >
  >().pipe(Effect.provideService(Progress, reporter));

  const result = yield* runBasinProof.pipe(
    Effect.provideService(BasinProof, {
      create: () => operations.create().pipe(Effect.provideContext(services)),
      destroy: () => operations.destroy().pipe(Effect.provideContext(services)),
      plan: () => operations.plan().pipe(Effect.provideContext(services)),
      prove: operations.prove,
    }),
    Effect.provideService(Progress, reporter)
  );

  const failures =
    result.failure === undefined &&
    result.created === 5 &&
    result.destroyed === 5
      ? 0
      : 1;

  yield* saveReceipt({
    ...result.counts,
    failures,
    phase: "settled",
    reason: result.failure?.reason ?? "none",
    resourcesCreated: result.created,
    resourcesDestroyed: result.destroyed,
  });

  yield* Console.log(
    JSON.stringify({
      ...result.counts,
      failures,
      resourcesCreated: result.created,
      resourcesDestroyed: result.destroyed,
    })
  );

  if (failures !== 0) {
    if (result.failure?.reason === "catalog-token-scope-required") {
      yield* Console.error(scopeMessage);
    }

    return yield* result.failure ?? fail("engine-failed");
  }

  return yield* Effect.void;
}).pipe(
  Effect.provide(
    Layer.mergeAll(
      ProfileStoreLive,
      CredentialsStoreLive,
      layerNonInteractive(),
      AlchemyContextLive,
      FetchHttpClient.layer,
      Logger.layer([])
    ).pipe(Layer.provideMerge(NodeServices.layer))
  ),
  Effect.scoped
);

NodeRuntime.runMain(program, { disableErrorReporting: true });
