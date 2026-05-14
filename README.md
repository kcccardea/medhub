# KCC MedHub v2

Browser-based medication workflow tool for Kelly Cullen Community (Cardea Health, San Francisco).

## Design source of truth
`_reference/MedHub_v2_Architecture.docx` (gitignored, not in this repo).
That doc governs scope, data model, auth, and build order. If code and doc disagree, the doc wins until amended.

## Hosting
`https://kcccardea.github.io/medhub/` — served from `main` branch via GitHub Pages.

## Security note
No PHI in this repo. No real client IDs / tenant IDs.
Real config lives in gitignored `config.js`. See `config.example.js` for the shape.

## Build status
Milestone 1: repo + hosting skeleton.
