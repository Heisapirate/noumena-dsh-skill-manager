# Demo video script — DSH Skill Manager

A ~4-minute screen recording (target the exam's 3–6 minute window). This is a
product walkthrough, **not** a code walkthrough — keep the camera on visible
behavior and let narration carry the context.

## Recording setup

- **Resolution:** 1920×1080 (16:9).
- **Recommended tool:** OBS Studio, Windows Game Bar, or your platform's screen
  recorder. Record one monitor only, not the whole desktop.
- **Hide before recording:**
  - terminal scrollback (start with a cleared terminal, or a fresh terminal tab);
  - browser bookmarks bar and any other browser tabs;
  - any DSH tokens, API keys, `Authorization` headers, or `.env` contents —
    **never show credentials on screen**;
  - notifications (enable Do Not Disturb).
- **Narration:** recommended. Speak as you click; keep it to one short sentence
  per step. Silence is fine during loading/network waits.
- **Final filename:** `dsh-skill-manager-demo.mp4`.

## Shot list

| # | Time | What to show | Narration cue |
|---|---|---|---|
| 1 | 0:00–0:20 | The GitHub repo README and the single install command. | "This is the DSH Skill Manager. One command installs it from GitHub." |
| 2 | 0:20–0:45 | Run `dsh plugin --profile web add github:Heisapirate/noumena-dsh-skill-manager`, then `dsh web`. | "The command adds the plugin to the web profile; `dsh web` launches the WebUI." |
| 3 | 0:45–1:00 | Open **Settings → DSH Skill Manager**. Point at the **Host connection: Connected** status. | "The page registers as a Settings section and confirms the host is reachable." |
| 4 | 1:00–1:30 | Type a query (e.g. `python`) into **Search skills.sh**; show the loading skeleton then results. | "Search hits skills.sh live; results appear as you type." |
| 5 | 1:30–1:50 | Hover/point at one result: name, description, source, install count, and the `skills.sh` page link. | "Each result shows name, description, source, install count, and a link to its skills.sh page." |
| 6 | 1:50–2:15 | Click **Install**; show the success feedback, then the row flips to **Installed**. | "Installing writes the skill into DSH's skills root so DSH discovers it." |
| 7 | 2:15–2:30 | Scroll to **Managed skills**; the newly installed skill is listed with its source and install time. | "Managed skills lists only what this plugin installed." |
| 8 | 2:30–2:45 | Show the **Update available** badge (pick a skill with an upstream change, or note the badge appears when upstream changed). | "When skills.sh reports a new remote source hash, the skill shows an update badge." |
| 9 | 2:45–3:05 | Click **Update**, confirm, show the updated state. | "Update is confirmation-gated and swaps the files atomically." |
| 10 | 3:05–3:25 | Click **Uninstall** and show the confirmation prompt. | "Uninstall asks for explicit confirmation before removing anything." |
| 11 | 3:25–3:45 | Confirm; show the refreshed **Managed skills** empty state. | "After uninstall, the list is empty — the plugin only ever touches what it manages." |
| 12 | 3:45–4:00 | One slide/terminal showing the green `check`/`build`/`test`/`smoke` output and a one-line architecture note. | "Everything is covered by 441 tests across 28 files, plus build, typecheck, and smoke gates." |

## Notes for the person recording

- If an upstream skill isn't showing "Update available" at step 8, that's fine —
  narrate the detection rule instead of forcing it; the screenshot checklist in
  [`docs/screenshots.md`](screenshots.md) describes how to stage that state
  deliberately.
- Search requires a ≥2-character query; type slowly enough for the debounce to
  be visible but don't dwell on it.
- If skills.sh is rate-limited or unreachable during recording, narrate the
  graceful error state instead of hiding it — it is part of the demonstrated
  behavior.
- Keep the terminal prompt generic; do not record a path under your personal
  user profile.
