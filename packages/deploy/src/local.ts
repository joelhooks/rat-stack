import { Approval } from "@rat-stack/capability/approval";
import { AuthProviders } from "alchemy";
import * as Stacks from "alchemy/Alchemist/routes/stack";
import { collectAuthProviders } from "alchemy/Alchemist/Session";
import { AlchemyContextLive } from "alchemy/AlchemyContext";
import { ArtifactStore, createArtifactStore } from "alchemy/Artifacts";
import { getAuthProvider } from "alchemy/Auth/AuthProvider";
import { CredentialsStoreLive } from "alchemy/Auth/Credentials";
import { ProfileStore, ProfileStoreLive } from "alchemy/Auth/Profile";
import { Interaction, layerNonInteractive } from "alchemy/Interaction";
import { Progress } from "alchemy/Report";
import { State } from "alchemy/State/State";
import {
  Cause,
  Clock,
  Config,
  Context,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Predicate,
  Redacted,
  Ref,
  Result,
  Schema,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { summarizeApply } from "./apply-receipt.js";
import { measuredCheck, postDeployChecks } from "./checks.js";
import { DeployStepError } from "./contracts.js";
import type { ApplyReceipt, DeployInput, PreparedPlan } from "./contracts.js";
import { DeployRunner } from "./deploy-runner.js";
import { validateDeployInputs } from "./inputs.js";
import { callApprovalContext, capabilityInteraction } from "./interaction.js";
import { classifyPlan, planRows } from "./plan.js";
import { applyWithProviderEvidence } from "./provider-errors.js";
import { ReceiptStore } from "./receipt-store.js";
import { watchVerdict } from "./watch.js";
import {
  readWorkerVersionSet,
  WorkerAttributes,
  workerVersionRetryDefaults,
} from "./worker-version-readback.js";

const NativeCredentialSchema = Schema.Union([
  Schema.Struct({
    accountId: Schema.String,
    apiToken: Schema.Redacted(Schema.String),
    type: Schema.Literal("apiToken"),
  }),
  Schema.Struct({
    accountId: Schema.String,
    apiKey: Schema.Redacted(Schema.String),
    email: Schema.Redacted(Schema.String),
    type: Schema.Literal("apiKey"),
  }),
  Schema.Struct({
    accessToken: Schema.Redacted(Schema.String),
    accountId: Schema.String,
    type: Schema.Literal("oauth"),
  }),
]);

type NativeCredential = typeof NativeCredentialSchema.Type;

const ZoneList = Schema.Struct({
  result: Schema.Array(
    Schema.Struct({ id: Schema.String, name: Schema.String })
  ),
  success: Schema.Boolean,
});

const ApiList = Schema.Struct({
  result: Schema.Array(Schema.Struct({ id: Schema.String })),
  success: Schema.Boolean,
});

const VersionList = Schema.Struct({
  result: Schema.Struct({
    deployments: Schema.Array(
      Schema.Struct({
        versions: Schema.Array(
          Schema.Struct({
            percentage: Schema.Finite,
            version_id: Schema.String,
          })
        ),
      })
    ),
  }),
  success: Schema.Boolean,
});

export const readCurrentWorkerVersion = Effect.fn("readCurrentWorkerVersion")(
  function* readCurrentWorkerVersion(
    response: HttpClientResponse.HttpClientResponse
  ) {
    const document =
      yield* HttpClientResponse.schemaBodyJson(VersionList)(response);

    const live = document.result.deployments[0]?.versions;

    return response.status === 200 &&
      document.success &&
      live?.length === 1 &&
      live[0]?.percentage === 100
      ? Option.some(live[0].version_id)
      : Option.none<string>();
  }
);

const stepError = (
  step: DeployStepError["step"],
  reason: string,
  keys: readonly string[] = []
) => new DeployStepError({ keys, reason, step });

export const profileCredential = Effect.fn("profileCredential")(
  function* profileCredential(profile: string, entrypoint: string) {
    const registry = yield* collectAuthProviders({
      envFile: Option.some("../../packages/deploy/empty.env"),
      main: entrypoint,
      profile,
    });

    const auth = yield* getAuthProvider<
      { readonly method: string },
      NativeCredential
    >("Cloudflare").pipe(Effect.provideService(AuthProviders, registry));

    const store = yield* ProfileStore;
    const config = yield* store.loadProviderConfig(auth, profile);

    const resolved = yield* auth.read(profile, config, (updated) =>
      store.setProviderConfig(profile, "Cloudflare", updated).pipe(Effect.orDie)
    );

    const credential = yield* Schema.decodeEffect(NativeCredentialSchema)(
      resolved
    );

    return { ...credential, accountId: Redacted.make(credential.accountId) };
  }
);

const credentialHeaders = (
  credential: Effect.Success<ReturnType<typeof profileCredential>>
) => {
  if (credential.type === "apiKey") {
    return {
      "X-Auth-Email": Redacted.value(credential.email),
      "X-Auth-Key": Redacted.value(credential.apiKey),
    };
  }

  return {
    Authorization: `Bearer ${Redacted.value(credential.type === "apiToken" ? credential.apiToken : credential.accessToken)}`,
  };
};

export const preflightPermissions = Effect.fn("preflightPermissions")(
  function* preflightPermissions(
    credential: Effect.Success<ReturnType<typeof profileCredential>>
  ) {
    const client = yield* HttpClient.HttpClient;

    const get = (path: string) =>
      client.execute(
        HttpClientRequest.get(
          `https://api.cloudflare.com/client/v4${path}`
        ).pipe(HttpClientRequest.setHeaders(credentialHeaders(credential)))
      );

    const zonesResponse = yield* get("/zones?name=ratstack.sh&per_page=50");

    const zones =
      yield* HttpClientResponse.schemaBodyJson(ZoneList)(zonesResponse);

    const zone = zones.result.find((item) => item.name === "ratstack.sh");

    if (zonesResponse.status !== 200 || !zones.success || zone === undefined) {
      return yield* stepError("preflight", "zone-read-refused");
    }

    const redirects = yield* get(
      `/zones/${zone.id}/rulesets?phase=http_request_dynamic_redirect`
    );

    const redirectList =
      yield* HttpClientResponse.schemaBodyJson(ApiList)(redirects);

    if (redirects.status !== 200 || !redirectList.success) {
      return yield* stepError(
        "preflight",
        "redirect-phase-ruleset-list-refused"
      );
    }

    const scripts = yield* get(
      `/accounts/${Redacted.value(credential.accountId)}/workers/scripts`
    );

    const scriptList =
      yield* HttpClientResponse.schemaBodyJson(ApiList)(scripts);

    if (scripts.status !== 200 || !scriptList.success) {
      return yield* stepError("preflight", "worker-scripts-list-refused");
    }

    return true;
  },
  Effect.mapError((failure) =>
    Schema.is(DeployStepError)(failure)
      ? failure
      : stepError("preflight", "credential-preflight-did-not-complete")
  )
);

export const localLayer = (
  entrypoint: string,
  schemaPath: string,
  baseUrl: string
) =>
  Layer.effect(
    DeployRunner,
    Effect.gen(function* makeLocalRunner() {
      const fs = yield* FileSystem.FileSystem;
      const client = yield* HttpClient.HttpClient;
      const receipts = yield* ReceiptStore;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const planned = yield* Ref.make<
        Option.Option<Effect.Success<ReturnType<typeof Stacks.plan>>>
      >(Option.none());

      const pinned = yield* Ref.make<
        Option.Option<Effect.Success<ReturnType<typeof profileCredential>>>
      >(Option.none());

      const contentGeneration = yield* Ref.make(Option.none<string>());
      const previousContentGeneration = yield* Ref.make(Option.none<string>());

      const previousVersions = yield* Ref.make<
        Readonly<Record<string, string>>
      >({});

      const completed = yield* Ref.make<readonly string[]>([]);
      const retainedOrphans = yield* Ref.make<readonly string[]>([]);
      const pendingResources = yield* Ref.make<readonly string[]>([]);

      const get = (
        path: string,
        credential: Effect.Success<ReturnType<typeof profileCredential>>
      ) =>
        client.execute(
          HttpClientRequest.get(
            `https://api.cloudflare.com/client/v4${path}`
          ).pipe(HttpClientRequest.setHeaders(credentialHeaders(credential)))
        );

      const capturePreviousVersions = Effect.fn(
        "local.capturePreviousVersions"
      )(function* capturePreviousVersions(
        value: Stacks.PlanSnapshot,
        credential: Effect.Success<ReturnType<typeof profileCredential>>
      ) {
        const state = yield* State.pipe(
          Effect.provideContext(value.session.context)
        );

        const store = yield* state;
        const prior: Record<string, string> = {};

        for (const row of value.resources.filter(
          (resource) =>
            resource.resourceType === "Cloudflare.Worker" &&
            resource.action !== "create"
        )) {
          const persisted = yield* store
            .get({ ...value.stack, fqn: row.fqn, stack: value.stack.name })
            .pipe(
              Effect.mapError(() =>
                stepError("apply", "previous-version-readback-refused")
              )
            );

          if (persisted !== undefined && "attr" in persisted) {
            const worker = yield* Schema.decodeUnknownEffect(WorkerAttributes)(
              persisted.attr
            ).pipe(
              Effect.mapError(() =>
                stepError("apply", "previous-version-readback-invalid")
              )
            );

            const response = yield* get(
              `/accounts/${Redacted.value(credential.accountId)}/workers/scripts/${encodeURIComponent(worker.workerName)}/deployments`,
              credential
            ).pipe(
              Effect.mapError(() =>
                stepError("apply", "previous-live-version-readback-refused")
              )
            );

            const live = yield* readCurrentWorkerVersion(response).pipe(
              Effect.mapError(() =>
                stepError("apply", "previous-live-version-readback-invalid")
              )
            );

            if (Option.isNone(live)) {
              return yield* stepError(
                "apply",
                "previous-live-version-not-single-deployment"
              );
            }

            prior[worker.workerName] = live.value;
          }
        }

        return prior;
      });

      const source = Effect.fn("local.source")(
        function* source() {
          const head = yield* spawner.string(
            ChildProcess.make("git", ["rev-parse", "HEAD"])
          );

          const status = yield* spawner.string(
            ChildProcess.make("git", [
              "status",
              "--porcelain=v1",
              "--untracked-files=normal",
            ])
          );

          return {
            changed: status
              .split("\n")
              .filter((line) => line.trim().length > 0)
              .map((line) => line.slice(3)),
            head: head.trim(),
          };
        },
        Effect.mapError(() => stepError("source", "checkout-state-unreadable"))
      );

      const preflight = Effect.fn("local.preflight")(
        function* preflight(input: DeployInput) {
          const schema = yield* fs.readFileString(schemaPath);

          const keys = yield* validateDeployInputs(schema).pipe(
            Effect.mapError((failure) =>
              Schema.is(DeployStepError)(failure)
                ? failure
                : stepError("preflight", "required-production-inputs-invalid")
            )
          );

          const profile = yield* Config.String("ALCHEMY_PROFILE");

          if (profile !== input.profile) {
            return yield* stepError(
              "preflight",
              "profile-does-not-match-deploy-input",
              ["ALCHEMY_PROFILE"]
            );
          }

          for (const key of [
            "CLOUDFLARE_API_TOKEN",
            "CLOUDFLARE_API_KEY",
            "CLOUDFLARE_EMAIL",
            "CLOUDFLARE_ACCOUNT_ID",
            "CI",
          ]) {
            const supplied = yield* Config.String(key).pipe(Config.option);

            if (Option.isSome(supplied)) {
              return yield* stepError(
                "preflight",
                "environment-must-not-override-profile",
                [key]
              );
            }
          }

          const credential = yield* profileCredential(
            input.profile,
            entrypoint
          ).pipe(
            Effect.mapError(() =>
              stepError("preflight", "profile-credential-unavailable")
            )
          );

          const manifest = yield* fs
            .readFileString("../../apps/mischief/dist/content/manifest.json")
            .pipe(
              Effect.flatMap(
                Schema.decodeEffect(
                  Schema.fromJsonString(
                    Schema.Struct({ generation: Schema.NonEmptyString })
                  )
                )
              ),
              Effect.mapError(() =>
                stepError(
                  "preflight",
                  "built-content-manifest-unavailable-run-full-build"
                )
              )
            );

          yield* Ref.set(contentGeneration, Option.some(manifest.generation));
          yield* Ref.set(pinned, Option.some(credential));

          yield* preflightPermissions(credential);

          return keys;
        },
        Effect.mapError((failure) =>
          Schema.is(DeployStepError)(failure)
            ? failure
            : stepError("preflight", "credential-preflight-did-not-complete")
        )
      );

      const plan = Effect.fn("local.plan")(function* plan(input: DeployInput) {
        // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Alchemy imports arbitrary stack modules; this adapter maps the upstream unknown failure into DeployStepError.
        const snapshot = yield* Stacks.plan({
          operation: "deploy",
          target: {
            entrypoint,
            envFile: "../../packages/deploy/empty.env",
            profile: input.profile,
            stage: "prod",
          },
          updateStateStore: false,
        }).pipe(
          Effect.provideService(Progress, (event) =>
            Predicate.isTagged(event, "state.bootstrap.started")
              ? Effect.die(stepError("plan", "state-store-mutation-refused"))
              : Effect.void
          ),
          Effect.mapError(() => stepError("plan", "alchemy-plan-refused"))
        );

        yield* Ref.set(completed, []);
        yield* Ref.set(retainedOrphans, []);
        yield* Ref.set(
          pendingResources,
          [...snapshot.resources, ...snapshot.actions].flatMap((row) =>
            row.action === "noop" ? [] : [row.fqn]
          )
        );
        yield* Ref.set(planned, Option.some(snapshot));

        const generation = yield* Ref.get(contentGeneration);

        if (Option.isNone(generation)) {
          return yield* stepError("plan", "content-version-not-pinned");
        }

        return {
          receipt: {
            contentGeneration: generation.value,
            notUpdated: yield* Ref.get(pendingResources),
            outcome: "prepared",
            retainedOrphans: [],
            updated: [],
            versions: {},
          },
          rows: planRows(snapshot.native),
        } satisfies PreparedPlan;
      });

      const apply = Effect.fn("local.apply")(function* apply(
        input: DeployInput
      ) {
        const snapshot = yield* Ref.modify(planned, (current) => [
          current,
          Option.none(),
        ]);

        if (Option.isNone(snapshot) || input.mode !== "prod") {
          return yield* stepError("apply", "no-approved-plan");
        }

        const { value } = snapshot;

        const classified = classifyPlan(
          value.native,
          input.allow,
          input.ownerApproved
        );

        if (classified.outcome !== "pass") {
          return yield* stepError("apply", "plan-not-approved");
        }

        const intended = [...value.resources, ...value.actions].flatMap(
          (row) => (row.action === "noop" ? [] : [row.fqn])
        );

        const interaction = yield* capabilityInteraction;
        const generation = yield* Ref.get(contentGeneration);
        const credential = yield* Ref.get(pinned);

        if (Option.isNone(generation) || Option.isNone(credential)) {
          return yield* stepError("apply", "build-and-profile-not-pinned");
        }

        const state = yield* State.pipe(
          Effect.provideContext(value.session.context)
        );

        const store = yield* state;
        const prior = yield* capturePreviousVersions(value, credential.value);

        yield* Ref.set(previousVersions, prior);

        const previousContent = yield* client
          .execute(
            HttpClientRequest.get(
              `${baseUrl}/?__rat_recovery=${yield* Clock.currentTimeMillis}`
            ).pipe(
              HttpClientRequest.setHeaders({
                accept: "text/markdown",
                "accept-encoding": "identity",
              })
            )
          )
          .pipe(Effect.timeout(15_000), Effect.result);

        const previousGeneration =
          Result.isSuccess(previousContent) &&
          previousContent.success.status === 200
            ? previousContent.success.headers.etag?.match(
                /^(?:W\/)?"(?<generation>[a-f0-9]{64}):default:%2F"$/u
              )?.groups?.generation
            : undefined;

        yield* Ref.set(
          previousContentGeneration,
          Option.fromUndefinedOr(previousGeneration)
        );
        yield* receipts.saveApply(input.profile, {
          contentGeneration: generation.value,
          notUpdated: intended,
          outcome: "prepared",
          previousContentGeneration: previousGeneration,
          previousVersions: prior,
          profile: input.profile,
          retainedOrphans: [],
          updated: [],
          versions: {},
        });

        const replacements = yield* Effect.forEach(
          Object.values(value.native.resources).filter(
            (node) => node.action === "replace"
          ),
          (node) =>
            Schema.decodeUnknownEffect(
              Schema.Struct({
                FQN: Schema.String,
                RemovalPolicy: Schema.Literals(["retain", "destroy"]),
              })
            )(node.resource)
        ).pipe(
          Effect.mapError(() =>
            stepError("apply", "replacement-removal-policy-invalid")
          )
        );

        const retainedReplacementFqns = new Set(
          replacements.flatMap((resource) =>
            resource.RemovalPolicy === "retain" ? [resource.FQN] : []
          )
        );

        const versionDeadline = yield* Config.Int(
          "DEPLOY_WORKER_VERSION_DEADLINE_MS"
        ).pipe(
          Config.withDefault(workerVersionRetryDefaults.deadlineMs),
          Effect.mapError(() =>
            stepError("apply", "worker-version-deadline-invalid", [
              "DEPLOY_WORKER_VERSION_DEADLINE_MS",
            ])
          )
        );

        yield* Schema.decodeEffect(
          Schema.Int.check(Schema.isBetween({ maximum: 600_000, minimum: 0 }))
        )(versionDeadline).pipe(
          Effect.mapError(() =>
            stepError("apply", "worker-version-deadline-invalid", [
              "DEPLOY_WORKER_VERSION_DEADLINE_MS",
            ])
          )
        );

        const { exit, providerErrors } = yield* applyWithProviderEvidence(
          (observedClient) =>
            Stacks.apply({
              ...value,
              session: {
                ...value.session,
                context: Context.add(
                  Context.add(
                    value.session.context,
                    HttpClient.HttpClient,
                    observedClient
                  ),
                  Interaction,
                  interaction
                ),
              },
            }),
          Option.getOrElse(
            Context.getOption(value.session.context, HttpClient.HttpClient),
            () => client
          ),
          (event) =>
            Predicate.isTagged(event, "apply.resource.status") &&
            [
              "created",
              "updated",
              "adopted",
              "deleted",
              "orphaned",
              "replaced",
              "ran",
              "skipped",
            ].includes(event.status)
              ? Ref.update(completed, (rows) =>
                  rows.includes(event.fqn) ? rows : [...rows, event.fqn]
                ).pipe(
                  Effect.andThen(
                    event.status === "orphaned"
                      ? Ref.update(retainedOrphans, (rows) => [
                          ...new Set([...rows, event.fqn]),
                        ])
                      : Effect.void
                  )
                )
              : Effect.void,
          Object.values(credentialHeaders(credential.value)).flatMap(
            (header) => [header, header.replace(/^Bearer\s+/iu, "")]
          )
        );

        const diagnosticFields =
          providerErrors.length === 0 ? {} : { providerErrors };

        const updated = yield* Ref.get(completed);

        if (Exit.isFailure(exit)) {
          if (Cause.hasInterrupts(exit.cause)) {
            return yield* Effect.interrupt;
          }

          const failureOutcome = Cause.hasDies(exit.cause)
            ? "crashed"
            : "failed";

          return {
            ...summarizeApply(
              intended,
              updated,
              failureOutcome,
              yield* Ref.get(retainedOrphans)
            ),
            ...diagnosticFields,
            contentGeneration: generation.value,
            previousVersions: prior,
          };
        }

        const appliedAt = yield* Clock.currentTimeMillis;

        yield* Ref.update(retainedOrphans, (rows) => [
          ...new Set([
            ...rows,
            ...updated.flatMap((fqn) =>
              retainedReplacementFqns.has(fqn)
                ? [`${fqn}#previous-generation`]
                : []
            ),
          ]),
        ]);

        const workers = yield* Effect.forEach(
          value.resources.filter(
            (resource) => resource.resourceType === "Cloudflare.Worker"
          ),
          (row) =>
            store
              .get({ ...value.stack, fqn: row.fqn, stack: value.stack.name })
              .pipe(
                Effect.mapError(() =>
                  stepError("apply", "version-readback-refused")
                ),
                Effect.map((persisted) => ({
                  action: row.action,
                  attributes:
                    persisted !== undefined && "attr" in persisted
                      ? persisted.attr
                      : undefined,
                }))
              )
        );

        const readback = yield* readWorkerVersionSet(
          workers,
          prior,
          (worker) =>
            get(
              `/accounts/${Redacted.value(credential.value.accountId)}/workers/scripts/${encodeURIComponent(worker)}/deployments`,
              credential.value
            ).pipe(
              Effect.flatMap(readCurrentWorkerVersion),
              Effect.mapError(() =>
                stepError("apply", "live-version-readback-refused")
              )
            ),
          { ...workerVersionRetryDefaults, deadlineMs: versionDeadline }
        );

        return {
          ...summarizeApply(
            intended,
            updated,
            "success",
            yield* Ref.get(retainedOrphans)
          ),
          appliedAt,
          contentGeneration: generation.value,
          previousVersions: prior,
          versionReadbacks: readback.checks,
          versions: readback.versions,
        };
      });

      const checks = Effect.fn("local.checks")(function* checks(
        receipt: ApplyReceipt
      ) {
        if (
          receipt.contentGeneration === undefined ||
          receipt.appliedAt === undefined
        ) {
          return yield* stepError("checks", "content-version-not-pinned");
        }

        const results = yield* postDeployChecks(
          baseUrl,
          receipt.contentGeneration,
          receipt.appliedAt
        );

        results.push(...(receipt.versionReadbacks ?? []));

        const credential = yield* Ref.get(pinned);

        if (Option.isNone(credential)) {
          return yield* stepError("checks", "profile-not-pinned");
        }

        for (const [worker, version] of Object.entries(receipt.versions)) {
          results.push(
            yield* measuredCheck(
              `worker-version:${worker}`,
              Effect.gen(function* workerVersion() {
                const response = yield* get(
                  `/accounts/${Redacted.value(credential.value.accountId)}/workers/scripts/${encodeURIComponent(worker)}/deployments`,
                  credential.value
                );

                const live = yield* readCurrentWorkerVersion(response);

                return Option.isSome(live) && live.value === version;
              })
            )
          );
        }

        results.push(yield* watchVerdict(baseUrl));

        return results;
      });

      const services =
        yield* Effect.context<
          Effect.Services<
            | ReturnType<typeof preflight>
            | ReturnType<typeof plan>
            | ReturnType<typeof checks>
          >
        >();

      return DeployRunner.of({
        apply: (input) =>
          Approval.pipe(
            Effect.flatMap((approval) =>
              apply(input).pipe(
                Effect.catchCause((cause) =>
                  Effect.gen(function* preserveApplyEvidence() {
                    if (Cause.hasInterrupts(cause)) {
                      return yield* Effect.interrupt;
                    }

                    const updated = yield* Ref.get(completed);

                    if (updated.length === 0) {
                      return yield* Effect.failCause(cause);
                    }

                    const pending = yield* Ref.get(pendingResources);

                    return {
                      notUpdated: pending.filter(
                        (resource) => !updated.includes(resource)
                      ),
                      ...Option.match(yield* Ref.get(contentGeneration), {
                        onNone: () => ({}),
                        onSome: (generation) => ({
                          contentGeneration: generation,
                        }),
                      }),
                      outcome: "partial",
                      previousVersions: yield* Ref.get(previousVersions),
                      retainedOrphans: yield* Ref.get(retainedOrphans),
                      updated,
                      versions: {},
                    } satisfies ApplyReceipt;
                  })
                ),
                Effect.map((receipt) => ({
                  ...receipt,
                  profile: input.profile,
                })),
                Effect.flatMap((receipt) =>
                  Ref.get(previousContentGeneration).pipe(
                    Effect.map((previous) => ({
                      ...receipt,
                      ...Option.match(previous, {
                        onNone: () => ({}),
                        onSome: (value) => ({
                          previousContentGeneration: value,
                        }),
                      }),
                    })),
                    Effect.flatMap((value) =>
                      receipts
                        .saveApply(input.profile, value)
                        .pipe(Effect.as(value))
                    )
                  )
                ),
                Effect.provideContext(callApprovalContext(services, approval))
              )
            )
          ),
        checks: (receipt) =>
          checks(receipt).pipe(Effect.provideContext(services)),
        plan: (input) => plan(input).pipe(Effect.provideContext(services)),
        preflight: (input) =>
          preflight(input).pipe(Effect.provideContext(services)),
        source,
      });
    })
  ).pipe(
    Layer.provideMerge(ReceiptStore.layer()),
    Layer.provideMerge(
      Layer.mergeAll(
        ProfileStoreLive,
        CredentialsStoreLive,
        Layer.effect(ArtifactStore, Effect.sync(createArtifactStore)),
        layerNonInteractive()
      ).pipe(Layer.provideMerge(AlchemyContextLive))
    )
  );
