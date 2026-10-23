import { FlagExit, FlagThreshold } from "@rat-stack/core/flag-control";
import { defineFlag } from "@rat-stack/core/flags";
import type { Flag } from "@rat-stack/core/flags";
import { Schema } from "effect";

export const binaryLadder = <const A>(off: A, on: A): Flag<A>["rungs"] => [
  {
    authority: "agent",
    exit: FlagExit.cases.evidence.make({
      requirements: [
        {
          event: "check",
          read: "acceptance report",
          threshold: FlagThreshold.cases["at-least"].make({ count: 1 }),
        },
      ],
    }),
    name: "off",
    value: off,
  },
  {
    authority: "agent",
    exit: FlagExit.cases.final.make({}),
    name: "on",
    value: on,
  },
];

export const switchFlag = defineFlag("EXAMPLE_SWITCH", Schema.Boolean, {
  default: false,
  owner: "tests",
  purpose: "Exercise audited writes.",
  removeBy: "2099-01-01",
  rungs: binaryLadder(false, true),
});
