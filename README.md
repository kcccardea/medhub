# KCC MedHub v2

Browser-based medication workflow tool for Kelly Cullen Community (Cardea Health, San Francisco).

## Design source of truth
`_reference/MedHub_v2_Architecture.docx` (gitignored, not in this repo).
That doc governs scope, data model, auth, and build order. If code and doc disagree, the doc wins until amended.

## Hosting
`https://kcccardea.github.io/medhub/` — served from `main` branch via GitHub Pages.

## Configuration
Real values are never committed. Copy `config.example.js` to `config.js` (gitignored) and fill in the real Entra `clientId` and `tenantId`.

## Local development
1. Install the **Live Server** extension in VS Code.
2. Configure it to bind to port `8000` (must match the Entra SPA redirect URI).
3. Right-click `index.html` → **Open with Live Server**. App serves at `http://localhost:8000/`.

## Entra app registration
The Entra app must be registered as an **SPA** platform with these redirect URIs:
- `http://localhost:8000/` (local dev)
- `https://kcccardea.github.io/medhub/` (production)

Delegated Microsoft Graph scopes: `Files.ReadWrite`, `User.Read`. (No `Sites.ReadWrite.All` — we use `/me/drive`, not SharePoint sites.)

## Security note
No PHI in this repo. No real client IDs / tenant IDs.
Real config lives in gitignored `config.js`. See `config.example.js` for the shape.

## Build status
Milestone 3: MSAL.js sign-in (redirect flow).
