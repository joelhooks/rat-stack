import {
  apiKeyCredentials,
  apiTokenCredentials,
  Credentials,
  oauthCredentials,
} from "@distilled.cloud/cloudflare/Credentials";
import * as Workers from "@distilled.cloud/cloudflare/workers";
import {
  Config,
  Context,
  Effect,
  Layer,
  Match,
  Option,
  Redacted,
} from "effect";

import { DeployStepError } from "./contracts.js";
import { profileCredential } from "./local.js";

interface WorkerDeploymentSession {
  readonly current: (
    worker: string
  ) => Effect.Effect<Option.Option<string>, DeployStepError>;
  readonly restore: (
    worker: string,
    version: string
  ) => Effect.Effect<void, DeployStepError>;
}

export class WorkerDeployments extends Context.Service<
  WorkerDeployments,
  {
    readonly forProfile: (
      profile: string
    ) => Effect.Effect<WorkerDeploymentSession, DeployStepError>;
  }
>()("@rat-stack/deploy/WorkerDeployments") {
  static layer = (entrypoint: string) =>
    Layer.effect(
      WorkerDeployments,
      Effect.gen(function* makeWorkerDeployments() {
        const forProfile = Effect.fn("WorkerDeployments.forProfile")(
          function* forProfile(profile: string) {
            const selectedProfile = yield* Config.String("ALCHEMY_PROFILE");

            if (selectedProfile !== profile) {
              return yield* new DeployStepError({
                keys: ["ALCHEMY_PROFILE"],
                reason: "profile-input-mismatch",
                step: "preflight",
              });
            }

            for (const key of [
              "CLOUDFLARE_API_TOKEN",
              "CLOUDFLARE_API_KEY",
              "CLOUDFLARE_EMAIL",
              "CLOUDFLARE_ACCOUNT_ID",
              "CI",
            ]) {
              const value = yield* Config.String(key).pipe(Config.option);

              if (Option.isSome(value)) {
                return yield* new DeployStepError({
                  keys: [key],
                  reason: "environment-must-not-override-profile",
                  step: "preflight",
                });
              }
            }

            const native = yield* profileCredential(profile, entrypoint).pipe(
              Effect.mapError(
                () =>
                  new DeployStepError({
                    keys: [],
                    reason: "profile-credential-unavailable",
                    step: "preflight",
                  })
              )
            );

            const credential = Match.value(native).pipe(
              Match.when({ type: "apiKey" }, (value) =>
                apiKeyCredentials({
                  apiKey: Redacted.value(value.apiKey),
                  email: Redacted.value(value.email),
                })
              ),
              Match.when({ type: "apiToken" }, (value) =>
                apiTokenCredentials({
                  apiToken: Redacted.value(value.apiToken),
                })
              ),
              Match.when({ type: "oauth" }, (value) =>
                oauthCredentials({
                  accessToken: Redacted.value(value.accessToken),
                })
              ),
              Match.exhaustive
            );

            const accountId = Redacted.value(native.accountId);

            const list = (scriptName: string) =>
              Workers.listScriptDeployments({ accountId, scriptName }).pipe(
                Effect.provideService(Credentials, Effect.succeed(credential)),
                Effect.timeout(30_000),
                Effect.mapError(
                  () =>
                    new DeployStepError({
                      keys: [],
                      reason: "worker-deployment-read-refused",
                      step: "checks",
                    })
                )
              );

            const restore = (scriptName: string, versionId: string) =>
              Workers.createScriptDeployment({
                accountId,
                annotations: { workersMessage: "approved driver rollback" },
                scriptName,
                strategy: "percentage",
                versions: [{ percentage: 100, versionId }],
              }).pipe(
                Effect.provideService(Credentials, Effect.succeed(credential)),
                Effect.timeout(30_000),
                Effect.mapError(
                  () =>
                    new DeployStepError({
                      keys: [],
                      reason: "worker-rollback-refused",
                      step: "apply",
                    })
                ),
                Effect.asVoid
              );

            const services =
              yield* Effect.context<
                Effect.Services<
                  ReturnType<typeof list> | ReturnType<typeof restore>
                >
              >();

            return {
              current: (worker: string) =>
                list(worker).pipe(
                  Effect.map((response) => {
                    const live = response.deployments.toSorted((left, right) =>
                      right.createdOn.localeCompare(left.createdOn)
                    )[0]?.versions;

                    const [version] = live ?? [];

                    return live?.length === 1 &&
                      version?.percentage === 100 &&
                      version.versionId !== undefined
                      ? Option.some(version.versionId)
                      : Option.none<string>();
                  }),
                  Effect.provideContext(services)
                ),
              restore: (worker: string, version: string) =>
                restore(worker, version).pipe(Effect.provideContext(services)),
            } satisfies WorkerDeploymentSession;
          }
        );

        const services =
          yield* Effect.context<
            Effect.Services<ReturnType<typeof forProfile>>
          >();

        return WorkerDeployments.of({
          forProfile: (profile) =>
            forProfile(profile).pipe(
              Effect.catchTag(
                "ConfigError",
                () =>
                  new DeployStepError({
                    keys: [],
                    reason: "profile-input-invalid",
                    step: "preflight",
                  })
              ),
              Effect.provideContext(services)
            ),
        });
      })
    );
}
