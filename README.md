# AccessLoop

A database-driven web app where transit riders report accessibility barriers, such as broken elevators, icy stops and missing shelters, and see which problems keep coming back.

**Stack:** HTML, CSS, JavaScript · Leaflet maps · Node.js + Express 5 · PostgreSQL on Neon · Prisma 6 · Vercel

**Project 2 version (DESN 31927, Persistent Data).** This version is the reporting and database core: riders report barriers, confirm or correct them, and the accessibility team updates their status. At my instructor's suggestion, step-free trip planning (Transitous) and place search (Photon) are part of Project 3 instead.

---

## Project structure

```
accessloop/
├── server.js            Express app: API routes, static files, error handling
├── routes/
│   ├── api.js           Public routes: reports, responses, stop search, insights
│   └── admin.js         Admin routes (need the admin passcode)
├── lib/
│   ├── rules.js         Status and editing rules, labels
│   ├── format.js        Builds titles, "last confirmed", flags and other derived values
│   ├── http.js          Errors, input checks, edit key hashing
│   ├── stops.js         Matching and sorting stations and stops
│   └── prisma.js        Shared database client
├── prisma/
│   ├── schema.prisma    Database schema (5 tables)
│   ├── seed.js          Sample data (every sample report is marked isSample)
│   ├── import-stops.js  Adds every TTC and GO station and stop to the database
│   ├── build-stops.js   Builds that list from the agencies' open data
│   └── data/stops.json  The list: about 9,900 stations and stops
├── public/              Front end (plain HTML, CSS and JavaScript, no build step)
│   ├── index.html       The map: browse barriers, check a stop, report without leaving the map
│   ├── report.html      Full report form in three steps
│   ├── explore.html     Every report on a map, with floating filters
│   ├── barrier.html     One barrier: status, responses, timeline, location history
│   ├── insights.html    Patterns: recurring spots, time to fix, reports per month
│   ├── admin.html       Accessibility team tools (needs the passcode)
│   ├── css/styles.css   Styles ported from the Figma design
│   ├── js/              One script per page, plus shared parts: api.js, ui.js, mapbase.js,
│   │                    pins.js (map pins), sheet.js (details card / bottom sheet), combobox.js (search
│   │                    suggestions), barrier-card.js, pin-card.js (barrier card on its pin),
│   │                    quick-report.js (report pop-up)
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

### 6. Add every station and stop

```bash
npm run db:import-stops
```

This adds about 9,900 TTC and GO stations and stops (subway, LRT, GO train, bus and streetcar), so riders can find any stop by its name or the stop number on the pole. It takes about a minute. You can run it again at any time: stops that are already saved, and their reports, are left alone.

### 7. Run it

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

### Adding the full stop list to an existing install

```bash
npm run db:deploy
npx prisma generate
npm run db:import-stops
```

The first adds the LRT station and GO station types to the database, the second updates the Prisma Client to match, and the third adds the stops.

### Refreshing the stop list

The TTC and Metrolinx update their schedules every few weeks, and stops change now and then. To refresh the list, download both GTFS zip files, unzip them, then run:

```bash
npm run db:build-stops -- --ttc path/to/ttc-folder --go path/to/go-folder
npm run db:import-stops
```

`build-stops.js` reads each agency's `stops.txt`, `routes.txt`, `trips.txt` and `stop_times.txt`. It groups each station's platforms into one station, works out which lines serve each stop and, for TTC stops, which way buses and streetcars travel there. Then it saves the result to `prisma/data/stops.json`.

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
- **Home page: check a station or stop.** A floating card at the top left searches the stations and stops saved in the database, with suggestions as you type. Choosing one opens its open barriers, or a short "nothing reported here" card with a button to report one.
- **Choosing a pin opens a small card on the pin itself**, like tapping an alert in Waze: the barrier, its status, "Still broken" / "Fixed", and links to the full report and to report something else there. The map stays usable: choose another pin to move the card, or close it with the X, Escape or a click on the map, and keyboard focus goes back to the pin. Barriers in Explore's list open the same way, so the list stays on the left. If the stop is inside a numbered bubble, the map zooms in to its pin first.
- **Browsing and filtering every barrier lives in Explore**, where the search, the filters and the list share a floating card on the left that folds away. Insights is linked from Explore and the footer rather than the main navigation.
- A floating **+ Report** button opens the **report pop-up** in the middle of the screen, with the map dimmed behind it. It's **one page**: where it is, what it is (11 barrier types as chips), and anything else riders should know, then the edit key. It fits a 720px-tall laptop screen without scrolling. Riders never leave the map. Escape, the X or a click on the dimmed map closes it; a click outside never throws away a report being filled in or the edit key.
  - **"Where is it?" is a search box.** It finds the stations and stops saved in the database, by name, line or stop number. A line underneath confirms the stop.
  - **Riders never see or set severity.** Asking "how bad is it?" slowed reporting down and showing it added clutter, so the barrier type sets it behind the scenes (an elevator out of service is High, a missing bench is Low; see `defaultSeverity` in `lib/rules.js`). Only the accessibility team sees it, in the admin tools, where it helps sort the queue.
- **On phones**, the stop search shows just its field until you use it, barrier details use a bottom sheet you can drag between three sizes, and the report pop-up fills the screen.

| Page | What it does |
|---|---|
| `index.html` | The map. Pins merge into numbered bubbles when they're close together; tap one to see the barrier in a card on its pin and answer "Still there?". Search for a station or stop to check it before you go. "Locate me" centres the map on you and tells screen readers the closest barrier. `index.html?location=ID` opens a stop, and `index.html?report=1` opens the report pop-up. |
| `report.html` | The full form, in three steps: barrier, location, details. "Use my location" sorts stops by distance. Warns if the same barrier is already open at that spot. Shows the edit key once. |
| `explore.html` | Every report on a map. Search and filters sit at the top of the left card (behind a Filters button on phones); below them, the card lists the reports in the part of the map you're looking at; choosing one opens its details in a card on its pin. Closed reports show as faded pins. Filters stay in the address bar so a filtered map can be shared. |
| `barrier.html?id=` | Status, rider responses, status timeline, location history and a small map. The reporter can edit with their key while the status is Reported. |
| `insights.html` | Totals and four charts, each with a "View as table" option. Linked from Explore and the footer. |
| `admin.html` | Passcode, queue (needs attention or all open), status updates with notes, duplicates and delete. The passcode is kept only for that browser tab. |

**Privacy:**
- "Locate me" on the map works out the closest barrier in the browser. The position isn't sent anywhere.
- "Use my location" in the report flow sends the position to the AccessLoop server once, to find nearby stops. It isn't saved.
- The browser remembers which barriers you answered for 12 hours, so you don't answer twice by accident. That's stored only in your browser.

**Accessibility:** a skip link on every page and a "Skip the map" link past the pins; every pin can be reached with the keyboard and has a text label; Explore lists every report as text, so nothing depends on seeing the map; the search fields follow the standard combobox pattern (arrow keys, Enter, Escape); the panel's hidden content can't be reached by keyboard while it's closed; colour is never the only cue (each barrier type has its own icon); charts have table versions; animations respect "reduce motion". The pop-up is a native `<dialog>`, so keyboard focus stays inside it and returns to where you were when it closes.

**Map images:** the map uses OpenStreetMap's own tiles, which need no API key. Their [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) asks for visible attribution (shown in the map's corner) and light use, which fits a student project. The tile address lives in one place, `public/js/mapbase.js`, so it's easy to switch. For example, CARTO's light style needs a free non-commercial key from [carto.com/basemaps/apikey](https://carto.com/basemaps/apikey).

**Credits:** map library [Leaflet](https://leafletjs.com) (BSD-2). Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. Station and stop list from TTC schedule data published by the [City of Toronto](https://open.toronto.ca) (contains information licensed under the Open Government Licence – Toronto) and GO Transit schedule data from [Metrolinx](https://www.metrolinx.com/en/about-us/open-data) (Open Government Licence – Ontario). Font: DM Sans (SIL Open Font License).

---

## API

| Method | Endpoint | What it does |
|---|---|---|
| GET | `/api/health` | Checks the database connection |
| GET | `/api/categories` | Barrier types, with each kind's response options |
| GET | `/api/locations` | Stations and stops, with map coordinates (all of them, about 9,900, if there is no search). Search with `q` (name, street, line or stop number) and/or `near=lat,lng` (nearest first), plus `limit` |
| GET | `/api/locations/:id` | One station or stop |
| GET | `/api/reports` | Browse reports. Filters: `q`, `locationId`, `categoryId`, `kind`, `severity`, `status` (`open`, `closed` or a status), `limit` |
| GET | `/api/reports/:id` | One report, with its status timeline, responses and location history |
| POST | `/api/reports` | Submit a report: `categoryId`, and either `locationId` (a saved stop, which is what the website sends) or `place` (`{ name, lat, lng }` for a stop that isn't saved yet, which is matched to a saved stop nearby or added). Optional `severity` (set from the barrier type if left out) and `description`. Returns the edit key once |
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
