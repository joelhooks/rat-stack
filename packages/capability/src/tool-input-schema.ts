import { Schema } from "effect";

import type { AnyContract } from "./contract.js";

export const hasNoInputFields = (contract: AnyContract) =>
  Object.keys(contract.input.fields).length === 0;

export const emptyInputJsonSchema = {
  ...Schema.toJsonSchemaDocument(Schema.Record(Schema.String, Schema.Never))
    .schema,
  properties: {},
};
