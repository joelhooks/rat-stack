import { readSetupHelpSettings } from "@rat-stack/core/tokenmaxx-help";
import { Effect } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { LEGACY_SESSION_HEADER } from "./legacy-mcp/session.js";
import WorkshopLegacyMcp from "./legacy-mcp/workshop-durable-object.js";
import { workerAssetsLayer } from "./worker-content.js";
import { HELP_DESK_INSTANCE } from "./workshop-help/desk.js";
import { WorkshopHelpDesk } from "./workshop-help/help-desk-durable-object.js";
import { workshopHelpLayer } from "./workshop-help/live.js";
import { workshopRuntimeFor } from "./workshop-runtime.js";

export const workshopWorkerInit = Effect.gen(function* initWorkshopWorker() {
  const sessions = yield* WorkshopLegacyMcp;
  const desks = yield* WorkshopHelpDesk;
  const access = yield* readSetupHelpSettings;

  const help = workshopHelpLayer(
    () => desks.getByName(HELP_DESK_INSTANCE),
    access
  );

  return yield* workshopRuntimeFor(
    {
      forward: (session, request) => {
        const headers = new Headers(request.headers);
        headers.set(LEGACY_SESSION_HEADER, session);

        return sessions
          .getByName(session)
          .fetch(HttpServerRequest.fromWeb(new Request(request, { headers })))
          .pipe(Effect.map(HttpServerResponse.toWeb), Effect.orDie);
      },
    },
    help
  );
}).pipe(Effect.provide(workerAssetsLayer), Effect.orDie);
