import { eventFlags } from "@rat-stack/core/flags";
import { configFlagsLayer } from "@rat-stack/flags/config";

export const flagsLayer = configFlagsLayer(eventFlags);
