# AccessLoop

A database-driven web app where transit riders report accessibility barriers, such as broken elevators, icy stops and missing shelters, and see which problems keep coming back.

**Stack:** HTML, CSS, JavaScript · Leaflet maps · Node.js + Express 5 · PostgreSQL on Neon · Prisma 6 · Vercel

---

## Project structure

```
accessloop/
├── server.js            Express app: API routes, static files, error handling
├── routes/
│   ├── api.js           Public routes: reports, responses, stop search, insights
│   ├── trips.js         Trip planning: routes from Transitous, checked for barriers; place and address search
│   └── admin.js         Admin routes (need the admin passcode)
├── lib/
│   ├── rules.js         Status and editing rules, labels
│   ├── format.js        Builds titles, "last confirmed", flags and other derived values
│   ├── http.js          Errors, input checks, edit key hashing
│   ├── geo.js           Distances and route lines, for finding barriers on a route
│   └── prisma.js        Shared database client
├── prisma/
│   ├── schema.prisma    Database schema (5 tables)
│   └── seed.js          Sample data (every sample report is marked isSample)
├── public/              Front end (plain HTML, CSS and JavaScript, no build step)
│   ├── index.html       The map: browse barriers, plan a trip, report without leaving the map
│   ├── trip.html        Old address for trip planning; sends visitors to index.html
│   ├── report.html      Full report form in three steps
│   ├── explore.html     Every report on a map, with floating filters
│   ├── barrier.html     One barrier: status, responses, timeline, location history
│   ├── insights.html    Patterns: recurring spots, time to fix, reports per month
│   ├── admin.html       Accessibility team tools (needs the passcode)
│   ├── css/styles.css   Styles ported from the Figma design
│   ├── js/              One script per page, plus shared parts: api.js, ui.js, mapbase.js,
│   │                    pins.js (map pins), sheet.js (results card / bottom sheet), combobox.js (search
│   │                    suggestions), journey.js (route cards), barrier-card.js, pin-card.js (barrier card
│   │                    on its pin), quick-report.js (report pop-up)
│   ├── fonts/           DM Sans (self-hosted)
│   └── vendor/leaflet/  Leaflet 1.9.4 map library
├── AccessLoop.postman_collection.json
├── .env.example         Copy to .env and fill in
└── .gitignore           Keeps .env and node_modules out of GitHub
```

---

## Setup (Mac)

### 1. Install

You need Node.js 20.6 or newer. Check with `node -v`.

```bash
cd accessloop
npm install
```

`npm install` also runs `prisma generate`, which creates the Prisma Client.

### 2. Create the database on Neon

1. Sign in at neon.tech and create a project called **accessloop**.
2. On the project dashboard, click **Connect**.
3. Copy the connection string **with connection pooling on**. Its host contains `-pooler`.
4. Turn pooling off and copy the second string. It's the same, without `-pooler`.

### 3. Add your secrets

```bash
cp .env.example .env
```

Open `.env` and fill in:

- `DATABASE_URL`: the pooled string
- `DIRECT_URL`: the direct string
- `ADMIN_PASSCODE`: a passcode of your choice

### 4. Create the tables

```bash
npx prisma migrate dev
```

This reads `schema.prisma`, creates the five tables in Neon and saves the change in `prisma/migrations/`. Commit that folder.

### 5. Add the sample data

```bash
npm run db:seed
```

This adds 11 barrier types, 10 locations and 13 sample reports. You can run it again at any time: it replaces the sample reports and never touches real ones.

### 6. Run it

```bash
npm run dev
```

Open http://localhost:3000 to see the live map. The API is at http://localhost:3000/api/reports. To browse the database, run `npm run db:studio`.

### Updating an install made before the map

Locations now have map coordinates. If your database was created before this change, run these once:

```bash
npx prisma migrate dev --name add-coordinates
npm run db:seed
```

The first adds `latitude` and `longitude` to the `locations` table. The second gives the sample stops their coordinates.

