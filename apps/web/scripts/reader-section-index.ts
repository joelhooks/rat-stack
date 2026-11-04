import { Array, Option, Order } from "effect";

import type { ReaderPageFlags } from "../src/client/reader/model.ts";

const sectionKey = (path: string) => path.split("/")[1] ?? "";

const byTitle = Order.mapInput(
  Order.String,
  (page: { readonly title: string }) => page.title.toLowerCase()
);

export const withSectionIndexes = (
  pages: readonly ReaderPageFlags[]
): readonly ReaderPageFlags[] => {
  const listed = pages.filter(
    (page) => page.page.status < 400 && sectionKey(page.page.path) !== ""
  );

  const sections = Array.groupBy(listed, (page) => sectionKey(page.page.path));

  return pages.map((page) => {
    const key = sectionKey(page.page.path);
    const members = sections[key] ?? [];

    if (page.page.status >= 400 || members.length < 2) {
      return page;
    }

    const href = `/${key}`;
    const overview = members.find((member) => member.page.path === href);

    const rest = Array.sort(
      members
        .filter((member) => member.page.path !== href)
        .map((member) => ({
          path: member.page.path,
          title: member.heading,
        })),
      byTitle
    );

    return {
      ...page,
      sectionIndex: Option.some({
        href,
        pages: [
          ...(overview === undefined
            ? []
            : [{ path: href, title: overview.heading }]),
          ...rest,
        ],
        title: overview?.heading ?? key,
      }),
    };
  });
};
