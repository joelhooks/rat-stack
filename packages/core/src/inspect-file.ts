import { implement } from "@rat-stack/capability/implement";

import { inspectFileContract } from "./contracts.js";
import { runInspectMachine } from "./inspect-machine.js";
import { joinInterest } from "./join-interest.js";

export const inspectFile = implement(inspectFileContract, ({ path }) =>
  runInspectMachine(path)
);

export const capabilities = [inspectFile, joinInterest] as const;
