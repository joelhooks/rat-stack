# Tokenmaxx workshop setup

For a coding agent. A person gave you this page so you can get their machine ready for the Tokenmaxx workshop.

## How to work

- Do the steps in order. Run each check and show the person its output.
- Steps 4 and 6 are the person's. Stop there, tell them exactly what to type, and wait.
- Every tool here has an equivalent the person may prefer. If they'd rather keep their own, say what the workshop's tool is for and go with theirs. Pi is recommended, not required.
- Ask before you install anything outside the `tokenmaxx` folder, and before you edit a shell startup file.
- Never print keys, tokens or env values. If an error contains one, leave it out.
- The workshop tools are tested on macOS and Linux.

## Rat-stack is the basis

Rat-stack is the basis of everything we're doing in this workshop, philosophically and from a principles perspective. Read https://ratstack.sh/llms.txt before you build anything.

Analyze it structurally and from a core tooling perspective. Ignore the implementation details of its example app.

We think about rat-stack for three things: the core agent surface for this project, the deterministic code-level TypeScript best practices around linting, and, very specifically, the agentic prompting surface. This repo is going to serve as the agentic context for the tool that's getting built.

## 1. Node, pnpm, git and Pi

Run `node -v`, `pnpm -v`, `git --version` and `pi --version`. The workshop needs Node 24.18 or newer, pnpm 11.3, git, and Pi on the PATH, so `pi` starts in any folder. Pi is a prerequisite the person installs before the workshop, from [Pi's install instructions](https://pi.dev/). If `pi` isn't found, say so and point them there. A newer pnpm is fine: inside the workshop folder it switches itself to the pinned 11.3.0. If one is missing or older, say so and ask the person how they want it installed. On a Mac with no git, the person installs Apple's Command Line Tools: `xcode-select --install`, then accept the dialog. It takes a few minutes.

## 2. The workshop tools

A folder of exercises. Each one gives an agent a problem, a place to work and a check that says when it's done. It also pins its own copy of Pi, which the exercises use.

In the folder where the person keeps their projects:

    npx tiged joelhooks/rat-stack/examples/tokenmaxx-starter tokenmaxx
    cd tokenmaxx
    git init -b main
    pnpm install

Run the first line exactly as written. Don't create `tokenmaxx` first, and put nothing in it, such as an npm cache, until tiged has copied the starter: tiged stops if the folder isn't empty.

Expect 175 files and an install of a few seconds. npm deprecation warnings and update notices are harmless.

Already have a `tokenmaxx` folder? Update it instead:

    npx -y tiged joelhooks/rat-stack/examples/tokenmaxx-starter .workshop-state/update --force && node .workshop-state/update/scripts/update.ts

## 3. Herdr

Herdr is a terminal multiplexer: multiple terminals and multiple agents in one window. The workshop is taught in it. If the person already uses another multiplexer and wants to keep it, skip this step.

Run `herdr --version`. If it's missing, ask the person, then install it one of these ways:

    curl -fsSL https://herdr.dev/install.sh | sh

or, with Homebrew:

    brew install herdr

The script puts `herdr` in `~/.local/bin` and edits no shell files. If `herdr` isn't found in a new terminal, that folder isn't on the PATH: ask the person, add it to their shell startup file, and have them open a new terminal. Then run `herdr --version` again.

## 4. The person gives Pi a model

You can't do this for them. Ask the person to run this in `tokenmaxx/`:

    pi

Then they accept the project trust prompt. Cancelling it carries on untrusted, without the workshop's settings. If Pi has no provider yet, `/login` connects a subscription or an API key. They pick a model with `/model` and give it one real prompt that makes it use a tool, such as "read package.json and tell me the package name". They wait for the answer, then `/quit`. Any model they like works.

## 5. The check

    pnpm ex 00.1 check

Passing is three `PASS` lines and `Ready for the workshop.` The check proves a real model turn, a tool call, the pinned packages, and two Pi sessions running at once. If the two-sessions line fails, the person's model account may allow only one session at a time. Tell them.

## 6. The person's own repo

The person needs their own repository for their own project, on this machine: a basic monorepo in the rat-stack style. It is the context for the whole day. Turborepo is the suggested shape.

Pi builds it from two prompts. Open `tokenmaxx/README.md` at "Step 0, before the day" and walk the person through it: a new folder beside `tokenmaxx/`, Pi started there with `pi`, the first prompt, a restart, the second prompt. For Turborepo, the person adds this as the last line of the first prompt:

    Make it a Turborepo monorepo.

It takes 6 to 8 minutes of agent time.

Done when `pnpm ex 01.1 done`, run at the root of the new repo, shows `PASS` on its first check, `A commit with a type error gets refused.`, and prints `Done: the fence holds.`

## 7. Report

Give the person one short list: each step and whether it passed. If a step failed, give the exact error with keys and tokens left out, so they can reply to the workshop email with it. You can also report it yourself: call `reportSetupProblem` on the MCP server at https://ratstack.sh/tokenmaxx/mcp with the person's invite email and the workshop code from their workshop calendar event. It returns known fixes for that step.
