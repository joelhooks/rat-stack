import { expect, it } from "@effect/vitest";
import type { Spec } from "@json-render/core";
import { Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";
import { z } from "zod";

import { createRenderer, schema } from "../src/index.js";

const catalog = schema.createCatalog({
  actions: { select: { description: "Select an item.", params: z.object({}) } },
  components: {
    Grid: { props: z.object({}), slots: ["default"] },
    Label: {
      events: ["select"],
      props: z.object({ name: z.string(), position: z.number() }),
    },
  },
});

const renderer = createRenderer<typeof catalog, string>(
  catalog,
  {
    Grid: ({ h, children }) => h.div([], [...children]),
    Label: ({ h, props, on }) =>
      h.p([], [`${props.position}:${props.name}`, on("select") ?? ""]),
  },
  (actions) =>
    JSON.stringify(actions.map(({ action, params }) => ({ action, params })))
);

const Text = Schema.String.check(Schema.isPattern(/^[a-z0-9<> &]{0,30}$/u));

const Item = Schema.Struct({ name: Text, visible: Schema.Boolean });

const Flags = Schema.Struct({
  active: Schema.Boolean,
  items: Schema.Array(Item),
  name: Text,
});

const render = (spec: Spec, flags: typeof Flags.Type) =>
  renderToString(
    {
      Flags,
      init: (model: typeof Flags.Type) => ({ model }),
      view: (model, h: HtmlBuilder<string>) => ({
        body: renderer(spec, model, h),
        title: "Adapter test",
      }),
    },
    { flags, isHydratable: false }
  );

it.effect.prop(
  "state reads are snapshots of Model, not a second store",
  { first: Text, second: Text },
  ({ first, second }) =>
    Effect.gen(function* snapshots() {
      const spec: Spec = {
        elements: {
          label: {
            props: { name: { $state: "/name" }, position: 0 },
            type: "Label",
          },
        },
        root: "label",
      };

      const one = yield* render(spec, {
        active: false,
        items: [],
        name: first,
      });

      const two = yield* render(spec, {
        active: false,
        items: [],
        name: second,
      });

      const expected = yield* render(
        {
          elements: {
            label: { props: { name: second, position: 0 }, type: "Label" },
          },
          root: "label",
        },
        { active: false, items: [], name: first }
      );

      expect(two.html).toBe(expected.html);
      expect(first === second || one.html !== two.html).toBe(true);
      expect(spec.elements.label?.props.name).toEqual({ $state: "/name" });
    })
);

it.effect.prop(
  "repeated children use item visibility and send resolved item/index/state action params as Messages",
  {
    active: Schema.Boolean,
    items: Arbitrary.array(Arbitrary.schema(Item), { maxLength: 30 }),
  },
  ({ active, items }) =>
    Effect.gen(function* repeatedActions() {
      const spec: Spec = {
        elements: {
          grid: {
            children: ["label"],
            props: {},
            repeat: { statePath: "/items" },
            type: "Grid",
          },
          label: {
            on: {
              select: {
                action: "select",
                params: {
                  active: { $state: "/active" },
                  name: { $item: "name" },
                  position: { $index: true },
                },
              },
            },
            props: { name: { $item: "name" }, position: { $index: true } },
            type: "Label",
            visible: { $item: "visible" },
          },
        },
        root: "grid",
      };

      const rendered = yield* render(spec, { active, items, name: "" });

      const literal: Spec = {
        elements: {
          grid: {
            children: items.flatMap((item, index) =>
              item.visible ? [`item${index}`] : []
            ),
            props: {},
            type: "Grid",
          },
          ...Object.fromEntries(
            items.map((item, index) => [
              `item${index}`,
              {
                on: {
                  select: {
                    action: "select",
                    params: {
                      active,
                      name: `/items/${index}/name`,
                      position: index,
                    },
                  },
                },
                props: { name: item.name, position: index },
                type: "Label",
              },
            ])
          ),
        },
        root: "grid",
      };

      const expected = yield* render(literal, {
        active: !active,
        items: [],
        name: "",
      });

      expect(rendered.html).toBe(expected.html);
      expect((rendered.html.match(/<p>/gu) ?? []).length).toBe(
        items.filter((item) => item.visible).length
      );
      expect(spec.elements.label?.props.name).toEqual({ $item: "name" });
    })
);
