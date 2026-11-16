import * as Cloudflare from "@alchemy.run/cloudflare";
import { ContactRefSchema } from "@rat-stack/core/intake";
import {
  InterestDirectory,
  InterestMode,
  InterestTokens,
  SubscriberConfirm,
  SubscriberIntake,
} from "@rat-stack/core/interest";
import { JoinContactStore } from "@rat-stack/core/join-interest";
import { Effect, Layer, Logger, Redacted, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import Interest from "../../src/interest/interest-durable-object.js";
import { joinContactStoreLayer } from "../../src/interest/join-contact-store.js";
import { joinRetentionBackfillLayer } from "../../src/interest/join-retention-backfill.js";
import { interestRoutes } from "../../src/interest/routes.js";

const legacyIds = ["synthetic-oldest", "synthetic-wrapped", "synthetic-fault"];

export const SYNTHETIC_FAULT_SECRET = "synthetic-secret-in-fault-message";

export default class RetentionBackfillWorker extends Cloudflare.Worker<RetentionBackfillWorker>()(
  "RetentionBackfillWorker",
  {
    compatibility: { date: "2026-05-28" },
    dev: { port: 0 },
    main: import.meta.url,
  },
  Effect.gen(function* makeRetentionWorker() {
    const interests = yield* Interest;

    const tokens = InterestTokens.layer(
      Redacted.make("synthetic-retention-key")
    );

    const contacts = yield* JoinContactStore.pipe(
      Effect.provide(
        joinContactStoreLayer((id) => interests.getByName(`join:${id}`)).pipe(
          Layer.provide(tokens)
        )
      )
    );

    const bootstrap = yield* JoinContactStore.pipe(
      Effect.provide(
        joinContactStoreLayer((id) =>
          interests.getByName(`bootstrap:${id}`)
        ).pipe(Layer.provide(tokens))
      )
    );

    const services = yield* Layer.build(
      Layer.mergeAll(
        InterestDirectory.memory,
        InterestMode.layer("drovr"),
        tokens,
        SubscriberConfirm.unconfigured,
        Layer.succeed(SubscriberIntake, {
          submit: () => Effect.die("preview must not deliver"),
        })
      )
    );

    const seed = HttpRouter.add(
      "POST",
      "/seed",
      Effect.gen(function* seed() {
        const rows = [];

        const request = yield* HttpServerRequest.HttpServerRequest;

        const prefix =
          new URL(request.url, "https://fixture.example.test").searchParams.get(
            "prefix"
          ) ?? "missing-prefix";

        for (const name of legacyIds) {
          const id = `${prefix}-${name}`;
          yield* interests
            .getByName(`join:${id}`)
            .intakeStore([{ id, sealed: "synthetic-locator" }]);
          yield* bootstrap.save({
            agentRef: "synthetic-agent",
            clientBucket: { ipHash: "synthetic-ip", uaHash: "synthetic-ua" },
            contactRef: yield* Schema.decodeEffect(ContactRefSchema)(
              `synthetic-contact-${id}`
            ),
            email: "synthetic@example.test",
            hold: true,
            score: 1,
            signals: [],
            state: "held",
            submissionId: id,
            ticket: "synthetic-ticket",
          });
          rows.push({
            id,
            sealed: yield* interests.getByName(`bootstrap:${id}`).joinRead(),
          });
        }

        return HttpServerResponse.jsonUnsafe(rows);
      }).pipe(Effect.orDie)
    );

    const logs: unknown[] = [];

    const logger = Logger.formatStructured.pipe(
      Logger.map((record) => logs.push(record))
    );

    const app = yield* HttpRouter.toHttpEffect(
      Layer.mergeAll(
        seed,
        HttpRouter.add(
          "GET",
          "/logs",
          Effect.sync(() => HttpServerResponse.jsonUnsafe(logs))
        ),
        interestRoutes({ operatorToken: "synthetic-operator", services })
      )
    ).pipe(Effect.orDie);

    return {
      fetch: Effect.gen(function* fetch() {
        const request = yield* HttpServerRequest.HttpServerRequest;

        const query = new URL(request.url, "https://fixture.example.test")
          .searchParams;

        const fault = query.has("fault");
        const prefix = query.get("prefix") ?? "missing-prefix";

        const ids = fault
          ? ["synthetic-fault"]
          : ["synthetic-oldest", "synthetic-wrapped", "synthetic-missing"];

        const namedIds = ids.map((name) => `${prefix}-${name}`);

        const operationalContacts: JoinContactStore["Service"] = query.has(
          "secret"
        )
          ? {
              ...contacts,
              migrateRetention: (id, dryRun) =>
                contacts
                  .migrateRetention(id, dryRun)
                  .pipe(
                    Effect.andThen(
                      Effect.die(new TypeError(SYNTHETIC_FAULT_SECRET))
                    )
                  ),
            }
          : contacts;

        return yield* app.pipe(
          Effect.provide(
            joinRetentionBackfillLayer(() => Effect.succeed(namedIds)).pipe(
              Layer.provide(
                Layer.succeed(JoinContactStore, operationalContacts)
              )
            )
          ),
          Effect.scoped
        );
      }).pipe(Effect.provide(Logger.layer([logger, Logger.defaultLogger]))),
    };
  })
) {}
