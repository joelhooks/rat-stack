export const contentWithOrigin = (text: string, origin: string) =>
  text.replaceAll("__RATSTACK_ORIGIN__", origin);
