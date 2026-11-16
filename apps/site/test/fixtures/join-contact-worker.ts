import * as Cloudflare from "@alchemy.run/cloudflare";
import { Clock, Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";

import Interest from "../../src/interest/interest-durable-object.js";

export default class JoinContactWorker extends Cloudflare.Worker<JoinContactWorker>()(
  "JoinContactWorker",
  {
    compatibility: { date: "2026-05-28" },
    dev: { port: 0 },
    main: import.meta.url,
  },
  Effect.gen(function* makeJoinContactWorker() {
    const interests = yield* Interest;

    return {
      fetch: Effect.gen(function* fetch() {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const url = new URL(request.url, "https://fixture.example.test");
        const id = url.pathname.slice(1);
        const contact = interests.getByName(id);
        yield* contact.intakeStore([
          { id, sealed: "synthetic-runtime-marker" },
        ]);
        const deadline = (yield* Clock.currentTimeMillis) + 10_000;
        yield* contact.joinSave(`unreadable-${id}`, false, deadline, id);

        if (url.searchParams.has("erase")) {
          yield* contact.joinRequestErase();
        }

        return HttpServerResponse.jsonUnsafe({ deadline });
      }),
    };
  })
) {}
