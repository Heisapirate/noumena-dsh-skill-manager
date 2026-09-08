# Screenshot checklist — DSH Skill Manager

This documents the five screenshots referenced by the README. **No screenshots
are fabricated** — each image below is a real capture the operator takes and
places in [`docs/assets/`](assets/). Until a file exists, its README reference
stays in this checklist rather than becoming a broken link.

## Where captures go

Save every capture as a PNG in [`docs/assets/`](assets/). Filenames are exact —
the README links depend on them.

## Capture checklist

### 1. `docs/assets/search-results.png`

- **UI state:** the **DSH Skill Manager** settings page with a ≥2-character query
  typed (e.g. `python`) and a populated **Search** results list.
- **Must be visible in the shot:** several result rows, each showing name,
  description, source, install count, and the skills.sh page link; the **Install**
  button; the green **Host connection: Connected** status line.
- **Cropping:** none required; capture the full page at 100% zoom.

### 2. `docs/assets/install-success.png`

- **UI state:** a search result row right after a successful install — the row
  shows the green **Installed** badge (or the success label) instead of the
  **Install** button, and the skill appears in **Managed skills**.
- **Cropping:** crop to the single installed row (plus, optionally, its new
  entry in **Managed skills**).

### 3. `docs/assets/managed-update-available.png`

- **UI state:** the **Managed skills** section with at least one skill showing
  the **Update available** badge and an enabled **Update** button.
- **Staging the state (if needed):** install a skill, then change its upstream
  snapshot hash on skills.sh (or wait for an upstream change), and click
  **Refresh** so the badge appears.
- **Cropping:** crop to the **Managed skills** section if the page is long,
  keeping the skill row and its badges in frame.

### 4. `docs/assets/uninstall-confirmation.png`

- **UI state:** a managed skill row with the **Uninstall** confirmation prompt
  open (the "confirm removal" panel with its Confirm/Cancel controls).
- **Cropping:** crop to the single skill row + open confirmation panel.

### 5. `docs/assets/managed-empty-state.png`

- **UI state:** the **Managed skills** section showing the empty state
  ("This plugin hasn't installed any skills yet…") immediately after a
  successful uninstall.
- **Cropping:** crop to the **Managed skills** section.

## Post-capture

Once the five files exist, wire them into the README's **Screenshots** section
(see the placeholder there) and commit the images.