---

## Testing with Postman

1. In Postman, click **Import** and choose `AccessLoop.postman_collection.json`.
2. Open the collection's **Variables** tab and set `adminPasscode` to the passcode in your `.env`.
3. Run **Create a report** first. It saves the new report's ID and edit key into the collection variables automatically, so the edit, response and admin requests use them.

The **Rule checks** folder holds requests that should fail, such as a wrong edit key, a status moving backwards, or a missing passcode. Each one shows a rule being enforced.

---

## Deploying to Vercel

1. Push the project to GitHub. Check that `.env` is **not** in the repo.
2. In Vercel, click **Add New → Project** and import the repo.
3. Under **Environment Variables**, add `DATABASE_URL`, `DIRECT_URL` and `ADMIN_PASSCODE`.
4. Click **Deploy**.

Vercel runs the Express app from `server.js` and serves `public/` directly. The tables already exist in Neon from step 4, so the deployed app uses the same database.

---

## Front end

Every page is a plain HTML file in `public/` with one JavaScript module. Pages get their data from the API with `fetch`, so nothing is hard-coded.

**Map-first layout.** The map and Explore pages work like a navigation app: the map fills the screen, and everything else floats over it.
- **Home page: the journey planner comes first.** A floating card at the top left has a start and a destination, both with suggestions as you type, plus a swap button, a step-free option and a departure time. Choose only a destination and it plans from your location. After planning, the card shrinks to a one-line summary you can click to edit, and a Clear button gives the whole map back.
- **Results appear in the same left column, under the planner, only when there's something to show:** route options (fewest barriers first), then the chosen route step by step, with its barriers, stops and transfers. On the map, the chosen route is highlighted, the others turn grey and unrelated pins fade. The rest of the time the map has the whole screen.
- **Choosing a pin opens a small card on the pin itself**, like tapping an alert in Waze: the barrier, its status, "Still broken" / "Fixed", and links to the full report, to report something else there, or to plan a trip there. The map stays usable: choose another pin to move the card, or close it with the X, Escape or a click on the map, and keyboard focus goes back to the pin. Barriers in a route's steps and in Explore's list open the same way, so the route or the list stays on the left. If the stop is inside a numbered bubble, the map zooms in to its pin first.
- **Browsing and filtering every barrier lives in Explore**, where the search, the filters and the list share a floating card on the left that folds away. Insights is linked from Explore and the footer rather than the main navigation.
- A floating **+ Report** button opens the **report pop-up** in the middle of the screen, with the map dimmed behind it. It's **one page**: where it is, what it is (11 barrier types as chips), and anything else riders should know, then the edit key. It fits a 720px-tall laptop screen without scrolling. Riders never leave the map or lose their route. Escape, the X or a click on the dimmed map closes it; a click outside never throws away a report being filled in or the edit key.
  - **"Where is it?" is a search box.** It finds AccessLoop's saved stops first, then any other transit stop the trip planner knows, so riders can report at a stop nobody has reported before. A line underneath confirms the stop.
  - **Reporting from your route:** every ride in a route's steps has "Report a barrier at: Get-on stop / Get-off stop". The pop-up opens with that stop already filled in, so the only thing left to choose is what the barrier is. A stop AccessLoop hasn't saved yet is added when the report is sent (or matched to the one it already knows, such as a station saved by its elevators and entrances).
  - **Riders never see or set severity.** Asking "how bad is it?" slowed reporting down and showing it added clutter, so the barrier type sets it behind the scenes (an elevator out of service is High, a missing bench is Low; see `defaultSeverity` in `lib/rules.js`). Only the accessibility team sees it, in the admin tools, where it helps sort the queue.
- **On phones**, the planner shows just the two fields until you use it, results and barrier details use a bottom sheet you can drag between three sizes, and the report pop-up fills the screen.

