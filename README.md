<p align="center"><img src="public/icons/livegenie-mark.svg" width="96" alt="LiveGenie"></p>

# LiveGenie

The Rolling Hills Community Church AVL knowledge base: one web app where volunteers find how our system works, how to run a service and how to fix what broke. Part of the Live series (LiveMic, LiveCompanion, LivePi, LiveVoice).

Version 0.1.0 · © 2026 Jerod Ulicki

## What 0.1.0 does

- **Spaces and pages.** Audio, Video & Stream, Lighting, Network, Volunteers and Services. A page is a stack of blocks: text (headings, lists, tables, `code`, links), callouts (Tip, Warning, Sunday-critical), checklists, pictures and dividers.
- **Checklists you can tick.** Ticks are kept on each phone or computer, with a progress bar and a Reset button. (Logged checklist runs that press Bitfocus Companion buttons come in 0.4.0.)
- **Pictures.** Take a photo on a phone or drop one in; big photos are shrunk to 1600 px before upload. Tap a picture to zoom.
- **Search.** Instant search over titles and page text, with prefix matching ("amplif" finds "amplifiers") and highlighted matches.
- **History.** Every save is a version. See who changed what and restore any older version (restoring adds a new version; nothing is lost). Two people editing the same page cannot overwrite each other.
- **Trash.** Deleted pages can be brought back.
- **People and roles.** Sign in with a name and PIN. Admin, Editor and Volunteer roles; anyone on the network can read pages that are not marked **Tech only**. Five wrong PINs lock that person for five minutes.
- **Backups.** Nightly at 02:30, kept for 14 days, plus Back up now. Each backup is one `.tar` file with the database and every picture. Download one, upload one, or restore one from Settings › Backups (the current data is saved first, then LiveGenie restarts).
- **Update notice.** "Update available" appears in the top bar when GitHub has a newer version. It only reads a version number and never changes anything itself.
- **Same look as the Live series.** LiveMic's colours, header and LivePi-style settings; Auto / Dark / Light theme; works one-handed on a phone at FOH.

## Install on TrueNAS

1. Create a dataset for LiveGenie, for example `/mnt/tank/apps/livegenie`, and give user 1000 write access to it (ACL entry for uid 1000, or `chown 1000:1000`).
2. Apps › Discover Apps › Custom App › **Install via YAML**, and paste [`truenas-app.yaml`](truenas-app.yaml). Change the host path and port if needed.
3. Open `http://<truenas-ip>:9090` and create the first admin. Add editors and volunteers in Settings › Users.

To update: when LiveGenie shows "Update available", edit the app in TrueNAS and save. The app uses the `latest` tag with `pull_policy: always`, so it pulls the new image. Your data stays in the dataset.

Keep the dataset in a TrueNAS snapshot schedule too, so a failed disk does not take the backups with it.

## Install with Docker Compose

```sh
docker compose up -d
```

Then open `http://<this machine>:8080`. See [`docker-compose.yml`](docker-compose.yml).

## Settings (environment)

| Variable | Default | What it does |
|---|---|---|
| `TZ` | (UTC) | Time zone for the nightly backup, e.g. `America/Chicago` |
| `PORT` | `8080` | Port inside the container |
| `LIVEGENIE_DATA` | `/data` | Where the database, pictures and backups are kept |
| `LIVEGENIE_BACKUP_AT` | `02:30` | Nightly backup time, 24 h local time |
| `LIVEGENIE_NO_UPDATE_CHECK` | | Set to `1` to turn off the GitHub version check |

## What is in the data folder

| Path | Holds |
|---|---|
| `livegenie.db` | Pages, versions, users, settings, activity log (SQLite) |
| `uploads/` | Pictures |
| `backups/` | Backup `.tar` files (open with any tar tool) |

## Network placement

Run it on the TrueNAS host and reach it from the AVL and office VLANs through the UDM Pro. Do not forward it to the internet, and block the Guest and IoT networks from it.

## Roadmap

| Version | Adds |
|---|---|
| 0.1.0 | Foundation (this release) |
| 0.2.0 | Document library, text extraction and OCR, AI drafts from the Jetson with citations, review queue |
| 0.3.0 | Ask the Genie: cited answers from approved pages, Sunday mode |
| 0.4.0 | Startup and shutdown checklists with logged runs and Bitfocus Companion button presses |
| 0.5.0 | Gear, ports, patching, VLANs and IP records; UniFi import |
| 0.6.0 | Interactive LAN map, patch scenes, printable patch sheets |
| 1.0.0 | A new volunteer runs a full Sunday startup from a phone with LiveGenie alone |

## Development

No outside packages. Needs Node.js 22.13 or newer (it uses Node's built-in SQLite).

```sh
npm start        # http://localhost:8080, data in ./data
npm test         # end-to-end tests on a temporary data folder
```

Pushing to `main` runs the tests, then builds `ghcr.io/leonidis2013/livegenie:latest` and `:<version>` for amd64 and arm64.
