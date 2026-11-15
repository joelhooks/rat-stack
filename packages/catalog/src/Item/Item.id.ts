import * as Schema from "effect/Schema";

export const ItemId = Schema.String.check(
  Schema.makeFilter((value) => {
    if (!URL.canParse(value)) {
      return false;
    }

    const url = new URL(value);

    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.href === value &&
      url.hash === "" &&
      url.username === "" &&
      url.password === ""
    );
  })
).pipe(Schema.brand("Catalog/ItemId"));
