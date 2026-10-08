declare module "virtual:reader-pages" {
  export const readerPages: unknown;
}

declare module "virtual:reader-shells" {
  export const readerPageShells: Readonly<Record<string, string>>;
}

declare module "virtual:reader-error" {
  export const readerErrorTemplate: unknown;
  export const readerErrorShell: string;
}
