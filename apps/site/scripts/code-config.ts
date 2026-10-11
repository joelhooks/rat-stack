export const codeRepositories = (root: string) => [
  {
    adapter: "git",
    id: "rat-stack",
    linkTemplate:
      "https://github.com/joelhooks/rat-stack/blob/{sha}/{path}#L{start}-L{end}",
    location: root,
    remote: "https://github.com/joelhooks/rat-stack.git",
  },
];
