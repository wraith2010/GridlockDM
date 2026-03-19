# GridlockDM

> Real-time multiplayer battle maps for D&D 5e. Self-hosted Spring Boot server with WebSocket sync, per-cell fog of war, D&D Beyond character import, zone drawing, initiative tracking, and a canvas renderer that scales to any zoom. One invite code gets your whole table in.

---

## Features

- **Real-time sync** — All connected clients (DM, players, TV/table view) stay in sync via STOMP WebSocket
- **Battle map canvas** — Zoom, pan, drag tokens, fog of war per cell, zone drawing
- **D&D Beyond import** — Paste a character ID and pull your full sheet automatically
- **PDF import** — Upload a D&D Beyond exported PDF as a fallback
- **Session invites** — DM creates a session with a human-readable code (e.g. `WOLF-4271`), players join with one click
- **Observer view** — Read-only TV/projector view with a signed token, no account needed
- **Conditions & HP** — DM applies conditions (Slowed, Restrained, Prone, etc.) that affect movement overlays
- **Initiative tracker** — Full order panel with conditions shown inline

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Java 21 + Spring Boot 3.3 |
| Real-time | STOMP over WebSocket (SockJS fallback) |
| Auth | Spring Security + JWT (jjwt 0.12) |
| Database | PostgreSQL 15+ (Flyway migrations) |
| PDF parsing | Apache PDFBox 3 |
| HTTP client | Spring WebFlux WebClient |
| Frontend | Vanilla JS (ES modules), HTML5 Canvas |

---

## Prerequisites

- Java 21+
- Maven 3.9+
- PostgreSQL 15+ (or use the Docker Compose file below)

---

## Quick Start

### 1. Start PostgreSQL

Using Docker Compose (recommended):

```bash
docker compose up -d postgres
```

Or create the database manually:

```sql
CREATE USER gridlock WITH PASSWORD 'gridlock';
CREATE DATABASE gridlockdm OWNER gridlock;
```

### 2. Configure environment

Copy the example env file and edit as needed:

```bash
cp .env.example .env
```

Key variables:

```
DB_USERNAME=gridlock
DB_PASSWORD=gridlock
JWT_SECRET=change-me-to-a-long-random-string-at-least-32-chars
PORT=8080
```

> ⚠️ **Always change `JWT_SECRET` before deploying.** Use a random 256-bit string.

### 3. Build and run

```bash
./mvnw spring-boot:run
```

Or build a fat JAR:

```bash
./mvnw clean package -DskipTests
java -jar target/gridlockdm-0.1.0-SNAPSHOT.jar
```

### 4. Open the app

