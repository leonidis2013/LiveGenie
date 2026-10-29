<p align="center"><img src="public/icons/livegenie-mark.svg" width="96" alt="LiveGenie"></p>

# LiveGenie

The Rolling Hills Community Church AVL knowledge base: one web app where volunteers find how our system works, how to run a service and how to fix what broke. Part of the Live series (LiveMic, LiveCompanion, LivePi, LiveVoice).

Version 0.6.0 · © 2026 Jerod Ulicki

## What it does

- **Spaces and pages.** Audio, Video & Stream, Lighting, Network, Volunteers and Services. A page is a stack of blocks: text, callouts (Tip, Warning, Sunday-critical), checklists, patch lists, IP lists, pictures and dividers.
- **Easy formatting.** The text editor works like a notes app: headings, bold, italic, bullet and numbered lists, links, tables and an **IP** style for addresses, from a toolbar. Typing `- `, `1. ` or `# ` at the start of a line also works. Pages are stored as Markdown; the **MD** button shows it for anyone who prefers typing it.
- **Shared checklists.** Everyone sees the same ticks, with who ticked each step and when (updates every 15 seconds). Anyone who can see the page can tick; signed-in people can reset.
- **Auto reset and done-by times.** Give a checklist reset times, such as "Sundays at 6:00 AM, done by 9:15 AM" or "Wednesdays at 5:00 PM". At each reset it starts empty.
- **To do list.** From its reset until the end of that day, a scheduled checklist sits at the top of the home page with its progress and due time. It turns red once the done-by time passes with steps left, and finished ones stay as green Done until the day ends. The header shows how many are open or overdue.
- **Overdue notices.** Optional: LiveGenie posts each overdue checklist once to a webhook, for example a Home Assistant automation that sends it to your phone (Settings › Notifications has the automation to paste).
- **Patch lists and cable runs.** Spreadsheet-style grids with ready-made layouts (Input patch, Output patch, Cable runs, or your own columns). Paste rows from a spreadsheet; Enter moves down a row.
- **Draw or type, interchangeably.** In the editor every patch list has **Table** and **Draw**. In Draw, the wire-trace columns become lanes of boxes: add boxes, then drag from a box's dot to another box (or tap the dot, then the box) to connect them. Tap a line to fill in the rest of that row (stand, cable type, length, route) or disconnect it; tap a box to rename or remove it. Every line is a row in the table, so you can switch back and forth freely. Device names autocomplete from the device library. On a page, editors get a **Draw** button on each patch list that opens it straight in Draw.
- **Names used twice.** Patch lists flag repeated names. If the rows agree on everything upstream it is a **double patch** (one source sent to several channels) and gets a quiet ⇉ mark. If different sources land on the same name, port or channel, it is a **clash**: highlighted in the table, the drawing and the trace, with a count on the page. Rename one (KSM137 #2) or tick **Intended**. Cable runs check only the cable label, since devices appear on many cables.
- **Wire trace.** Every patch list can draw its wiring (for an input patch: Source → Mic / DI → Stage box → Ch). Shared gear becomes one box; tap a box or line to follow the cable. Pick the columns and order in the editor.
- **Static IP lists.** Network name, VLAN, subnet and gateway, then the addresses. Duplicates, addresses outside the subnet and the gateway are flagged as you type; Next free IP and Fill a range generate addresses; each IP links to the device's web page.
- **Device library.** One card per device: photo, make and model, location, IP, MAC, manual link, nicknames and notes. Wherever a device's name, nickname or IP appears on any page (text, checklist steps, patch lists, IP lists), it links to its card automatically, with a quick card on hover. Each card lists everywhere it is **Used on**, and picks up its IP from any IP list row with its name. **Create from IP lists** makes cards for device names already in your IP lists.
- **System map.** Drawn from what is already in LiveGenie, so it is never out of date:
  - **Signal flow:** every patch list or cable run row that names two devices along its wire trace becomes an arrow (SB1 → SQ-5 → DriveRack PA2 → Crown → CBT tops). Everyone can see it.
  - **Network:** a tree built from **Plugged into** and **Port** on each device card (UDM Pro → USW-16-PoE → FOH switch → SQ-5), coloured by VLAN, with a VLAN filter. Editors and admins only.
  - Drag to pan, scroll or pinch to zoom, tap a box for its IP, VLAN, what it connects to and the pages that wire it. Editors can **Arrange** boxes and save the layout for everyone. Export PDF works here too.
- **VLANs.** A VLAN list with ID, name, subnet, gateway, DHCP range, purpose and colour. LiveGenie checks for duplicate IDs, overlapping subnets and a gateway outside its subnet, shows static/DHCP/free usage, and lists the devices in each VLAN by their IPs. **Create from IP lists** turns the networks in your IP lists into VLANs, and IP lists can fill their network details from a VLAN. Editors and admins only.
- **Network pages start as Tech only.** New pages in the Network space, and pages that get an IP list, start as Tech only (switch it off if you like).
- **Export PDF.** Every page has a PDF button with a clean print layout (logo, title, version, print date). On a computer choose Save as PDF; on an iPhone use Print, then Share › Save to Files.
- **Pictures, search, history, trash.** Phone photos (shrunk to 1600 px), instant search across text, checklists, patch and IP lists, every save kept as a version, deleted pages recoverable.
- **People and roles.** Name and PIN sign-in. Admin, Editor and Volunteer roles; **Tech only** pages are hidden from volunteers and anyone not signed in. Five wrong PINs lock that person for five minutes.
- **Backups and updates.** Nightly backups (02:30, kept 14 days), Back up now, download, upload and restore. "Update available" in the header when GitHub has a newer version.
- **Same look as the Live series.** LiveMic's colours, header and LivePi-style settings; Auto / Dark / Light; works one-handed on a phone at FOH.

## Install on TrueNAS

1. Apps › Discover Apps › Custom App › **Install via YAML**, and paste [`truenas-app.yaml`](truenas-app.yaml). Change the port if 9090 is taken.
2. Open `http://<truenas-ip>:9090` and create the first admin. Add editors and volunteers in Settings › Users.

Data is kept in the `livegenie-data` volume (internal storage, the same way LiveMic does it). It survives updates, restarts and edits of the app.

To update: when LiveGenie shows "Update available", edit the app in TrueNAS and save. The app uses the `latest` tag with `pull_policy: always`, so it pulls the new image.

**Keeping the data safe**

- Deleting the LiveGenie app in TrueNAS can delete its volume, and the nightly backups live in that same volume. Download a backup (Settings › Backups) before you ever delete or reinstall the app.
- Include the `ix-apps` dataset in a TrueNAS snapshot schedule; app volumes live there.
- Now and then, download a backup and keep it somewhere else (your NAS share, a USB stick at FOH).

Prefer a folder you can browse? Replace `livegenie-data:/data` with a host path such as `/mnt/tank/apps/livegenie:/data` and remove the `volumes:` section at the bottom. Give user 1000 write access to that dataset.

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

Checklist reset and done-by times use `TZ`, so set it to the church's time zone.

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
| 0.1.0 | Foundation: pages, search, history, roles, backups |
| 0.2.0 | Formatting editor, shared checklists with auto reset, To do list and overdue notices, patch lists with wire trace, IP lists, PDF export |
| 0.3.0 | Device library with automatic links and Used on lists; Network pages Tech only by default |
| 0.4.0 | System map (signal flow and network), VLAN list, Plugged into on device cards |
| 0.5.0 | Draw patch lists and cable runs by connecting boxes; drawing and table edit the same rows |
| 0.6.0 | Names used twice: clashes highlighted, double patches recognised, Intended switch (this release) |
| next | Document library, AI drafts from the Jetson, Bitfocus Companion buttons in checklists |
| later | Document library, AI drafts from the Jetson with citations, review queue, Ask the Genie |
| later | Bitfocus Companion buttons inside checklists |
| 1.0.0 | A new volunteer runs a full Sunday startup from a phone with LiveGenie alone |

## Development

No outside packages. Needs Node.js 22.13 or newer (it uses Node's built-in SQLite).

```sh
npm start        # http://localhost:8080, data in ./data
npm test         # end-to-end tests on a temporary data folder
```

Pushing to `main` runs the tests, then builds `ghcr.io/leonidis2013/livegenie:latest` and `:<version>` for amd64 and arm64.
