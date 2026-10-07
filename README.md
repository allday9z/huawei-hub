# HUAWEI Hub by UFicon — Operation Portal

Static pages (files supplied by Antt, 2026-10-07):

| Path | File | Purpose |
|---|---|---|
| `/` | `site/index.html` (portal.html) | Portal — links to every form |
| `/checklist` | `site/checklist.html` (huawei-morning-checklist.html) | Morning Store Checklist (daily) |
| `/report-dashboard` | `site/report-dashboard.html` | Report Dashboard (Google sign-in, allow-list) |

Served by nginx (see `Dockerfile`, `nginx.conf`). Back-end is Google Apps Script
(ChecklistWebhook.gs / DashboardBackend.gs) deployed under the sheet owner's
Google account — paste its `/exec` URLs into `WEBHOOK_URL` (checklist) and
`BACKEND_URL` + `GOOGLE_CLIENT_ID` (dashboard), then redeploy.

Changes vs. the supplied files: portal links point at `/checklist` and
`/report-dashboard`; a minimal `<head>` (viewport + title) was added to each page.
