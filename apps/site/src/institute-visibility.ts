import { Config, Effect } from "effect";

interface InstituteVisibilityBindings {
  readonly INSTITUTE_ENABLED?: unknown;
  readonly INSTITUTE_PUBLIC?: unknown;
}

export const instituteVisibilityFor = (
  bindings: InstituteVisibilityBindings
) => {
  const enabled = bindings.INSTITUTE_ENABLED === "true";

  return {
    enabled,
    discoverable: enabled && bindings.INSTITUTE_PUBLIC === "true",
  };
};

export const instituteVisibilityConfig = Effect.gen(
  function* instituteVisibilityConfig() {
    const enabled = yield* Config.Boolean("INSTITUTE_ENABLED").pipe(
      Config.withDefault(false)
    );

    const discoverable = yield* Config.Boolean("INSTITUTE_PUBLIC").pipe(
      Config.withDefault(false)
    );

    return enabled
      ? { INSTITUTE_ENABLED: "true", INSTITUTE_PUBLIC: String(discoverable) }
      : {};
  }
);
