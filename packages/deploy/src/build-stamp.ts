import { Schema } from "effect";

export const BuildStampSchema = Schema.Struct({
  head: Schema.String,
  outputs: Schema.String,
  tree: Schema.String,
});

export type BuildStamp = typeof BuildStampSchema.Type;

export interface BuildState {
  readonly changed: readonly string[];
  readonly head: string;
  readonly outputs: string;
  readonly tree: string;
}

export type BuildDecision =
  | { readonly kind: "reuse"; readonly stamp: BuildStamp }
  | {
      readonly kind: "build";
      readonly reason:
        | "no-build-stamp"
        | "uncommitted-changes"
        | "tree-changed"
        | "outputs-changed";
    };

export const decideBuild = (
  state: BuildState,
  stamp: BuildStamp | undefined
): BuildDecision => {
  if (state.changed.length > 0) {
    return { kind: "build", reason: "uncommitted-changes" };
  }

  if (stamp === undefined) {
    return { kind: "build", reason: "no-build-stamp" };
  }

  if (stamp.tree !== state.tree) {
    return { kind: "build", reason: "tree-changed" };
  }

  if (stamp.outputs !== state.outputs) {
    return { kind: "build", reason: "outputs-changed" };
  }

  return { kind: "reuse", stamp };
};

export const stampAfterBuild = (
  before: BuildState,
  after: BuildState
): BuildStamp | undefined =>
  before.changed.length === 0 &&
  after.changed.length === 0 &&
  before.tree === after.tree
    ? { head: after.head, outputs: after.outputs, tree: after.tree }
    : undefined;
