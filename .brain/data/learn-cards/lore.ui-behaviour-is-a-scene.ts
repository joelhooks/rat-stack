import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

interface Toast {
  readonly shown: boolean;
  readonly version: number;
}

const dismissAfterWait = (toast: Toast, version: number): Toast =>
  version === toast.version ? { ...toast, shown: false } : toast;

const staleVersion = Arbitrary.schema(
  Schema.Int.check(Schema.isLessThanOrEqualTo(0))
);

it.prop("a stale timer leaves a settled toast", { staleVersion }, (run) => {
  const settled = { shown: true, version: 1 };

  expect(dismissAfterWait(settled, run.staleVersion)).toStrictEqual(settled);
});
