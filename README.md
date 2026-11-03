<p align="center"><img src="public/icons/livegenie-mark.svg" width="96" alt="LiveGenie"></p>

# LiveGenie

The Rolling Hills Community Church AVL knowledge base: one web app where volunteers find how our system works, how to run a service and how to fix what broke. Part of the Live series (LiveMic, LiveCompanion, LivePi, LiveVoice).

Version 0.23.1 · © 2026 Jerod Ulicki

## What it does

- **Spaces and pages.** Admins make the spaces that suit them (Audio, Video, Training, Kids…), with a colour and an order, in Admin › Spaces; a new LiveGenie starts with none (one click adds a church AVL starter set, another the audio training pages). A page is a stack of blocks: text, callouts (Tip, Warning, Sunday-critical), patch lists (from the stage patch), IP lists, pictures and dividers.
- **Easy formatting.** The text editor works like a notes app: headings, bold, italic, bullet and numbered lists, links, tables and an **IP** style for addresses, from a toolbar. Typing `- `, `1. ` or `# ` at the start of a line also works. Pages are stored as Markdown; the **MD** button shows it for anyone who prefers typing it.
- **Audio training.** Admin › Spaces › **Add the audio training pages** adds five audio training modules (to Volunteers or Training) in signal-flow order: **Setting gain**, **High pass filter**, **Low pass filter**, **How EQ works** and **How a compressor works**, plus a pinned **Audio training: start here** page. Each has diagrams, starting settings for our sources, something to practise at the desk and check-yourself questions with answers. They are ordinary pages, so editors can change them; they are added once and deleted ones don't come back.
- **Shared checklists.** Everyone sees the same ticks, with who ticked each step and when (updates every 15 seconds). Everyone signed in can tick, so every tick has a name; admins can reset.
- **Auto reset and done-by times.** Give a checklist reset times, such as "Sundays at 6:00 AM, done by 9:15 AM" or "Wednesdays at 5:00 PM". At each reset it starts empty.
- **To do list.** Any checklist someone has started and not finished, and a scheduled checklist from its reset until the end of that day, sits in a highlighted strip at the top of the home page with its progress, who ticked last and a Continue button; **To do** in the sidebar (and the To do tab on a phone) glows amber while one is open, red when one is overdue. It turns red once the done-by time passes with steps left, and finished ones stay as green Done until the day ends. The header shows how many are open or overdue.
- **Overdue notices.** Optional: LiveGenie posts each overdue checklist once to a webhook, for example a Home Assistant automation that sends it to your phone (Settings › Notifications has the automation to paste).
- **Stage patch.** One drawing of the whole sound system. Cards sit wherever you put them; **Tidy** lines them up left to right in signal-flow order (Sources → Wireless → Stage I/O → Network → Mix → Processing → Amps · IEM → Speakers · monitors). Cards glow by equipment type and every line is styled by its cable (analog XLR, SLink/AES50 digital snake, Dante, AES, speaker, wired IEM), with a key at the bottom. Cables run at right angles **around** the cards, spread apart where they run side by side, with a small hop where two cross. Everyone can see it at **Stage patch** in the sidebar (or More on a phone).
  - **Follow a signal.** Click any card, socket or cable and its whole path lights up, mic to console or mix to speaker (the pastor's lav ⌁ SLX-D4 → AR2412 In 17 → SLink → SQ-5 input 17), and everything else steps back.
  - **Cards show what is used.** A card lists the sockets in use and folds the rest into "+ 22 free in · 11 free out"; tap that (or **Show every socket**) to open the card fully. A stage box shows which console channel each input lands on (In 23 → Ch 23); a console lists its **SLink channels** (Ch 23 ← AR2412 In 23 · Lead vocal); the SLink line between them is a thick snake labelled with how many inputs and outputs it carries.
  - **Channel names and colours.** Each source (mic, wireless mic, DI, line) can carry the name and colour its console channel shows (WMIC-1, Kyle, KICK; Red). Each console knows how many letters a name can have and which colours it has, set when it was added, so names fit the desk: the name box stops at that length, the colour is picked from the desk's own list, and a name or colour that does not fit is flagged. The console's **Channel names and colours** list shows every channel at once, fills empty names from who uses it, what it is for, or numbered by type (WMIC-1, MIC-1, DI-1, LINE-1), and downloads as a spreadsheet (CSV) to type into the desk. Names show on the console card and in the input list.
  - **Wireless systems.** A receiver is one card with the mics on its channels (Ch 1 · Sarah · Beta 58A · 518.200), an IEM transmitter one card with its packs (Pack · Mike · Drums). Add a mic or pack from its menu; no RF lines to draw. **Who uses it**: mics, capsules, DIs, wedges and IEM packs can be tagged with a person (from your team or typed), shown on the card, in the lists and found by search.
  - **Drawing it.** Admins tap **Edit**: the right pane adds equipment from the Gear Locker or **your model list**. There is no built-in gear list: the **New gear** form takes the type, make and model (and its inputs, outputs, channels or link), adds it to the drawing and remembers the model, so the list grows with your own gear and the next SQ-5 or SLX-D4D is one tap (× takes one off the list). **Auto-arrange** lays the whole drawing out once by signal flow (each card one column right of what feeds it, lined up to cut crossings); undo puts it back. **Label cables** names cables from a pattern ({to} {toNum} → Stage box 23, {ch} {name} → 23 WMIC-1, C{n} → C01…), only the unlabelled ones or all of them, with a preview. The equipment pane opens only when something is picked or with **Add equipment**. Drag a card to move it: it **snaps** to the grid and to the edges and centres of nearby cards (pink guides; hold Alt to place freely); shift-click or shift-drag selects several, which you can line up or space evenly. Drag a card's **→** onto another card to connect: a picker offers the next free sockets, how many in a row, the cable type and label; stage box onto console links them and can assign box inputs to console channels (In 1–24 → Ch 1–24). Or drag from one socket straight to another. **Right-click** (long-press on a phone) for the menu: follow its signal, edit, tag a person, connect to…, add a mic or pack, assign console channels, show every socket, duplicate, remove; on a cable, its type, label or remove; on the background, add equipment there, tidy up, select all, snap, zoom to fit, PDF. Arrow keys nudge. Undo and redo; it saves itself as you go; **History** keeps every version (the newest 200) and can restore one.
  - **Checks.** Two transmitters on one frequency, two sockets landing on one console channel, a stage box input in use but not assigned to a console channel, a stage box not linked to a console, and gear with the same name are listed under the drawing; tap one to see it.
  - **The lists are made from the drawing**: Inputs (channel, source, mic or DI, wireless capsule/frequency/receiver, stage box input), Outputs (mix, socket, where it ends up through processors and amps), Wireless, In-ears (mix, mode, frequency, who wears which pack) and Cables. Tap a row to find it on the drawing. **PDF** prints the drawing and every list.
  - **Patch lists on pages.** Add a **Patch list** block to any page to show one of those lists, optionally only for some gear (AR2412, Drums). It always matches the drawing.
  - **Moving from older versions.** On the first start, the old table-style patch lists (snake inputs and outputs, input and output patches, cable runs, wireless, in-ears) are drawn onto the stage patch, and each one on its page becomes a live Patch list. The page's previous version stays in History; custom lists become a plain table.
  - **Everywhere else.** Search finds gear on the patch (a person, a frequency, a model); a device card lists the stage patch under Used on; the System map's signal flow is drawn from it; Guided setup puts the console, stage boxes, wireless, in-ears and PA straight onto it.
- **Guided equipment setup.** Gear Locker › Guided setup walks through the console (SQ-5, SQ-6, SQ-7, X32, M32, TF5 or your own), the stage boxes (AR2412, AR84, AB168, DX168, S16, S32, DL16, DL32, Tio1608-D or your own: inputs, outputs, link, first console input) and the rest of the gear (wireless receivers and in-ear systems with how many of each, processors, amps, speakers: from your list or typed in). Every new make and model goes on your list. It makes the Gear Locker cards and puts it all on the stage patch: each stage box linked to the console (you assign which console channel each input lands on in the stage patch), and optionally the PA wired console → processor → amps → speakers as a starting point. Then add the mics and draw the cables.
- **Static IP lists.** Network name, VLAN, subnet and gateway, then the addresses. Duplicates, addresses outside the subnet and the gateway are flagged as you type; Next free IP and Fill a range generate addresses; each IP links to the device's web page.
- **Gear Locker.** One card per piece of gear, sorted into **buckets** (Mics & wireless, In-ears, Stage I/O, Mixing, Processing, Amps, Speakers & monitors, Video, Lighting, Network…) by what it is; tap a bucket to filter, fold a bucket away. Admins can rename and reorder buckets, add their own (Spares, Youth room) and move a card to another one (Edit › Bucket). Cards show location, IP, who uses it and how many manuals. Each card has a photo (admins can **highlight on the photo**: drag boxes around the power switch, a reset button or the inputs, name them and pick a colour; everyone sees the numbered boxes and their list, and hovering one lights it up), make and model, location, IP, MAC, manual link, nicknames and notes. Wherever a device's name, nickname or IP appears on any page (text, checklist steps, patch lists, IP lists), it links to its card automatically, with a quick card on hover. Each card lists everywhere it is **Used on**, and picks up its IP from any IP list row with its name. **Create from IP lists** makes cards for device names already in your IP lists.
- **System map.** Drawn from what is already in LiveGenie, so it is never out of date:
  - **Signal flow:** every cable or link on the stage patch between two devices with device cards becomes an arrow (AR2412 → SQ-5 → DriveRack PA2 → Crown → CBT tops). Everyone can see it.
  - **Network:** a tree built from **Plugged into** and **Port** on each device card (UDM Pro → USW-16-PoE → FOH switch → SQ-5), coloured by VLAN, with a VLAN filter. Admins only.
  - Drag to pan, scroll or pinch to zoom, tap a box for its IP, VLAN, what it connects to and the pages that wire it. Admins can **Arrange** boxes and save the layout for everyone. Export PDF works here too.
- **VLANs.** A VLAN list with ID, name, subnet, gateway, DHCP range, purpose and colour. LiveGenie checks for duplicate IDs, overlapping subnets and a gateway outside its subnet, shows static/DHCP/free usage, and lists the devices in each VLAN by their IPs. **Create from IP lists** turns the networks in your IP lists into VLANs, and IP lists can fill their network details from a VLAN. Admins only.
- **Admins-only spaces.** Mark a space Admins only (Network is, in the starter set) and users do not see it, its pages, or them in search. This replaces the per-page Tech only switch from older versions.
- **Export PDF.** Every page has a PDF button with a clean print layout (logo, title, version, print date). On a computer choose Save as PDF; on an iPhone use Print, then Share › Save to Files.
- **Pictures, search, history, trash.** Phone photos (shrunk to 1600 px), instant search across text, checklists, patch and IP lists, every save kept as a version, deleted pages recoverable.
- **Admins and users.** Everyone signs in; nothing shows before that. **Admins** build LiveGenie: spaces, pages, the stage patch, devices, IP lists, VLANs, manuals, people and backups. **Users** read the help pages, tick checklists, follow signals on the stage patch, open manuals and report problems. **View as user** (sidebar, or More on a phone) shows an admin exactly what users see, with a banner to switch back. Five wrong PINs lock that person for five minutes. Upgrading turns Editors into Admins and Volunteers into Users.
- **Admin area.** Admin in the sidebar (More on a phone): Spaces, People, Problems, Checklist log, Church, Notifications, Backups, Trash, Activity and Reset. Users never see it.
- **Manuals and documents.** Upload PDF manuals, quick-start guides, wiring diagrams (PDF, pictures, text, Word, Excel or zip, up to 60 MB) to any device card. Everyone signed in can open them in the browser or download them; they are stored in LiveGenie and included in backups. Gear on the stage patch shows how many manuals its device has.
- **To do lists.** Every checklist lives on one page, **To do**, organised in groups (Sunday morning, After service, Audio…), not on help pages. Tap a list to open it and tick its steps; everyone sees the same ticks, who ticked what and when, and **Start over** clears it. A list is open while someone has started it and not finished; a list with reset times opens at each reset until the end of that day and turns red after its done-by time. Admins manage them in **Admin › To do lists**: make a list (group, title, steps one per line, reset times), edit it or move it to another group, reorder lists, start over, remove; **Groups** adds, renames, reorders and removes groups. Upgrading moves each checklist that was on a page to To do, in a group named after its page, with its ticks and log; the page keeps a line pointing to it.
- **Report a problem.** Users tap **Report a problem** on a page, a device card or a piece of gear on the stage patch ("Pastor lav cuts out when he turns his head"). Admins see an open-problems count beside Admin, work through them in Admin › Problems (resolve with a note, reopen), and the Notifications webhook hears about each new one.
- **Checklist log.** Every run of every checklist: when it ran, how many steps were done, when it was finished and by whom, how long it took, and what was missed. Filter by checklist in Admin › Checklist log.
- **Church name and logo.** Set in Admin › Church (or at first-run setup); shown on the sign-in screen, the home page and every PDF.
- **Reset.** Admin › Reset: **Clear content** removes every page, space, device, the stage patch, IP lists, VLANs, pictures, manuals, problem reports and the checklist log, keeping people and settings; **Factory reset** removes everything and goes back to the first-run setup. Type RESET to confirm; a backup is made first, so either can be undone by restoring it.
- **Easy sign in on a phone.** Tap your name (each phone or computer remembers who has signed in on it; × forgets a name), then type your PIN on a big lock-screen style pad. A computer keyboard works too. Or skip typing altogether: on a computer where you are signed in, **Settings › Account › Sign in on your phone** shows a QR code; point the phone's camera at it and tap the link. Admins can make one for anyone in **Settings › Users › Phone**, handy when setting up a new volunteer. Each code works once, for 5 minutes. Phones stay signed in for 60 days from their last use. (Face ID or fingerprint sign-in, called passkeys, needs LiveGenie on HTTPS with a domain name, so it is not offered on a plain network address.)
- **Backups and updates.** Admin › Backups: nightly backups (02:30, kept 14 days), Back up now, download, upload and restore. "Update available" in the header when GitHub has a newer version.
- **Phone and desktop layouts.** One app, two layouts, picked by screen width (rotate an iPad and it switches):
  - **Desktop** (computers, and iPad in landscape): a sidebar with search (press **/**), Home, To do with its count (it glows while a checklist is open), Gear Locker, Stage patch, System map, the **Admin** group for admins (Users, Spaces, Problems, Checklist log, Guided setup, Church, Notifications, Backups, Trash, Activity, Reset), every space with the one you are in opened to show its pages, New page, Update available, and your account and Settings. On wide screens each page has an **On this page** outline beside it that follows along as you scroll and jumps to a heading, checklist or patch list.
  - **Phone** (and iPad in portrait): a slim top bar and a bottom tab bar (**Home · To do · Search · Gear · More**) with the To do count on its tab. A **+** button in thumb reach makes a new page, dialogs slide up from the bottom, rows and buttons are bigger, and while editing the tabs make way for a Save bar. **More** holds the spaces, System map, Guided setup, Settings and your account.
- **Same look as the Live series.** LiveMic's colours, header and LivePi-style settings; Auto / Dark / Light; works one-handed on a phone at FOH.

## Install on TrueNAS

1. Apps › Discover Apps › Custom App › **Install via YAML**, and paste [`truenas-app.yaml`](truenas-app.yaml). Change the port if 9090 is taken.
2. Open `http://<truenas-ip>:9090`, enter the church name and create the first admin. Add people in Admin › People and make your spaces in Admin › Spaces.

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
| 0.11.0 | Phone layout (bottom tabs, + button, bottom sheets, To do screen) and desktop layout (sidebar with spaces and pages, On this page outline) |
| 0.12.0 | Phone sign in: tap your name, PIN pad, and QR code sign in from a signed-in computer |
| 0.13.0 | Stage patch: one visual signal-flow drawing for the whole system (equipment pane, drag to connect, follow a signal, overview and sockets, cable styles, checks), with the input, output, wireless, in-ear and cable lists and the PDF made from it; old patch lists moved onto it |
| 0.23.1 | Wireless mics and in-ear packs are no longer drawn twice: opening the stage patch links ones already on the drawing to their Gear Locker cards (by name) instead of adding copies, and removes copies an earlier version made; when a receiver is full it says so instead of drawing a loose copy. The PDF report lists wireless receivers (with location and network) under Microphones and in-ear transmitters under In-ear monitors, and no longer repeats them under Equipment (this release) |
| 0.23.0 | **Stage patch:** auto-arrange by signal stage (sources → stage I/O → console → processing → amps → outputs, unconnected gear in its own row); a key at the bottom listing only what is drawn; wireless systems in dashed boxes (mics left of the receiver, packs right of the in-ear transmitter, RF lines with frequency and band colour, fold to one card); frequency checks (same or within 0.4 MHz); spares; network sockets, switches with ports and network cables that fill in Plugged into; **Auto label** for tag names (RX-1, WMIC-1 Kyle, SB-A, PA-AMP1…) and cable names that say what they do (IN-A12, OUT-001, SPK-001, LNK-001, NET-001); a Select tool to box and move groups; a Fit button; a reorganised Add equipment pane; revisions numbered major.minor.patch (autosaves fold into one draft, Publish on Done); a professional PDF report (title page, contents, landscape drawing, microphones, in-ears, equipment with IP addresses, cables, things to check). **Gear Locker:** Wired mics, Wireless mics, Receivers, Capsules and In-ears buckets; subtitles that say what each card is; TAG (MODEL) in every picker; Tag name with Auto label; near-duplicate check with Merge; pairing shared with the stage patch. **Guided setup:** grouped Wireless / In-ears / PA, counts on every row, tag names on what it makes. PDFs save as church, title, date and revision |
| 0.22.3 | System map no longer fails to open when gear feeds each other in a loop (a stage box that feeds the console and is fed by it) |
| 0.22.2 | A wireless mic's **Capsule** is picked from the capsule cards in the Gear Locker, or **+ New capsule…** makes one right there; swapping it onto another mic takes it off the old one; the mic card links its capsule (a typed capsule still works) |
| 0.22.1 | Home's Get started card: each step drops off once it is done (spaces, equipment setup, people, church name and logo), shows how many are done, and goes away when all are, or with Hide |
| 0.22.0 | Gear knows what it is: a "What is it?" pick on every card (mic, wireless mic, capsule, receiver, speaker…) sorts it into the right bucket; wireless mics pair with their receiver (type, capsule, frequency) and capsules with their mic, listed on the receiver card with an Add button; "How many?" adds several numbered mics at once; the Speakers bucket (was Speakers & monitors); gear already on your model list learns its kind; manuals and the manufacturer's page in one place on the card and in Edit; the guided equipment setup runs once, then lives under Admin › Equipment setup |
| 0.21.1 | Opening LiveGenie (or signing in) on an old link to a page or gear that is gone goes to Home instead of "Page not found"; a clearer message with Home and Search when you follow one inside the app |
| 0.21.0 | Stage patch easier to read and use: bigger cards and text that never overlaps, a taller drawing, the equipment pane only when you need it, **Auto-arrange** (one-time layout by signal flow), **Label cables** (smart labels from a pattern), checks as a list, clearer "Cables in a row"; wireless channels get a transmitter (type, make, model, frequency) and a capsule or mic, added from "+ transmitter" on the receiver; no specific gear names anywhere in the app; Gear Locker: location picked from a list (+ New location), filter and group by location, IP/MAC/plugged-into only when "On the network" is ticked |
| 0.20.0 | To do lists live on one page, in groups, not on help pages: tick them on To do; Admin › To do lists makes, edits, moves and orders lists and groups; checklists on pages move there with their ticks and log |
| 0.19.0 | Admin › To do lists: every checklist in one place; make, edit (steps and reset times), start over and remove |
| 0.18.0 | Highlight boxes on a gear photo: drawn, moved, resized, named and coloured by admins; numbered on the card with a list everyone can hover |
| 0.17.0 | No built-in gear list: makes and models are added as you go (New gear form, guided setup) and remembered on your own model list; channel names and colours for each source, fitted to each console's name length and colours (set when the console is added), with fill-in helpers and a CSV list |
| 0.16.0 | Stage patch you arrange yourself: free placement with Tidy, snapping, smart guides and align; cards fold to the sockets in use; cables route around cards with hops; right-click menu; card-to-card connect picker; wireless systems (mics on receiver channels, packs on IEM transmitters) and who uses each; stage box channels assigned by hand, SLink channels on the console. Devices is now the **Gear Locker** with buckets. To do shows checklists in progress and glows; new Home page; Admin group in the sidebar; thin View-as-user bar |
| 0.15.0 | New sign-in screen: full screen with the church name and logo on a branded panel (computers) or a clean single column (phones), bigger name field and Continue button, clearer PIN pad, help for forgotten PINs |
| 0.14.1 | Updates always load straight away: the page names its code with the version, so a browser can no longer keep running old screens after an update |
| 0.14.0 | Admins and users with sign-in required, admin-made spaces (colour, order, admins only), Admin area, manuals on device cards, problem reports, checklist log, church name and logo, View as user, clear content and factory reset |
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
