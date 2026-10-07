import * as Schema from "effect/Schema";

export const PreviewStage = Schema.String.check(
  Schema.isPattern(/^pr-[1-9][0-9]*$/u)
);

export const previewResourcesAllowed = (
  resources: Readonly<Record<string, { readonly Type: string }>>
): boolean =>
  Object.entries(resources).every(
    ([id, resource]) =>
      resource.Type === "Cloudflare.Worker" &&
      (id === "Website" || id === "RpcBackend")
  ) && Object.keys(resources).length === 2;
