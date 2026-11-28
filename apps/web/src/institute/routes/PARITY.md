# Institute route parity

Inventory: the pinned fork's `src/routes`, `src/worker.ts`, `src/lib/hotkeys/registry.ts`, `src/hooks/useChapterControls.ts`, `src/authoring/client/logic.ts`, and chapter/home link components. Fork routes below are relative to `/institute`.

## Routes and queries

| Fork surface | Status in the port |
| --- | --- |
| `/` (bare prefix and trailing slash) | Done. Effect UI course home, published Ratstack chapters only. The two Kit chapters are outbound prerequisites, not local lesson routes. |
| `/chapters/:chapter` | Done. SSR chapter overview, section list and transcript; native section/previous/next/home links; chapter-level canonical and share card. The chapter-only player and controls mount after hydration; the transcript and links work without JavaScript. |
| `/chapters/:chapter?section=:id` | Done. Selects by manifest ID; missing/unknown IDs fall back to the first section. Copy the native section link to share it. |
| `?fresh=1` | Dropped as a query: a request without `section` already selects the first section. The controls save and restore section position and playback preferences. |
| `/chapters/` redirect and `/content` → `intro` | Dropped. Home is the chapter index; Kit’s intro is on Effect Institute. |
| `/sitemap` | Replaced by the gated `/sitemap.xml` fragment at `/institute/sitemap.xml`. When public it also appears in the site sitemap index and `robots.txt`. |
| `/content/*` static manifests, hashed section JSON, WebM and timing JSON | Done for published Ratstack hashed JSON/WebM/M4A via Website assets. The loader reads manifests server-side; raw manifests and separate timing JSON are not public routes. No Kit payloads are staged or served. |
| `/og/home` and `/og/chapter?title=&description=&chapter=` | Dropped: these are authoring templates. Reuse the built `og/home.png` for the Ratstack home, chapter and credit cards. The upstream `og/intro.png` and `og/basics.png` stay with Kit’s chapters. |
| `/hotkeys` | Dropped as a separate shortcut editor; scoped player shortcuts are owned by `instcontrols`. |
| `/changelog` | Dropped: fork-specific log; rat-stack has its own site log. |
| `/debug/components`, `/debug/pixi-comparison`, `/debug/sounds` | Dropped: dev-only diagnostics for the old player. |
| `__authoring`, development HMR and authoring HTTP params `chapter`, `section`, `take` | Dropped from the Website: recording/editing stays in the private fork. |
| Fork favicon, touch icons, webmanifest, font, `robots.txt`, and `/sounds/scroll-jacked.webm` | Dropped as mounted assets: use site chrome/icons and site robots; no scroll-jacking cue. |
| `/credits` | New. Original Effect Institute and Kit attribution, MIT notice, and narration library credit. |

## Links and controls

| Fork link or action | Status in the port |
| --- | --- |
| Institute brand, back/home, chapter cards, section outline and next chapter | Home, chapter and section links work without JS. Narration completion follows the in-chapter next link. The final section links to the next chapter without navigating automatically. |
| Resume from last chapter/section, go to next on completion, replay, progress | The player and controls implement playback, replay, and saved per-section progress. Reloading a section restores its position without autoplay. |
| “By Kit Langton” on intro/basics, original Institute footer, and ratstack.sh footer/logo | Done as credited upstream chapter links, exact section prerequisites where applicable, and persistent footer/site links. No local Kit chapter views. |
| GitHub repository source and Ratstack sample’s historical source pin | Repository links done. Per-chapter source pins belong with lesson source provenance; the historical tree link is not the default for the new course. |
| Copy code, feedback/new GitHub issue form, hotkeys settings, and changelog footer/inline links | Copy code left for the player; old feedback, settings and changelog UI dropped with the fork chrome. No Discord link. |
| Alt-click copy section permalink; Shift-click copy local source path | Native shareable `?section=` anchor replaces special clipboard gesture. Local source-path clipboard dropped as author-only. |

## Hotkeys

| Context and fork bindings | Status in the port |
| --- | --- |
| Chapter Space (play/pause or continue), `r` (restart), ←/`h`, →/`l` (seek, with Shift for larger jumps), `<`/`>` (rate) | Mounted on the focused player through the controls integration. Space toggles playback. |
| Chapter ↓/`j`, ↑/`k`, Home/`gg`, End/Shift+`G`, `gh` | Focused player controls call the route-owned section and home anchors. Mouse, touch, Tab and Enter work on the native links. |
| Alt+←/→ (animation step) | Left for `instcore`/`instcontrols`; animation-step support needs a player controller, not route keyboard interception. |
| Chapter Ctrl+D; authoring Ctrl+R, Enter, Escape | Dropped: inspect or record only in the private dev fork. |
| Home ↓/`j`, ↑/`k`, Enter, Escape | Native Tab/Shift+Tab and Enter replace keyboard interception and the transient selected-card model. |
| Changelog `gh` | Dropped with the changelog route. |
| Debug Pixi ←/`a`, →/`d`; OG generator ←/`a`, →/`d` | Dropped with their debug/authoring routes. |
| Modal Escape | Left for player dialogs if needed. No route modal. |

The Website gate owns HTTP exposure. `InstituteContent.layer` reads the approved six-chapter manifest and validates chapter and section assets served by ASSETS. After adoption the chapter entry loads the player, controls, and the selected hashed section. The mount owns the inside of `#institute-player` and chooses WebM/Opus if the browser supports it, otherwise AAC. The course home does not load player code. The gateway prefers the legacy binding where one already exists.
