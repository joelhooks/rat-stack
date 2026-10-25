import * as Cloudflare from "@alchemy.run/cloudflare";
import { R2CrashArchive } from "@rat-stack/events/crash-r2";
import { Effect } from "effect";

import { registerCrashTail } from "./crash-tail-listener.js";
import { silentObservability } from "./observability.js";

export default class CrashTail extends Cloudflare.Worker<CrashTail>()(
  "MischiefCrashTail",
  {
    compatibility: { date: "2026-05-28" },
    main: import.meta.url,
    observability: silentObservability,
    workersDev: false,
  },
  registerCrashTail.pipe(Effect.provide(R2CrashArchive), Effect.as({}))
) {}
