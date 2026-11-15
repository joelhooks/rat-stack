import * as Cloudflare from "@alchemy.run/cloudflare";
import { readSetupHelpSettings } from "@rat-stack/core/tokenmaxx-help";
import { Effect, Layer, Option, Schema } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { defineHelpDesk } from "../../src/workshop-help/help-desk-durable-object.js";
import {
  DeskCommand,
  DeskRequest,
  expiringRetentionMillis,
  fixtureLimits,
} from "./help-desk-protocol.js";

const ExpiringHelpDesk = defineHelpDesk("ExpiringHelpDesk", {
  ...fixtureLimits,
  retentionMillis: expiringRetentionMillis,
});

const LimitedHelpDesk = defineHelpDesk("LimitedHelpDesk", {
  ...fixtureLimits,
  retentionMillis: 600_000,
});

export default class HelpDeskWorker extends Cloudflare.Worker<HelpDeskWorker>()(
  "HelpDeskWorker",
  {
    compatibility: { date: "2026-05-28" },
    dev: { port: 0 },
    main: import.meta.url,
  },
  Effect.gen(function* makeHelpDeskWorker() {
    const expiring = yield* ExpiringHelpDesk;
    const limited = yield* LimitedHelpDesk;
    const access = yield* readSetupHelpSettings;

    const accessSeen = HttpServerResponse.text(
      JSON.stringify({
        attendees: Option.getOrElse(access.attendees, () => []).length,
        code: Option.isSome(access.code),
        operator: Option.isSome(access.operatorToken),
        tests: access.tests.length,
      }),
      { contentType: "application/json" }
    );

    const handle = Effect.gen(function* handleDeskCommand() {
      const request = yield* HttpServerRequest.HttpServerRequest;

      const { command, desk, instance } = yield* request.text.pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(Schema.fromJsonString(DeskRequest))
        ),
        Effect.orDie
      );

      const stub = (desk === "expiring" ? expiring : limited).getByName(
        instance
      );

      const outcome = yield* DeskCommand.match(command, {
        Answer: ({ answer, reportId }) => stub.answer(reportId, answer),
        File: ({ report }) => stub.file(report),
        Find: ({ reportId }) => stub.find(reportId),
        List: ({ query }) => stub.list(query),
      });

      return HttpServerResponse.text(JSON.stringify(outcome), {
        contentType: "application/json",
      });
    });

    return {
      fetch: yield* HttpRouter.toHttpEffect(
        Layer.mergeAll(
          HttpRouter.add("POST", "/", handle),
          HttpRouter.add("GET", "/access", Effect.succeed(accessSeen))
        )
      ).pipe(Effect.orDie),
    };
  })
) {}
