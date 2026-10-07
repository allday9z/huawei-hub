# HUAWEI Hub by UFicon — Operation Portal

Static pages (files supplied by Antt, 2026-10-07):

| Path | File | Purpose |
|---|---|---|
| `/` | `site/index.html` (portal.html) | Portal — links to every form |
| `/case-log` | `site/case-log.html` (huawei-case-log_3.html) | Fail Case Service — log store service cases (demo mode until `ENDPOINT` is set) |
| `/checklist` | `site/checklist.html` (huawei-morning-checklist.html) | Morning Store Checklist (daily) |
| `/report-dashboard` | `site/report-dashboard.html` | Report Dashboard (Google sign-in, allow-list) |

Served by a small Bun server (`server.ts`, see `Dockerfile`) — same clean URLs as
before, plus `POST /api/rewrite` (AI Rewrite button on the checklist; calls the
OpenAI-compatible gateway in env `AI_GATEWAY_ENDPOINT` / `AI_GATEWAY_KEY` /
`AI_GATEWAY_MODEL`, rate-limited per IP + globally, same-origin only). Back-end is Google Apps Script
(ChecklistWebhook.gs / DashboardBackend.gs) deployed under the sheet owner's
Google account — paste its `/exec` URLs into `WEBHOOK_URL` (checklist) and
`BACKEND_URL` + `GOOGLE_CLIENT_ID` (dashboard), then redeploy.

Changes vs. the supplied files: portal links point at `/checklist` and
`/report-dashboard`; a minimal `<head>` (viewport + title) was added to each page.

## Apps Script (v2, hardened) — `apps-script/`

- `ChecklistWebhook.gs` — writes a submission into the branch tab; v2 only accepts
  the 9 branch tab names, serializes writes with a script lock, always rewrites the
  Morning Brief detail cell, validates input.
- `DashboardBackend.gs` — returns the report table; v2 verifies the Google sign-in
  ID token (tokeninfo: signature/expiry, audience = our OAuth Client ID, verified
  email on ALLOWED_EMAILS) instead of trusting an `email=` URL parameter.
  Set `GOOGLE_CLIENT_ID` in both this script and `report-dashboard.html`.

The dashboard page sends both `idToken` (v2) and `email` (so the original v1
script keeps working until v2 is deployed).
