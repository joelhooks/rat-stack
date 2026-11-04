import { expect, it } from "@effect/vitest";
import { Schema } from "effect";

import { decideBuild, stampAfterBuild } from "../src/build-stamp.js";

const Token = Schema.Literals(["a", "b"]);

const State = Schema.Struct({
  changed: Schema.Array(Token).check(Schema.isMaxLength(1)),
  head: Token,
  outputs: Token,
  tree: Token,
});

it.prop(
  "a deploy reuses a build only when a clean build of this exact tree produced these exact outputs",
  { after: State, before: State, later: State },
  ({ after, before, later }) => {
    const decision = decideBuild(later, stampAfterBuild(before, after));

    if (decision.kind !== "reuse") {
      return;
    }

    expect(before.changed).toStrictEqual([]);
    expect(after.changed).toStrictEqual([]);
    expect(later.changed).toStrictEqual([]);
    expect(before.tree).toBe(after.tree);
    expect(later.tree).toBe(after.tree);
    expect(later.outputs).toBe(after.outputs);
  }
);

it.prop(
  "a clean, unchanged checkout reuses the build it just stamped",
  { state: State },
  ({ state }) => {
    const clean = { ...state, changed: [] };

    expect(decideBuild(clean, stampAfterBuild(clean, clean)).kind).toBe(
      "reuse"
    );
  }
);
