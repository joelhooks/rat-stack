# 00.1 Check your Pi

> DRAFT: Joel rewrites in his voice.

Before the workshop starts, prove that Pi works on your machine with this repo.

1. Install dependencies:

   ```sh
   pnpm install
   ```

2. Start Pi once from the repo root:

   ```sh
   pnpm pi
   ```

   Pi asks whether to trust this project. Say yes: that lets it install the workshop's pinned packages from `.pi/settings.json`. Then `/login` to any provider you can use, and pick one of its models with `/model`. Pi may already show a default model you have no plan for; you don't need that one. Quit with `/quit`.

3. Run the check:

   ```sh
   pnpm ex 00.1 check
   ```

It does three things:

- Asks your model to read `package.json` with a tool and say what it read. That proves a real model turn and a real tool call.
- Checks that the workshop's pinned packages are installed at their pinned commit.
- Starts two Pi sessions at the same time. Later exercises run two agents side by side.

Each line prints `PASS` or `FAIL`, the model that answered, and what to do next when something fails. `pnpm ex 00.1 status` shows the last result again.

**Done when** `pnpm ex 00.1 check` shows `PASS` on all three lines and ends with `Ready for the workshop.`
