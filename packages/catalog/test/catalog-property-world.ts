import { make } from "@alchemy.run/domain/InMemory";
import * as Layer from "effect/Layer";

import { Catalog, CatalogHandlers } from "../src/Catalog.model.ts";
import { CatalogMemory } from "../src/Catalog/CatalogMemory.ts";

export const makeCatalogPropertyWorld = () => {
  const { control, layer } = make({ manual: true });

  const world = Catalog.layer(CatalogHandlers).pipe(
    Layer.provide(Layer.mergeAll(layer, CatalogMemory))
  );

  return { drain: control.drain, world };
};
