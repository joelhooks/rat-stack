import { eventFlags, eventsEnabled } from "@rat-stack/core/flags";
import { cloudflareFlagsLayer } from "@rat-stack/flags/cloudflare";
import { configFlagsLayer } from "@rat-stack/flags/config";
import { Layer } from "effect";

export const flagsLayer = configFlagsLayer(eventFlags);

export const liveFlagsLayer = cloudflareFlagsLayer(eventFlags, flagsLayer, [
  eventsEnabled.name,
  // oxlint-disable-next-line anti-slop-effect/no-ordie-in-service-construction -- Live flag configuration failures must abort Worker initialization rather than bypass the adapter's failure policy.
]).pipe(Layer.orDie);
