# Rebuild what you run

**Applies when:** running, debugging, or publishing an artifact someone else built, such as a container image, a fork, or a prebuilt package.

Run artifacts you can rebuild from pinned, readable sources. If an artifact holds changes that exist nowhere else, extract them as patches, pin every commit, and confirm the rebuild behaves like the original. Publish the recipe, its sources, and their licences together.

**Why:** An artifact nobody can rebuild cannot be audited, debugged, or fixed. Its failures stay mysterious, and every workaround depends on whoever built it.

**Example:** `vendor/README.md` requires each vendored tarball to name the pinned tag it was built from. The last one, `@xstate/effect`, was built from a tag and dropped when npm published the same bytes.

**Held by:** `vendor/README.md`; `investigate-a-failure`, step 3.
