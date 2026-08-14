# Jenkins Test Farm Dashboard

## Project Overview
A Dockerized web dashboard for monitoring Jenkins test build statuses in real-time. Built with Node.js + Express backend and Vanilla HTML/CSS/JS frontend, running on port 4000.

## Architecture
- **Backend**: Node.js + Express API server proxies Jenkins API requests, caches build data, manages user configuration
- **Frontend**: Vanilla HTML/CSS/JS single-page dashboard with card-based UI
- **Storage**: JSON file (`/data/config.json`) persisted via Docker Volume
- **Update**: Backend polls Jenkins every 60 seconds; frontend fetches cached data every 60 seconds

## Key Features
- Card-based build status display, mapped from the Jenkins ball colour:
  | Jenkins `color` | Card status |
  |---|---|
  | `*_anime` (or `lastBuild.building`) | BUILDING (checked first) |
  | `blue` | SUCCESS |
  | `red` | FAILURE |
  | `yellow` | UNSTABLE (Jenkins yellow means unstable, **not** running) |
  | `aborted` / `disabled` / `notbuilt` / `grey` | ABORTED / DISABLED / NOT BUILT |
- **Recently-finished highlight**: the single most recently *finished* build across all
  cards pulses with a coloured glow + 「🆕 剛完成」 badge for 8 hours after it finishes,
  and is mirrored as a chip in the toolbar (the card may be on another page).
  Finish time is `timestamp + duration`, since Jenkins `timestamp` is the build *start*.
- Grid layout: 3x3, 4x4, 5x5 switchable; cards shed their lower rows via CSS
  `@container` queries as the grid gets denser, so the board never scrolls
- Auto-pagination with rotation (`settings.autoRotateInterval`, default 30s);
  rotation is skipped entirely when there is only one page
- Last 10 builds trend chart per card (right-aligned, DPR-aware, theme-coloured)
- Card alias customization, drag-and-drop reorder (config page only)
- Light/dark theme toggle
- Work hours only (Mon-Fri 9:00-18:00): frontend stops polling and shows overlay outside work hours
- Stale-data warning in the toolbar when the backend poll has not succeeded for 5 minutes

## Project Structure
```
TestFarmDashBoard/
├── server/
│   ├── index.js        # Express server entry
│   ├── jenkins.js       # Jenkins API module
│   ├── store.js         # JSON file storage
│   ├── scheduler.js     # Polling scheduler + memory cache
│   └── routes.js        # API route definitions
├── public/
│   ├── index.html       # Dashboard page
│   ├── config.html      # Configuration page
│   ├── css/style.css    # Design tokens + themes + grid + cards
│   └── js/
│       ├── dashboard.js # Dashboard logic + polling + pagination
│       └── config.js    # Config page logic + drag-drop + CRUD
├── data/                # Docker Volume mount (config.json)
├── Dockerfile
├── docker-compose.yml
├── package.json
└── README.md
```

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/jenkins/test` | Test Jenkins connection |
| POST | `/api/jenkins/save` | Save Jenkins credentials |
| GET | `/api/jenkins/config` | Get Jenkins config (password masked) |
| GET | `/api/jenkins/jobs` | List all Jenkins jobs |
| GET | `/api/dashboard/data` | Get cached build data for all cards (map of jobName → detail) |
| GET | `/api/dashboard/state` | **Preferred.** Cards + build data + settings + `serverTime` in one round-trip; `serverTime` lets the browser correct a skewed kiosk clock |
| POST | `/api/cards` | Add monitoring card |
| DELETE | `/api/cards/:id` | Remove card |
| PUT | `/api/cards/:id` | Update card (alias, etc.) |
| PUT | `/api/cards/reorder` | Batch reorder cards |
| GET | `/api/settings` | Get display settings |
| PUT | `/api/settings` | Update display settings |

## Jenkins Connection
- Server: `http://10.88.95.1:8080/`
- Auth: Basic Auth via Jenkins JSON API
- Credentials stored in backend JSON file, entered once via config page

## Development
```bash
npm install
npm run dev       # Development with --watch
npm start         # Production
```

## Docker
```bash
docker-compose up -d          # Start
docker-compose down           # Stop
docker-compose up -d --build  # Rebuild & start
```
Port 4000 is used (avoids 8080 and 3000 conflicts).

## Conventions
- All frontend code uses Vanilla JS (no frameworks)
- CSS uses Custom Properties for theming
- HTML5 Drag & Drop API for card reordering
- Canvas API for trend charts
- Single global configuration (shared across all viewers)

## Gotchas
- The server returns the Jenkins ball colour as `status`, **not** `color`. The
  dashboard reads `card.status`.
- `lastBuild.duration` is `0` while a build is running — fall back to
  `lastDuration` (from `lastCompletedBuild`) so the card does not show "N/A".
- The dashboard reuses card DOM nodes keyed by `card.id` and only rebuilds the
  grid on a page turn or layout change. A plain 60s data refresh updates text in
  place, so it no longer flickers or replays the entry animation. If you add a
  field to a card, add a ref in `createCardNode` and set it in `updateCardNode` —
  do not go back to rebuilding `innerHTML` on every refresh.
- `store.getConfig()` is cached in memory and invalidated by the file's mtime.
  Writes go through a temp file + rename so a crash cannot truncate config.json.
- `PORT` may be overridden by env var for local testing; the default and the
  Docker mapping remain 4000.