| Page | What it does |
|---|---|
| `index.html` | The map and journey planner. Pins merge into numbered bubbles when they're close together; tap one to see the barrier in a card on its pin and answer "Still there?". Plan a trip from any stop, station or address, or from your location. Step-free routing is on by default. Route options appear as cards under the planner, fewest barriers first; choosing one highlights it on the map, fades unrelated pins, and lists each step with the open barriers where you get on, transfer, get off or walk. "Locate me" centres the map on you and tells screen readers the closest barrier. Links like `index.html?to=lat,lng&toName=…` start a trip, `index.html?location=ID` opens a stop, and `index.html?report=1` opens the report pop-up. |
| `trip.html` | Kept so old links work: it forwards to `index.html` with the same trip details. |
| `report.html` | The full form, in three steps: barrier, location, details. "Use my location" sorts stops by distance. Warns if the same barrier is already open at that spot. Shows the edit key once. |
| `explore.html` | Every report on a map. Search and filters sit at the top of the left card (behind a Filters button on phones); below them, the card lists the reports in the part of the map you're looking at; choosing one opens its details in a card on its pin. Closed reports show as faded pins. Filters stay in the address bar so a filtered map can be shared. |
| `barrier.html?id=` | Status, rider responses, status timeline, location history and a small map. The reporter can edit with their key while the status is Reported. |
| `insights.html` | Totals and four charts, each with a "View as table" option. Linked from Explore and the footer. |
| `admin.html` | Passcode, queue (needs attention or all open), status updates with notes, duplicates and delete. The passcode is kept only for that browser tab. |

