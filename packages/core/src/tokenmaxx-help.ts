import { implement } from "@rat-stack/capability/implement";
import { Effect } from "effect";

import {
  answerSetupProblemContract,
  listSetupProblemsContract,
  reportSetupProblemContract,
  setupHelpStatusContract,
  setupProblemStatusContract,
} from "./tokenmaxx-help-contracts.js";

export {
  EmailHashList,
  readSetupHelpSettings,
  SetupHelpAccess,
  signInReady,
  unconfiguredHelp,
} from "./tokenmaxx-help-access.js";

export type { SetupHelpSettings } from "./tokenmaxx-help-access.js";

export { HelpCaller } from "./tokenmaxx-help-caller.js";

export { SetupHelpDesk } from "./tokenmaxx-help-desk.js";

export { SetupHelpGuide } from "./tokenmaxx-help-guide-source.js";

const handlers = Effect.promise(() => import("./tokenmaxx-help-handlers.js"));

export const reportSetupProblem = implement(
  reportSetupProblemContract,
  (input) =>
    handlers.pipe(Effect.flatMap((loaded) => loaded.reportSetupProblem(input)))
);

export const setupProblemStatus = implement(
  setupProblemStatusContract,
  (input) =>
    handlers.pipe(Effect.flatMap((loaded) => loaded.setupProblemStatus(input)))
);

export const listSetupProblems = implement(listSetupProblemsContract, (input) =>
  handlers.pipe(Effect.flatMap((loaded) => loaded.listSetupProblems(input)))
);

export const answerSetupProblem = implement(
  answerSetupProblemContract,
  (input) =>
    handlers.pipe(Effect.flatMap((loaded) => loaded.answerSetupProblem(input)))
);

export const setupHelpStatus = implement(setupHelpStatusContract, (input) =>
  handlers.pipe(Effect.flatMap((loaded) => loaded.setupHelpStatus(input)))
);

export const attendeeHelpCapabilities = [
  reportSetupProblem,
  setupProblemStatus,
] as const;

export const operatorHelpCapabilities = [
  listSetupProblems,
  answerSetupProblem,
  setupHelpStatus,
] as const;
