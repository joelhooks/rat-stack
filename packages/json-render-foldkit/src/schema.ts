import { defineSchema } from "@json-render/core";

export const schema = defineSchema(
  (s) => ({
    catalog: s.object({
      actions: s.map({ description: s.string(), params: s.zod() }),
      components: s.map({
        description: s.string(),
        events: s.array(s.string()),
        example: s.any(),
        props: s.zod(),
        slots: s.array(s.string()),
      }),
    }),
    spec: s.object({
      elements: s.record(
        s.object({
          children: s.array(s.string()),
          on: { ...s.any(), ...s.optional() },
          props: s.propsOf("catalog.components"),
          repeat: { ...s.any(), ...s.optional() },
          type: s.ref("catalog.components"),
          visible: { ...s.any(), ...s.optional() },
        })
      ),
      root: s.string(),
      state: { ...s.any(), ...s.optional() },
    }),
  }),
  {
    defaultRules: [
      "Every child id must exist. Do not create cycles or unattached elements.",
      "Use state references in props; put visibility and action bindings on the element.",
      "Actions produce host Messages. The renderer never writes Model or starts effects.",
    ],
  }
);
