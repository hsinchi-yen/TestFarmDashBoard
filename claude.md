# Jenkins Test Farm Dashboard

## Project Overview
A Dockerized web dashboard for monitoring Jenkins test build statuses in real-time. Built with Node.js + Express backend and Vanilla HTML/CSS/JS frontend, running on port 4000.

## Architecture
- **Backend**: Node.js + Express API server proxies Jenkins API requests, caches build data, manages user configuration
- **Frontend**: Vanilla HTML/CSS/JS single-page dashboard with card-based UI
- **Storage**: JSON file (`/data/config.json`) persisted via Docker Volume
- **Update**: Backend polls Jenkins every 60 seconds; frontend fetches cached data every 60 seconds

## Key Features
- Card-based build status display (color-coded: green=success, red=failure, gray=not built, yellow=in-progress)
- Grid layout: 3x3, 4x4, 5x5 switchable
- Auto-pagination with 30-second rotation
- Last 10 builds trend chart per card
- Card alias customization, drag-and-drop reorder (config page only)
- Light/dark theme toggle
- Work hours only (Mon-Fri 9:00-18:00): frontend stops polling and shows overlay outside work hours

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
| GET | `/api/dashboard/data` | Get cached build data for all cards |
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
