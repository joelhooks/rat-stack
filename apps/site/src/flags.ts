import { eventFlags, eventsEnabled } from "@rat-stack/core/flags";
import { cloudflareFlagsLayer } from "@rat-stack/flags/cloudflare";
import { configFlagsLayer } from "@rat-stack/flags/config";
import { Layer } from "effect";

export const flagsLayer = configFlagsLayer(eventFlags);

export const liveFlagsLayer = cloudflareFlagsLayer(eventFlags, flagsLayer, [
  eventsEnabled.name,
]).pipe(Layer.orDie);
