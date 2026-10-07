import {
  ActionBindingSchema,
  resolveAction,
  resolveActionParam,
} from "@json-render/core";
import type {
  PropResolutionContext,
  ResolvedAction,
  UIElement,
} from "@json-render/core";

export const actionsForEvent = (
  element: UIElement,
  event: string,
  context: PropResolutionContext
): readonly ResolvedAction[] => {
  const binding = element.on?.[event];

  if (binding === undefined) {
    return [];
  }

  const bindings = Array.isArray(binding) ? binding : [binding];

  return bindings.flatMap((candidate) => {
    const params = Object.fromEntries(
      Object.entries(candidate.params ?? {}).map(([key, value]) => [
        key,
        resolveActionParam(value, context),
      ])
    );

    const decoded = ActionBindingSchema.safeParse({ ...candidate, params });

    if (!decoded.success) {
      return [];
    }

    return [resolveAction({ ...candidate, params }, context.stateModel)];
  });
};
