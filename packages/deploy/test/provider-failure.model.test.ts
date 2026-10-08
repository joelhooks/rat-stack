import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Approval } from "@rat-stack/capability/approval";
import { Progress } from "alchemy/Report";
import {
  Cause,
  ConfigProvider,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Predicate,
  Ref,
  Schema,
} from "effect";
import * as Arbitrary from "effect/Arbitrary";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import { summarizeApply } from "../src/apply-receipt.js";
import { ApplyReceiptSchema, deployReport } from "../src/contracts.js";
import { DeployRunner } from "../src/deploy-runner.js";
import { runDeploy } from "../src/machine.js";
import { applyWithProviderEvidence } from "../src/provider-errors.js";
import { ReceiptStore } from "../src/receipt-store.js";

class BadRequest extends Schema.TaggedError<BadRequest>()("BadRequest", {
  message: Schema.String,
}) {}

const ResourceStatus = Schema.TaggedStruct("apply.resource.status", {
  fqn: Schema.String,
  id: Schema.String,
  message: Schema.optionalKey(Schema.String),
  status: Schema.Literals(["updated", "fail"]),
  type: Schema.String,
});

const ApiEnvelope = Schema.Struct({
  errors: Schema.Array(
    Schema.Struct({ code: Schema.Int, message: Schema.String })
  ),
});