**Privacy:**
- "Locate me" on the map works out the closest barrier in the browser. The position isn't sent anywhere.
- Planning from "My location" sends your position to Transitous as the trip's start, and nothing else.
- "Use my location" in the report flow sends the position to the AccessLoop server once, to find nearby stops. It isn't saved.
- Trip planning sends the start and destination to Transitous to find routes. AccessLoop doesn't save them.
- Searching for a street address with a house number ("123 Main St") also sends what you typed to [Photon](https://photon.komoot.io), a free OpenStreetMap address search. It isn't saved either.
- The browser remembers which barriers you answered for 12 hours, so you don't answer twice by accident. That's stored only in your browser.

**Trip planning:** routes come from [Transitous](https://transitous.org), a free, community-run trip planner that covers the TTC, GO Transit, UP Express, YRT and MiWay, with no API key. Its [usage policy](https://transitous.org/api/) asks for non-commercial, open-source apps (hence the MIT licence in `LICENSE`), a link to its [data sources](https://transitous.org/sources/) (shown under the route options), a contact in the User-Agent (set in `routes/trips.js`, or with `APP_CONTACT` in `.env`) and light use. It's a best-effort community service, so the map explains when it's unavailable instead of breaking.

**Accessibility:** a skip link on every page and a "Skip the map" link past the pins; every pin can be reached with the keyboard and has a text label; Explore lists every report as text, so nothing depends on seeing the map; the search fields follow the standard combobox pattern (arrow keys, Enter, Escape); the panel's hidden content can't be reached by keyboard while it's closed; colour is never the only cue (each barrier type has its own icon); charts have table versions; animations respect "reduce motion". Checked with axe (no violations) at desktop and phone sizes, including the planner, barrier details, route options, route details and report pop-up states. The pop-up is a native `<dialog>`, so keyboard focus stays inside it and returns to where you were when it closes.

**Address search:** Transitous's search is strongest on stops, stations and streets, so when what you type starts with a house number ("123 Queen St W"), AccessLoop also asks [Photon](https://photon.komoot.io) by komoot, a free OpenStreetMap search made for search-as-you-type, with no key. Its results are limited to the Toronto area and listed first; the same address from both services is shown once. If Photon is slow or down, the search carries on with Transitous alone. The address lives in `routes/trips.js` (`PHOTON_URL`), so it can be pointed at another Photon server.

**Map images:** the map uses OpenStreetMap's own tiles, which need no API key. Their [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) asks for visible attribution (shown in the map's corner) and light use, which fits a student project. The tile address lives in one place, `public/js/mapbase.js`, so it's easy to switch. For example, CARTO's light style needs a free non-commercial key from [carto.com/basemaps/apikey](https://carto.com/basemaps/apikey).

**Credits:** map library [Leaflet](https://leafletjs.com) (BSD-2). Address search by [Photon](https://photon.komoot.io) (komoot). Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. Font: DM Sans (SIL Open Font License).

---

## API

| Method | Endpoint | What it does |
|---|---|---|
| GET | `/api/health` | Checks the database connection |
| GET | `/api/categories` | Barrier types, with each kind's response options |
| GET | `/api/locations` | Stations and stops, with map coordinates. Search with `q` (name, street, line or stop number) and/or `near=lat,lng` (nearest first), plus `limit` |
| GET | `/api/locations/:id` | One station or stop |
| GET | `/api/places` | Place search for trip planning (`q`): stops, stations, streets and places from Transitous, plus house-number addresses from Photon, in and around Toronto |
| GET | `/api/trips` | Routes from `from=lat,lng` to `to=lat,lng`, optional `time`, `arriveBy=true`, `stepFree=false`. Each route lists its barriers |
| GET | `/api/reports` | Browse reports. Filters: `q`, `locationId`, `categoryId`, `kind`, `severity`, `status` (`open`, `closed` or a status), `limit` |
| GET | `/api/reports/:id` | One report, with its status timeline, responses and location history |
| POST | `/api/reports` | Submit a report: `categoryId`, and either `locationId` (a saved stop) or `place` (`{ name, lat, lng }` for a stop from a planned route or the place search, which is matched to a saved stop nearby or added). Optional `severity` (set from the barrier type if left out) and `description`. Returns the edit key once |
| PUT | `/api/reports/:id` | Edit `description` (and `severity`, which the app no longer asks riders for). Needs the `X-Edit-Key` header |
| POST | `/api/reports/:id/responses` | Rider response: `value` (e.g. `STILL_BROKEN` or `FIXED`) |
| GET | `/api/insights` | Totals, reports by type, recurring locations, average time to fix, reports per month |
| GET | `/api/admin/reports` | Reports that need attention (`?view=open` for all open reports) |
| PATCH | `/api/admin/reports/:id/status` | Change status: `status`, optional `note`, `duplicateOfId` for duplicates |
| DELETE | `/api/admin/reports/:id` | Delete spam, along with its history and responses |

Admin routes need the `X-Admin-Passcode` header.

---

## Rules the API enforces

### Statuses

- **Broken equipment:** Reported → Under review → In progress → Resolved
- **Temporary condition:** Reported → Cleared
- **Missing infrastructure:** Reported → Acknowledged → Planned → Built / Not planned
- **Any kind:** Duplicate or Couldn't verify

Rules:

- Statuses only move forward. The admin can skip steps.
- Resolved, Cleared, Built, Not planned, Duplicate and Couldn't verify close a report. A closed report gets no more status changes or responses.
- Only Resolved, Cleared and Built set `resolvedAt`, so only real fixes count toward "average time to fix".
- Not planned and Couldn't verify need a note.
- A duplicate must point to an original report: not itself, and not another duplicate.
- A status change and its history record are saved in one transaction.

### Editing

- The edit key is shown once and stored only as a SHA-256 hash.
- The key lets the reporter edit the description (the API also accepts severity), and only while the status is still Reported.
- Barrier type and location can never change.
- The admin can't edit what a rider wrote.

### Rider responses

- Each kind has its own pair: Still broken / Fixed, Still present / Cleared, or Still missing / Now installed.
- Responses never change the official status. A "Fixed", "Cleared" or "Now installed" response newer than the last status change flags the report for the admin.
- A temporary condition with no "Still present" response for 48 hours shows "may have cleared".

### Deleting

- Deleting a report also deletes its history and responses.
- A report that has duplicates pointing to it is a real barrier, so it can't be deleted. Close it with a status instead.
