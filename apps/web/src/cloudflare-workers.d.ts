declare module "cloudflare:workers" {
  export const env: {
    readonly ASSETS?: {
      readonly fetch: (request: Request) => Promise<Response>;
    };
    readonly INSTITUTE_ENABLED?: string;
    readonly INSTITUTE_PUBLIC?: string;
    readonly BACKEND: {
      readonly fetch: (request: Request) => Promise<Response>;
    };
  };
}
