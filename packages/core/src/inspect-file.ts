import { implement } from "@rat-stack/capability/implement";

import { composePage } from "./compose-page.js";
import { inspectFileContract } from "./contracts.js";
import { runInspectMachine } from "./inspect-machine.js";
import { joinInterest } from "./join-interest.js";

export const inspectFile = implement(inspectFileContract, ({ path }) =>
  runInspectMachine(path)
);

export const capabilities = [inspectFile, joinInterest, composePage] as const;