Navigate to [http://localhost:8080](http://localhost:8080)

1. Register an account
2. Import or create a character
3. Create a session — share the invite code with your players
4. Players visit `http://your-server:8080` → Join Session → enter the code

---

## Docker Compose

`docker-compose.yml` includes both PostgreSQL and the app itself.

```bash
# Start everything
docker compose up -d --build

# View logs
docker compose logs -f app

# Stop
docker compose down
```

---

## Project Structure

```
src/main/java/com/gridlockdm/
├── GridlockDmApplication.java       # Entry point
├── auth/                            # Login, register, JWT response DTOs
├── config/                          # Security, JWT provider, WebSocket, CORS
├── common/                          # Global exception handler, invite code generator
└── domain/
    ├── user/                        # User entity + repository
    ├── character/                   # Character entity, CRUD, DDB import, PDF import
    └── session/                     # Session, SessionCharacter, SessionInvite entities + service

src/main/resources/
├── application.yml                  # App config (env-var driven)
├── db/migration/
│   └── V1__init_schema.sql          # Flyway schema — all tables, indexes, triggers
└── static/                          # Vanilla JS SPA frontend
    ├── index.html
    ├── css/app.css
    └── js/
        ├── app.js                   # Router + boot
        ├── api.js                   # Typed HTTP client
        ├── store.js                 # Reactive state store
        ├── router.js                # Hash-based SPA router
        ├── ws.js                    # STOMP WebSocket client
        ├── ui.js                    # Toast, hp bar, badge helpers
        ├── canvas/renderer.js       # Battle map canvas engine
        └── views/                   # auth, dashboard, character-import, session-flow, game
```

---

## API Reference

### Auth
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | Public | Create account, returns JWT |
| POST | `/api/auth/login` | Public | Login, returns JWT |
| GET  | `/api/auth/me` | Bearer | Current user profile |

### Characters
| Method | Path | Description |
|---|---|---|
| GET  | `/api/characters` | List my characters |
| POST | `/api/characters/manual` | Create manually |
| POST | `/api/characters/import/ddb` | Import from D&D Beyond by character ID |
| POST | `/api/characters/import/pdf` | Upload PDF |
| PUT  | `/api/characters/{id}` | Update |
| DELETE | `/api/characters/{id}` | Delete |

### Sessions
| Method | Path | Description |
|---|---|---|
| POST | `/api/sessions` | DM creates session |
| GET  | `/api/sessions/{code}/info` | Public session info (pre-join) |
| POST | `/api/sessions/{code}/join` | Player requests to join |
| GET  | `/api/sessions/{id}/invites/pending` | DM: list pending join requests |
| POST | `/api/sessions/invites/{id}/accept` | DM: accept invite |
| POST | `/api/sessions/invites/{id}/deny` | DM: deny invite |
| POST | `/api/sessions/{id}/start` | DM: start session |
| POST | `/api/sessions/{id}/end` | DM: end session |
| POST | `/api/sessions/{id}/observer-link` | DM: generate observer JWT |
| GET  | `/api/sessions/{id}/roster` | Active session characters |
| GET  | `/api/sessions/my` | DM's sessions |

### WebSocket (STOMP)
- **Connect:** `ws://host/ws` with header `Authorization: Bearer <token>`
- **Subscribe:** `/topic/session/{code}` — all broadcast events
- **Subscribe:** `/topic/session/{code}/dm` — DM-only events
- **Subscribe:** `/user/queue/invite-result` — per-user join notifications
- **Send actions:** `/app/session/{code}/action`

---

## WebSocket Event Types

| Type | Direction | Payload |
|---|---|---|
| `PLAYER_JOINED` | Broadcast | SessionCharacterDto |
| `TOKEN_MOVED` | Broadcast | `{ tokenId, x, y }` |
| `CONDITIONS_UPDATED` | Broadcast | `{ tokenId, conditions[] }` |
| `HP_UPDATED` | Broadcast | `{ tokenId, currentHp, maxHp }` |
| `FOG_UPDATED` | Broadcast | `{ cells: {"x,y": bool} }` |
| `INITIATIVE_SET` | Broadcast | initiative order array |
| `TURN_ADVANCED` | Broadcast | `{ currentTokenId }` |
| `OVERLAY_TRIGGERED` | Broadcast | overlay descriptor |
| `JOIN_REQUEST` | DM only | InviteDto |
| `INVITE_RESULT` | Per-user | `{ status, sessionCode }` |
| `SESSION_STARTED` | Broadcast | session ID |
| `SESSION_ENDED` | Broadcast | session ID |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DB_USERNAME` | `gridlock` | PostgreSQL username |
| `DB_PASSWORD` | `gridlock` | PostgreSQL password |
| `JWT_SECRET` | *(insecure default)* | **Change before deploy** |
| `PORT` | `8080` | HTTP port |

---

## Running Tests

```bash
./mvnw test
```

Tests use H2 in-memory (PostgreSQL-compatible mode) — no database setup required for testing.

---

## Roadmap

- [ ] WebSocket game action handler (`@MessageMapping` for token moves, fog, conditions)
- [ ] AI grid detection (Claude vision API → cell size + origin)
- [ ] Movement range overlay (BFS with terrain cost + condition modifiers)
- [ ] Map image upload endpoint
- [ ] Zone drawing persistence
- [ ] AoE / death overlay effects
- [ ] Initiative auto-roll

---

## License

MIT — personal and group use. Not affiliated with Wizards of the Coast or D&D Beyond.
