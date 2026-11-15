import { turboCache as cartridge } from "alchemy-turbo-cache";

export const turboCache = cartridge({
  main: import.meta.url,
  readers: ["rat-stack"],
  resourceNamePrefix: "TurboCache",
  retainStages: ["prod"],
  retentionDays: 7,
  teams: ["rat-stack"],
});

export default turboCache;
