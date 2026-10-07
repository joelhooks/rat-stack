import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";

import { startupBundle } from "./startup-bundle.ts";

await Effect.runPromise(startupBundle.pipe(Effect.provide(NodeServices.layer)));
