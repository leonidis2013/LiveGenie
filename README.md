<p align="center"><img src="public/icons/livegenie-mark.svg" width="96" alt="LiveGenie"></p>

# LiveGenie

The Rolling Hills Community Church AVL knowledge base: one web app where volunteers find how our system works, how to run a service and how to fix what broke. Part of the Live series (LiveMic, LiveCompanion, LivePi, LiveVoice).

Version 0.11.0 · © 2026 Jerod Ulicki

## What it does

- **Spaces and pages.** Audio, Video & Stream, Lighting, Network, Volunteers and Services. A page is a stack of blocks: text, callouts (Tip, Warning, Sunday-critical), checklists, patch lists, IP lists, pictures and dividers.
- **Easy formatting.** The text editor works like a notes app: headings, bold, italic, bullet and numbered lists, links, tables and an **IP** style for addresses, from a toolbar. Typing `- `, `1. ` or `# ` at the start of a line also works. Pages are stored as Markdown; the **MD** button shows it for anyone who prefers typing it.
- **Audio training.** The Volunteers space starts with five audio training modules in signal-flow order: **Setting gain**, **High pass filter**, **Low pass filter**, **How EQ works** and **How a compressor works**, plus a pinned **Audio training: start here** page. Each has diagrams, starting settings for our sources, something to practise at the desk and check-yourself questions with answers. They are ordinary pages, so editors can change them; they are added once and deleted ones don't come back.
- **Shared checklists.** Everyone sees the same ticks, with who ticked each step and when (updates every 15 seconds). Anyone who can see the page can tick; signed-in people can reset.
- **Auto reset and done-by times.** Give a checklist reset times, such as "Sundays at 6:00 AM, done by 9:15 AM" or "Wednesdays at 5:00 PM". At each reset it starts empty.
- **To do list.** From its reset until the end of that day, a scheduled checklist sits at the top of the home page with its progress and due time. It turns red once the done-by time passes with steps left, and finished ones stay as green Done until the day ends. The header shows how many are open or overdue.
- **Overdue notices.** Optional: LiveGenie posts each overdue checklist once to a webhook, for example a Home Assistant automation that sends it to your phone (Settings › Notifications has the automation to paste).
- **Patch lists and cable runs.** Clean, spreadsheet-style grids with ready-made layouts (Input patch, Output patch, Cable runs, or your own columns). Columns that are the same on every row (the stage box, the link, the console) fold into one **Every row** line above the table, number columns stay narrow, and names autocomplete from the list and the device library. Each row has a **⋯** menu: Duplicate (for a double patch), Insert below, Make spare, Move, Delete. Spare rows hide behind **Show N spare**; rename, add or remove columns in **Columns**. Paste rows from a spreadsheet; typing in the last row adds the next one.
- **Guided equipment setup.** Devices › Guided setup walks through the console (SQ-5, SQ-6, SQ-7, X32, M32, TF5 or your own), the stage boxes (AR2412, AR84, AB168, DX168, S16, S32, DL16, DL32, Tio1608-D or your own: inputs, outputs, link, first console input) and the rest of the gear (wireless receivers and in-ear systems with how many of each, processor, amps, speakers). It creates the device cards with input and output counts and a **Stage patch** page with a Snake inputs and a Snake outputs list for each stage box, a **Wireless mics** list with a row per receiver channel, an **In-ears** list with a row per transmitter, plus a starting Main PA cable run list.
- **Stage boxes and digital snakes.** The **Snake inputs** layout starts with **Set up stage box inputs**: pick the box, its number of inputs, the link (SLink, AES50, Dante, Cat5) and the console, and it makes one row per stage box input already wired to a console input. Then assign a source and mic to each input, by typing or by drawing a source onto the stage box (it takes the next free input). Unassigned inputs stay as spares and fold away on the page. **Snake outputs** works the same way for the box's outputs: assign the mix and where each output goes. The trace draws the stage box with numbered sockets, one thick trunk for the link, and the console breaking out to its inputs.
- **Wireless mics and in-ears.** The **Wireless mics** layout follows a wireless channel from the person through the capsule and transmitter, over the air on its frequency, to the receiver channel, stage box and console input: Person → (capsule) → Transmitter ⌁ frequency ⌁ Receiver (Rx ch) → Stage box (box input) → Console → Input. **Add a wireless receiver** makes one row per receiver channel (SLX-D4D, ULX-D4Q, QLXD4, AD4Q, EW-DX and others fill in their channel count), already wired to the stage box and console. The **In-ears** layout runs the other way: Mix → Console (out) → Stage box (box output) → Transmitter (Stereo or Mono) ⌁ frequency ⌁ Bodypack → (earphones) → Person. **Add in-ear transmitters** makes one row per transmitter; stereo takes an output pair (5/6), mono one output. For a second person on the same mix, ⋯ › Duplicate the row. The radio hop is drawn as a dashed line with the frequency on it. The same frequency on two different transmitters is flagged anywhere in the list (524.125 and 524.125 MHz count as the same), as are two transmitters on one receiver channel; the same capsule model on several handhelds, or several bodypacks on one mix, are fine.
- **Column roles.** In Trace path each column is a **Box** (each name comes from one place, like a mic or a channel), **Shared gear** (many signals pass through it, like a stage box or console; never flagged as used twice) or a **Label on the line** (a stage box input number, a link), or a **Wireless link** (a frequency: a dashed line, checked across the whole list). Ports on shared gear are checked: two sources on AR2412 input 3 is a clash; one source on two console inputs is a double patch. Changing layout keeps columns with the same name.
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
- **Phone and desktop layouts.** One app, two layouts, picked by screen width (rotate an iPad and it switches):
  - **Desktop** (computers, and iPad in landscape): a sidebar with search (press **/**), Home, To do with its count, Devices, System map, every space with the one you are in opened to show its pages, New page, Update available, and your account and Settings. On wide screens each page has an **On this page** outline beside it that follows along as you scroll and jumps to a heading, checklist or patch list.
  - **Phone** (and iPad in portrait): a slim top bar and a bottom tab bar (**Home · To do · Search · Devices · More**) with the To do count on its tab. A **+** button in thumb reach makes a new page, dialogs slide up from the bottom, rows and buttons are bigger, and while editing the tabs make way for a Save bar. **More** holds the spaces, System map, Guided setup, Settings and your account.
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
| 0.6.0 | Names used twice: clashes highlighted, double patches recognised, Intended switch |
| 0.7.0 | Guided equipment setup, stage box snake inputs/outputs with spares, column roles, port-aware checks, stage box and trunk drawing |
| 0.8.0 | Cleaner patch table: Every row line, narrow number columns, row ⋯ menu, Columns dialog, autocomplete, hidden spares |
| 0.9.0 | Audio training modules in Volunteers: gain, high pass, low pass, EQ, compressor |
| 0.10.0 | Wireless mics and In-ears layouts, wireless link (frequency) checks, receiver and IEM setup, wireless in the guided setup |
| 0.11.0 | Phone layout (bottom tabs, + button, bottom sheets, To do screen) and desktop layout (sidebar with spaces and pages, On this page outline) (this release) |
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
