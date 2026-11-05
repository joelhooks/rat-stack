import * as Cloudflare from "@alchemy.run/cloudflare";
import { Effect, Layer } from "effect";

import { workerAssetsLayer } from "../worker-content.js";
import { workshopDirectoryLayer } from "../workshop-directory.js";
import { workshopMcpForward } from "../workshop-mcp-loader.js";
import { legacySessionFetch } from "./session.js";
import type { StoredSession } from "./session.js";

export default class WorkshopLegacyMcp extends Cloudflare.DurableObject<WorkshopLegacyMcp>()(
  "WorkshopLegacyMcp",
  Effect.gen(function* makeWorkshopLegacyMcp() {
    const state = yield* Cloudflare.DurableObjectState;

    const forward = yield* workshopMcpForward.pipe(
      Effect.provide(Layer.provide(workshopDirectoryLayer, workerAssetsLayer))
    );

    // @effect-diagnostics-next-line returnEffectInGen:off -- Alchemy's DurableObject contract returns the per-instance Effect.
    return legacySessionFetch({
      forward,
      storage: {
        load: state.storage.get<StoredSession>("session"),
        save: (stored) => state.storage.put("session", stored),
      },
    });
  })
) {}
