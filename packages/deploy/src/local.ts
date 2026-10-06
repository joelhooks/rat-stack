import * as Stacks from "alchemy/Alchemist/routes/stack";
import { collectAuthProviders } from "alchemy/Alchemist/Session";
import { AlchemyContextLive } from "alchemy/AlchemyContext";
import { ArtifactStore, createArtifactStore } from "alchemy/Artifacts";
import { AuthProviders, getAuthProvider } from "alchemy/Auth/AuthProvider";
import { CredentialsStoreLive } from "alchemy/Auth/Credentials";
import { ProfileStore, ProfileStoreLive } from "alchemy/Auth/Profile";
import { formatPlanLines } from "alchemy/Cli/LoggingCli";
import { layerNonInteractive } from "alchemy/Interaction";
import { Progress } from "alchemy/Report";
import { State } from "alchemy/State/State";
import {
  Cause,
  Config,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Predicate,
  Redacted,
  Ref,
  Schema,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import { summarizeApply } from "./apply-receipt.js";
import { measuredCheck, postDeployChecks } from "./checks.js";
import { DeployStepError } from "./contracts.js";
import type { ApplyReceipt, DeployInput } from "./contracts.js";
import { DeployRunner } from "./deploy-runner.js";
import { validateDeployInputs } from "./inputs.js";
import { classifyPlan } from "./plan.js";

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
  result: Schema.Array(
    Schema.Struct({
      versions: Schema.Array(
        Schema.Struct({ percentage: Schema.Finite, version_id: Schema.String })
      ),
    })
  ),
  success: Schema.Boolean,
});

const WorkerAttributes = Schema.Struct({
  versionId: Schema.optional(Schema.String),
  workerName: Schema.String,
});

const stepError = (
  step: DeployStepError["step"],
  reason: string,
  keys: readonly string[] = []
) => new DeployStepError({ keys, reason, step });

const profileCredential = Effect.fn("profileCredential")(
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

      const planned = yield* Ref.make<
        Option.Option<Effect.Success<ReturnType<typeof Stacks.plan>>>
      >(Option.none());

      const pinned = yield* Ref.make<
        Option.Option<Effect.Success<ReturnType<typeof profileCredential>>>
      >(Option.none());

      const completed = yield* Ref.make<readonly string[]>([]);
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
        yield* Ref.set(
          pendingResources,
          snapshot.resources
            .filter((row) => row.action !== "noop")
            .map((row) => row.fqn)
        );
        yield* Ref.set(planned, Option.some(snapshot));

        return formatPlanLines(snapshot.native).join("\n");
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
          formatPlanLines(value.native).join("\n"),
          input.allow
        );

        if (classified.outcome !== "pass") {
          return yield* stepError("apply", "plan-not-approved");
        }

        const intended = value.resources
          .filter((row) => row.action !== "noop")
          .map((row) => row.fqn);

        const exit = yield* Stacks.apply(value).pipe(
          Effect.provideService(Progress, (event) =>
            Predicate.isTagged(event, "apply.resource.status") &&
            [
              "created",
              "updated",
              "adopted",
              "deleted",
              "orphaned",
              "replaced",
            ].includes(event.status)
              ? Ref.update(completed, (rows) =>
                  rows.includes(event.fqn) ? rows : [...rows, event.fqn]
                )
              : Effect.void
          ),
          Effect.exit
        );

        const updated = yield* Ref.get(completed);

        if (Exit.isFailure(exit)) {
          if (Cause.hasInterrupts(exit.cause)) {
            return yield* Effect.interrupt;
          }

          const failureOutcome = Cause.hasDies(exit.cause)
            ? "crashed"
            : "failed";

          return summarizeApply(intended, updated, failureOutcome);
        }

        const versions: Record<string, string> = {};

        const state = yield* State.pipe(
          Effect.provideContext(value.session.context)
        );

        const store = yield* state;

        for (const row of value.resources.filter(
          (resource) => resource.resourceType === "Cloudflare.Worker"
        )) {
          const persisted = yield* store
            .get({ ...value.stack, fqn: row.fqn, stack: value.stack.name })
            .pipe(
              Effect.mapError(() =>
                stepError("apply", "version-readback-refused")
              )
            );

          if (persisted !== undefined && "attr" in persisted) {
            const worker = yield* Schema.decodeUnknownEffect(WorkerAttributes)(
              persisted.attr
            ).pipe(
              Effect.mapError(() =>
                stepError("apply", "version-readback-invalid")
              )
            );

            if (worker.versionId !== undefined) {
              versions[worker.workerName] = worker.versionId;
            }
          }
        }

        return { ...summarizeApply(intended, updated, "success"), versions };
      });

      const checks = Effect.fn("local.checks")(function* checks(
        receipt: ApplyReceipt
      ) {
        const results = yield* postDeployChecks(baseUrl);
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

                const document =
                  yield* HttpClientResponse.schemaBodyJson(VersionList)(
                    response
                  );

                const live = document.result[0]?.versions;

                return (
                  response.status === 200 &&
                  document.success &&
                  live?.length === 1 &&
                  live[0]?.version_id === version &&
                  live[0]?.percentage === 100
                );
              })
            )
          );
        }

        return results;
      });

      const services =
        yield* Effect.context<
          Effect.Services<
            | ReturnType<typeof preflight>
            | ReturnType<typeof plan>
            | ReturnType<typeof apply>
            | ReturnType<typeof checks>
          >
        >();

      return DeployRunner.of({
        apply: (input) =>
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
                  outcome: "partial",
                  updated,
                  versions: {},
                } satisfies ApplyReceipt;
              })
            ),
            Effect.provideContext(services)
          ),
        checks: (receipt) =>
          checks(receipt).pipe(Effect.provideContext(services)),
        plan: (input) => plan(input).pipe(Effect.provideContext(services)),
        preflight: (input) =>
          preflight(input).pipe(Effect.provideContext(services)),
      });
    })
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ProfileStoreLive,
        CredentialsStoreLive,
        Layer.effect(ArtifactStore, Effect.sync(createArtifactStore)),
        layerNonInteractive()
      ).pipe(Layer.provideMerge(AlchemyContextLive))
    )
  );