it.effect.prop(
  "a failing fake upload provider preserves resource and API errors through partial apply, receipt persistence, verdict and compact report",
  {
    code: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 999_000, minimum: 1 }))
    ),
    completedCount: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 2, minimum: 0 }))
    ),
    failures: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 3, minimum: 1 }))
    ),
    secret: Arbitrary.schema(Schema.String).pipe(
      Arbitrary.map(
        (value) =>
          `private_${encodeURIComponent(value.replaceAll(/[\uD800-\uDFFF]/gu, "\uFFFD"))}_value`
      )
    ),
  },
  ({ code, completedCount, failures, secret }) =>
    Effect.gen(function* failedProviderModel() {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();

      const store = yield* ReceiptStore.pipe(
        Effect.provide(ReceiptStore.layer(directory))
      );

      const completed = Array.from(
        { length: completedCount },
        (_, index) => `Done${index}`
      );

      const failing = Array.from(
        { length: failures },
        (_, index) => `Mischief${index}`
      );

      const intended = [...completed, ...failing];
      const message = `Script upload validation failed; credential=${secret}; contact operator@example.test`;

      const client = HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json(
              {
                errors: [
                  {
                    code:
                      code +
                      Number(new URL(request.url).pathname.slice(-1)) * 2,
                    message,
                  },
                  {
                    code:
                      code +
                      Number(new URL(request.url).pathname.slice(-1)) * 2 +
                      1,
                    message: `Script exceeds upload limit; diagnostic ${secret}`,
                  },
                ],
                request: { body: secret, headers: { authorization: secret } },
                success: false,
              },
              { status: 400 }
            )
          )
        )
      );

      const updated = yield* Ref.make<readonly string[]>([]);
      const calls = yield* Ref.make<readonly string[]>([]);

      const apply = (observed: HttpClient.HttpClient) =>
        Effect.gen(function* fakeApply() {
          const progress = yield* Progress;

          for (const resource of completed) {
            yield* progress(
              ResourceStatus.make({
                fqn: resource,
                id: resource,
                status: "updated",
                type: "Cloudflare.Worker",
              })
            );
          }

          const exits = yield* Effect.forEach(
            failing,
            (resource) =>
              Effect.gen(function* fakeUpload() {
                const response = yield* observed.execute(
                  HttpClientRequest.put(
                    `https://api.cloudflare.com/client/v4/accounts/test/workers/scripts/${resource}`
                  )
                );

                const envelope =
                  yield* HttpClientResponse.schemaBodyJson(ApiEnvelope)(
                    response
                  );

                const primary =
                  envelope.errors[0]?.message ?? "Missing diagnostic";

                yield* progress(
                  ResourceStatus.make({
                    fqn: resource,
                    id: resource,
                    message: `BadRequest: ${primary}`,
                    status: "fail",
                    type: "Cloudflare.Worker",
                  })
                );

                return yield* new BadRequest({ message: primary });
              }).pipe(
                Effect.withSpan("Cloudflare.workers.putScript"),
                Effect.withSpan("apply.resource", {
                  attributes: { "alchemy.resource.fqn": resource },
                }),
                Effect.exit
              ),
            { concurrency: "unbounded" }
          );

          const causes = exits.filter(Exit.isFailure).map((exit) => exit.cause);

          if (causes.length > 0) {
            let combined = causes[0] ?? Cause.empty;

            for (const cause of causes.slice(1)) {
              combined = Cause.combine(combined, cause);
            }

            return yield* Effect.failCause(combined);
          }

          return yield* Effect.void;
        });

      const runner = DeployRunner.of({
        apply: () =>
          Effect.gen(function* applyFakeProvider() {
            const captured = yield* applyWithProviderEvidence(
              apply,
              client,
              (event) =>
                Predicate.isTagged(event, "apply.resource.status") &&
                event.status === "updated"
                  ? Ref.update(updated, (rows) => [...rows, event.fqn])
                  : Effect.void,
              [secret]
            );

            const receipt = {
              ...summarizeApply(intended, yield* Ref.get(updated), "failed"),
              previousVersions: Object.fromEntries(
                intended.map((resource) => [resource, "previous-version"])
              ),
              profile: "test",
              providerErrors: captured.providerErrors,
            };

            yield* store.saveApply("test", receipt);

            return receipt;
          }),
        checks: () =>
          Ref.update(calls, (rows) => [...rows, "checks"]).pipe(Effect.as([])),
        plan: () =>
          Effect.succeed({
            receipt: summarizeApply(intended, [], "failed"),
            rows: intended.map((resource) => ({
              action: "update" as const,
              resource,
            })),
          }),
        preflight: () => Effect.succeed([]),
        source: () => Effect.succeed({ changed: [], head: "a".repeat(40) }),
      });

      const verdict = yield* runDeploy({
        allow: [],
        mode: "prod",
        profile: "test",
      }).pipe(
        Effect.provideService(DeployRunner, runner),
        Effect.provide(
          Layer.mergeAll(
            Approval.denyAll,
            ConfigProvider.layer(ConfigProvider.fromUnknown({}))
          )
        )
      );

      const persisted = yield* store.readApply("test");
      const report = deployReport("test", verdict, "test-verdict.json");
      expect(verdict.outcome).toBe(completedCount === 0 ? "failed" : "partial");
      expect(verdict.step).toBe("apply");
      expect(yield* Ref.get(calls)).toEqual([]);

      const expected = failing.flatMap((resource, index) => [
        {
          code: code + index * 2,
          message:
            "Script upload validation failed; credential=[redacted]; contact [email]",
          resource,
        },
        {
          code: code + index * 2 + 1,
          message: "Script exceeds upload limit; diagnostic [redacted]",
          resource,
        },
      ]);

      expect(verdict.receipt?.providerErrors).toEqual(expected);
      expect(verdict.providerErrors).toEqual(expected);
      expect(report.providerErrors).toEqual(expected);
      expect(persisted.receipt.providerErrors).toEqual(expected);
      expect(persisted.receipt.updated).toEqual(completed);
      expect(persisted.receipt.notUpdated).toEqual(failing);

      const serialized = yield* Schema.encodeEffect(
        Schema.fromJsonString(ApplyReceiptSchema)
      )(persisted.receipt);

      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain("authorization");
      expect(JSON.stringify({ report, verdict })).not.toContain(secret);
    }).pipe(Effect.provide(NodeServices.layer))
);
