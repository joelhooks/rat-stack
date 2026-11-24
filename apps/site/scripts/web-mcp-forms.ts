import { Parser } from "htmlparser2";

export const declarativeToolNames = (html: string) => {
  const names: string[] = [];
  new Parser({
    onopentag(name, attributes) {
      if (name === "form" && attributes.toolname !== undefined) {
        names.push(attributes.toolname);
      }
    },
  }).end(html);

  return names;
};
