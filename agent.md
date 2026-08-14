# Agent Development Guide — Jenkins Test Farm Dashboard

## Purpose
This document provides guidance for AI agents working on this project.

## Tech Stack
- **Runtime**: Node.js 20+
- **Backend**: Express.js (minimal dependencies)
- **Frontend**: Vanilla HTML, CSS, JavaScript (no frameworks)
- **Charts**: Canvas API (no chart libraries)
- **Drag & Drop**: HTML5 Drag & Drop API (no libraries)
- **Storage**: JSON file on filesystem
- **Deployment**: Docker + Docker Compose

## Design Decisions (Finalized)

### Architecture
1. Backend acts as a Jenkins API proxy — frontend never directly calls Jenkins
2. Backend polls Jenkins every 60 seconds and caches results in memory
3. Frontend polls backend every 60 seconds for cached data
4. Single JSON file stores all configuration (Jenkins credentials, cards, settings)
5. Docker Volume persists the config file across container restarts

### Frontend Behavior
1. Work hours check runs on the frontend (Mon-Fri 09:00-18:00 local time)
2. Outside work hours: stop polling, show "Off Hours" overlay, keep last data visible
3. Grid sizes: 3x3, 4x4, 5x5 — user switches via buttons in dashboard toolbar
4. Pagination: cards exceeding grid capacity auto-paginate, 30-second auto-rotation
5. Theme: light/dark toggle, preference saved in localStorage

### Configuration Page (config.html)
1. Jenkins connection: URL + username + password form with "Test Connection" button
2. Job browser: fetches all top-level jobs (no recursion into folders), search/filter box
3. Card management: drag-to-reorder, inline alias editing, delete with confirmation modal
4. Settings: grid size selection

### Dashboard Page (index.html)
1. Read-only display — no editing capability
2. Card shows: status color block, alias/job name, last success, last failure, last duration, 10-build trend chart
3. Toolbar: grid size buttons, theme toggle, config page link, page indicator
4. Auto-refreshes via polling (only during work hours)

## File Naming Conventions
- Backend: `server/*.js` (CommonJS modules)
- Frontend HTML: `public/*.html`
- Frontend CSS: `public/css/*.css`
- Frontend JS: `public/js/*.js`
- Data: `data/config.json`

## API Design Rules
- All API routes prefixed with `/api/`
- JSON request/response bodies
- Jenkins credentials never exposed to frontend (password masked in GET responses)
- Dashboard data served from memory cache, never directly from Jenkins

## Error Handling
- Jenkins connection failures: cache last known data, show "stale data" indicator
- API errors: return structured JSON `{ "error": "message" }`
- Frontend: show user-friendly toast notifications for errors

## Testing
- Test Jenkins connectivity: `POST /api/jenkins/test`
- Verify Docker build: `docker build -t test-farm-dashboard .`
- Verify service: `curl http://localhost:4000/`
- Check data persistence: restart container, verify config survives

## Important Constraints
- Port 4000 ONLY (never 8080 or 3000)
- No npm dependencies for frontend (no React, Vue, Angular, Tailwind, etc.)
- Only top-level Jenkins jobs (no recursive folder traversal)
- Single global config (no per-user authentication or personalization)
