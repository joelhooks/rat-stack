import { implement } from "@rat-stack/capability/implement";
import { readContract } from "@rat-stack/core/contracts";

import { ContentStore } from "../content-store.js";

export const read = implement(readContract, ({ id }) =>
  ContentStore.use((store) => store.read(id))
);
