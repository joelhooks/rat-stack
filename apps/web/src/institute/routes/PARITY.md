# Institute route parity

Inventory: the pinned fork's `src/routes`, `src/worker.ts`, `src/lib/hotkeys/registry.ts`, `src/hooks/useChapterControls.ts`, `src/authoring/client/logic.ts`, and chapter/home link components. Fork routes below are relative to `/institute`.

## Routes and queries

| Fork surface | Status in the port |
| --- | --- |
| `/` (bare prefix and trailing slash) | Done. Effect UI course home, published Ratstack chapters only. The two Kit chapters are outbound prerequisites, not local lesson routes. |
| `/chapters/:chapter` | Done. SSR chapter overview, section list and transcript; native section/previous/next/home links; chapter-level canonical and share card. Player mount is left for integration with `instcore`, not claimed here. |
| `/chapters/:chapter?section=:id` | Done. Selects by manifest ID; missing/unknown IDs fall back to the first section. Copy the native section link to share it. |
| `?fresh=1` | Dropped as a query: a request without `section` already selects the first section. Resume and continue behavior belongs to `instcontrols` and the integration. |
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
| Institute brand, back/home, chapter cards, section outline and next chapter | Home, chapter and section links done. In-chapter previous/next links work without JS. Cross-chapter auto-advance is left for player integration; the course index remains available. |
| Resume from last chapter/section, go to next on completion, replay, progress | Left for `instcore` and `instcontrols`; route fallback does not claim playback or persistence. |
| “By Kit Langton” on intro/basics, original Institute footer, and ratstack.sh footer/logo | Done as credited upstream chapter links, exact section prerequisites where applicable, and persistent footer/site links. No local Kit chapter views. |
| GitHub repository source and Ratstack sample’s historical source pin | Repository links done. Per-chapter source pins belong with lesson source provenance; the historical tree link is not the default for the new course. |
| Copy code, feedback/new GitHub issue form, hotkeys settings, and changelog footer/inline links | Copy code left for the player; old feedback, settings and changelog UI dropped with the fork chrome. No Discord link. |
| Alt-click copy section permalink; Shift-click copy local source path | Native shareable `?section=` anchor replaces special clipboard gesture. Local source-path clipboard dropped as author-only. |

## Hotkeys

| Context and fork bindings | Status in the port |
| --- | --- |
| Chapter Space (play/pause or continue), `r` (restart), ←/`h`, →/`l` (seek, with Shift for larger jumps), `<`/`>` (rate) | Left for `instcontrols` on the focused player. |
| Chapter ↓/`j`, ↑/`k`, Home/`gg`, End/Shift+`G`, `gh` | Chapter keyboard navigation left for `instcontrols` to call route-owned section/home anchors. Mouse, touch, Tab and Enter on the native links work now. |
| Alt+←/→ (animation step) | Left for `instcore`/`instcontrols`; animation-step support needs a player controller, not route keyboard interception. |
| Chapter Ctrl+D; authoring Ctrl+R, Enter, Escape | Dropped: inspect or record only in the private dev fork. |
| Home ↓/`j`, ↑/`k`, Enter, Escape | Native Tab/Shift+Tab and Enter replace keyboard interception and the transient selected-card model. |
| Changelog `gh` | Dropped with the changelog route. |
| Debug Pixi ←/`a`, →/`d`; OG generator ←/`a`, →/`d` | Dropped with their debug/authoring routes. |
| Modal Escape | Left for player dialogs if needed. No route modal. |

The Website gate owns HTTP exposure, not the player. Integration must replace the stand-in manifest/preview decoding with `InstituteContent.layer` and supply the chapter-only player mount to `hydrateInstitute`. Load the already validated, hashed `sectionUrl` after adoption; the mount owns the inside of `#institute-player`. The course home does not load player code. The loader supplies the approved six-chapter manifest and fork OG asset; the gateway continues to prefer the legacy binding only in environments where it already exists.
