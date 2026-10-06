import type {
  Catalog,
  InferCatalogComponents,
  InferComponentProps,
  ResolvedAction,
} from "@json-render/core";
import type { Html, HtmlBuilder } from "foldkit/html";
import type { ZodType } from "zod";

export type ComponentCatalog = Catalog & {
  readonly data: {
    readonly components: Record<string, { readonly props: ZodType }>;
  };
};

export interface ComponentContext<Props, Message> {
  readonly bindings: Record<string, string>;
  readonly children: readonly Html[];
  readonly h: HtmlBuilder<Message>;
  readonly on: (event: string) => Message | undefined;
  readonly props: Props;
}

export type Components<C extends Catalog, Message> = {
  readonly [Name in keyof InferCatalogComponents<C>]: (
    context: ComponentContext<InferComponentProps<C, Name>, Message>
  ) => Html;
};

export type MessageConstructor<Message> = (
  actions: readonly ResolvedAction[]
) => Message;
