import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

const Step = Schema.Literals(["push", "pop"]);

const steps = Arbitrary.array(Arbitrary.schema(Step), { maxLength: 30 });

it.prop("a stack matches its size model after every step", { steps }, (run) => {
  const stack: number[] = [];
  let size = 0;

  for (const step of run.steps) {
    if (step === "push") {
      stack.push(size);
      size += 1;
    } else {
      stack.pop();
      size = Math.max(0, size - 1);
    }

    expect(stack.length).toBe(size);
  }
});
