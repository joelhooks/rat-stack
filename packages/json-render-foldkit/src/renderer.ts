import {
  evaluateVisibility,
  getByPath,
  resolveBindings,
  resolveElementProps,
  resolveRepeatItemStatePath,
  resolveRepeatStatePath,
} from "@json-render/core";
import type {
  PropResolutionContext,
  Spec,
  StateModel,
} from "@json-render/core";
import { Predicate, Result, Schema } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type {
  ComponentCatalog,
  ComponentContext,
  Components,
  MessageConstructor,
} from "./catalog-types.js";
import { actionsForEvent } from "./contexts.js";

type RuntimeComponent<Message> = (
  context: ComponentContext<unknown, Message>
) => Html;

export const createRenderer = <C extends ComponentCatalog, Message>(
  catalog: C,
  components: Components<C, Message>,
  message: MessageConstructor<Message>
) => {
  const RegisteredComponent = Schema.declare<RuntimeComponent<Message>>(
    (input): input is RuntimeComponent<Message> => Predicate.isFunction(input)
  );

  const registry = Object.fromEntries(
    Object.entries(components).map(([name, component]) => [
      name,
      Schema.decodeUnknownSync(RegisteredComponent)(component),
    ])
  );

  return (spec: Spec, model: StateModel, h: HtmlBuilder<Message>): Html => {
    const render = (
      id: string,
      context: PropResolutionContext,
      ancestors: ReadonlySet<string>
    ): Html => {
      const element = Object.hasOwn(spec.elements, id)
        ? spec.elements[id]
        : undefined;

      const definition =
        element === undefined || !catalog.componentNames.includes(element.type)
          ? undefined
          : catalog.data.components[element.type];

      const component =
        element === undefined ? undefined : registry[element.type];

      if (
        element === undefined ||
        definition === undefined ||
        component === undefined ||
        ancestors.has(id)
      ) {
        return null;
      }

      if (!evaluateVisibility(element.visible, context)) {
        return null;
      }

      const resolved = resolveElementProps(element.props, context);
      const parsed = definition.props.safeParse(resolved);

      if (!parsed.success) {
        return h.p([h.Role("alert")], [`Invalid props for ${element.type}.`]);
      }

      const props = parsed.data;

      const nextAncestors = new Set([...ancestors, id]);
      let children: Html[];

      if (element.repeat === undefined) {
        children = (element.children ?? []).map((child) =>
          render(child, context, nextAncestors)
        );
      } else {
        const path = resolveRepeatStatePath(
          element.repeat.statePath,
          context.repeatBasePath
        );

        const values = Schema.decodeUnknownResult(Schema.Array(Schema.Unknown))(
          path === undefined ? [] : getByPath(model, path)
        );

        children =
          Result.isFailure(values) || path === undefined
            ? []
            : values.success.flatMap((item, index) =>
                (element.children ?? []).map((child) =>
                  render(
                    child,
                    {
                      ...context,
                      repeatBasePath: resolveRepeatItemStatePath(path, index),
                      repeatIndex: index,
                      repeatItem: item,
                    },
                    nextAncestors
                  )
                )
              );
      }

      return component({
        bindings: resolveBindings(element.props, context) ?? {},
        children,
        h,
        on: (event) => {
          const actions = actionsForEvent(element, event, context);

          return actions.length === 0 ? undefined : message(actions);
        },
        props,
      });
    };

    return render(spec.root, { stateModel: model }, new Set());
  };
};
