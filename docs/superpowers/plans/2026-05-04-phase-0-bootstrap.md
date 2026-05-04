# Phase 0: Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an empty-but-deployable nihongo-practice app: npm-workspace monorepo with React/Vite client, Express/Node server, Postgres locally, passcode auth, a deployed URL at `spruce-cedar.exe.xyz`, and a green Playwright smoke test.

**Architecture:** Single repo with `client/`, `server/`, `shared/`, `e2e/`, `db/` workspaces. Express serves the built React static assets in production. Postgres runs in Docker locally; the deploy target on exe.dev provides its own. A shared `passcode` middleware gates every `/api/*` route; the client stores the passcode in `localStorage`.

**Tech Stack:** Node.js 24 LTS, TypeScript 5.x, npm workspaces, Express 4, pg + node-pg-migrate, Vite 5, React 18, Vitest + supertest, Playwright. Zod for shared schemas.

**Branch:** All Phase 0 work happens on `feat/phase-0-bootstrap`. The final task opens a PR.

**Spec:** `docs/superpowers/specs/2026-05-04-nihongo-practice-design.md` — Phase 0 scope only.

---

## File Structure (end state of Phase 0)

```
nihongo-practice/
  package.json                 # root, workspaces config, top-level scripts
  tsconfig.base.json           # shared TS compiler options
  .gitignore                   # node_modules, dist, .env, .DS_Store, coverage
  .env.example                 # documents required env vars
  docker-compose.yml           # Postgres only, for local dev
  scripts/
    deploy.sh                  # deploys current main to spruce-cedar.exe.xyz
  .github/workflows/
    ci.yml                     # runs server tests + playwright smoke on PRs
  shared/
    package.json
    tsconfig.json
    src/types.ts               # Zod schemas + inferred types (mostly stub in Phase 0)
  server/
    package.json
    tsconfig.json
    vitest.config.ts
    src/
      index.ts                 # Express app entry; in prod also serves client/dist
      env.ts                   # validated env loader
      middleware/
        passcode.ts            # X-Passcode header check, constant-time
        passcode.test.ts
      routes/
        auth.ts                # POST /api/auth/check
        auth.test.ts
      db/
        pool.ts                # pg Pool singleton
        migrate.ts             # CLI wrapper around node-pg-migrate
  db/migrations/
    1746374400000_initial.sql  # empty placeholder so migrate command works
  client/
    package.json
    tsconfig.json
    tsconfig.node.json
    vite.config.ts
    index.html                 # iOS PWA meta tags
    public/manifest.json       # web app manifest
    src/
      main.tsx
      App.tsx                  # auth gate; if no passcode, render PasscodeScreen
      api.ts                   # fetch wrapper that injects X-Passcode
      auth.ts                  # localStorage helpers for the passcode
      screens/
        PasscodeScreen.tsx
        TodayScreen.tsx        # "0 cards due" placeholder
      styles/                  # design tokens + base CSS produced by frontend-design skill
  e2e/
    package.json
    playwright.config.ts
    tests/
      smoke.spec.ts            # passcode → Today screen
```

**Why this shape:** Each workspace has one responsibility. `shared/` is the only cross-cutting code; everything else imports from it but not from sibling workspaces. The client and server have no compile-time coupling beyond `shared/`.

---

## Conventions for every task

- **Working directory:** repo root unless stated otherwise.
- **Commits:** small, on `feat/phase-0-bootstrap`. Conventional Commits style (`feat:`, `chore:`, `test:`, `docs:`).
- **Co-author trailer:** every commit ends with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **TDD where it makes sense:** server logic is test-first. Scaffolding tasks (creating empty packages, configs) have no failing test — just write, verify, commit.
- **Stop and ask:** if a step's expected output doesn't match what you see, stop and report; do not invent fixes.

---

### Task 1: Branch + root scaffold

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `tsconfig.base.json`

- [ ] **Step 1: Create the branch**

```bash
git checkout main
git pull
git checkout -b feat/phase-0-bootstrap
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "nihongo-practice",
  "private": true,
  "version": "0.0.0",
  "engines": { "node": ">=24" },
  "workspaces": ["shared", "server", "client", "e2e"],
  "scripts": {
    "dev": "npm --workspace server run dev & npm --workspace client run dev",
    "build": "npm --workspace shared run build && npm --workspace server run build && npm --workspace client run build",
    "test": "npm --workspace server test",
    "e2e": "npm --workspace e2e test",
    "db:up": "docker compose up -d postgres",
    "db:down": "docker compose down",
    "db:migrate": "npm --workspace server run db:migrate"
  }
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
dist/
build/
coverage/
.env
.env.local
.DS_Store
playwright-report/
test-results/
*.log
```

- [ ] **Step 4: Write `.env.example`**

```
# Server
NODE_ENV=development
PORT=3001
PASSCODE=changeme
DATABASE_URL=postgres://nihongo:nihongo@localhost:5432/nihongo

# Client (Vite picks these up via import.meta.env)
VITE_API_BASE=http://localhost:3001
```

- [ ] **Step 5: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 6: Verify**

```bash
ls package.json .gitignore .env.example tsconfig.base.json
```

Expected: all four files exist.

- [ ] **Step 7: Commit**

```bash
git add package.json .gitignore .env.example tsconfig.base.json
git commit -m "$(cat <<'EOF'
chore: initialize npm workspaces and TS base config

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Shared package (Zod + types stub)

**Files:**
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/src/types.ts`

- [ ] **Step 1: Write `shared/package.json`**

```json
{
  "name": "@nihongo/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/types.ts",
  "types": "./src/types.ts",
  "exports": {
    ".": "./src/types.ts"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Write `shared/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write `shared/src/types.ts`** (Phase 0 stub — Phase 1 fills in the per-skill schemas)

```ts
import { z } from "zod";

export const AuthCheckRequest = z.object({
  // Body intentionally empty; passcode comes from header.
}).strict();
export type AuthCheckRequest = z.infer<typeof AuthCheckRequest>;

export const AuthCheckResponse = z.object({
  ok: z.literal(true),
});
export type AuthCheckResponse = z.infer<typeof AuthCheckResponse>;
```

- [ ] **Step 4: Install workspace deps**

```bash
npm install
```

Expected: `node_modules/` populated; no errors.

- [ ] **Step 5: Type-check**

```bash
npm --workspace shared run build
```

Expected: exit 0, no diagnostics.

- [ ] **Step 6: Commit**

```bash
git add shared/ package-lock.json
git commit -m "$(cat <<'EOF'
chore(shared): stub package with Zod and AuthCheck schemas

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Server package scaffold

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/src/env.ts`
- Create: `server/src/index.ts`

- [ ] **Step 1: Write `server/package.json`**

```json
{
  "name": "@nihongo/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate": "tsx src/db/migrate.ts up"
  },
  "dependencies": {
    "@nihongo/shared": "*",
    "express": "^4.21.0",
    "pg": "^8.13.0",
    "zod": "^3.23.8",
    "node-pg-migrate": "^7.6.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.7.0",
    "@types/pg": "^8.11.10",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `server/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write `server/src/env.ts`**

```ts
import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  PASSCODE: z.string().min(1, "PASSCODE is required"),
  DATABASE_URL: z.string().url(),
});

export const env = Env.parse(process.env);
```

- [ ] **Step 4: Write `server/src/index.ts`** (minimal, no routes yet — added in next tasks)

```ts
import express from "express";
import { env } from "./env.js";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`server listening on http://localhost:${env.PORT}`);
  });
}
```

- [ ] **Step 5: Install + smoke run**

```bash
npm install
cp .env.example .env
PASSCODE=test npm --workspace server run dev &
sleep 2
curl -s http://localhost:3001/healthz
kill %1
```

Expected: `{"ok":true}` printed; no errors.

- [ ] **Step 6: Commit**

```bash
git add server/ package-lock.json
git commit -m "$(cat <<'EOF'
feat(server): minimal Express app with /healthz

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Passcode middleware (TDD)

**Files:**
- Create: `server/vitest.config.ts`
- Create: `server/src/middleware/passcode.test.ts`
- Create: `server/src/middleware/passcode.ts`

- [ ] **Step 1: Write `server/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 2: Write the failing test `server/src/middleware/passcode.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { passcodeMiddleware } from "./passcode.js";

function mockReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}
function mockRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe("passcodeMiddleware", () => {
  const correct = "secret123";

  it("calls next when X-Passcode matches", () => {
    const mw = passcodeMiddleware(correct);
    const next: NextFunction = vi.fn();
    mw(mockReq({ "x-passcode": correct }), mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 401 when X-Passcode is missing", () => {
    const mw = passcodeMiddleware(correct);
    const res = mockRes();
    const next: NextFunction = vi.fn();
    mw(mockReq({}), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when X-Passcode is wrong", () => {
    const mw = passcodeMiddleware(correct);
    const res = mockRes();
    const next: NextFunction = vi.fn();
    mw(mockReq({ "x-passcode": "nope" }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when wrong passcode is the same length", () => {
    const mw = passcodeMiddleware(correct);
    const res = mockRes();
    const next: NextFunction = vi.fn();
    mw(mockReq({ "x-passcode": "decoy_99" }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
```

- [ ] **Step 3: Run, expect failure**

```bash
npm --workspace server test
```

Expected: 4 tests fail with "Cannot find module './passcode.js'" or similar.

- [ ] **Step 4: Implement `server/src/middleware/passcode.ts`**

```ts
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { timingSafeEqual } from "node:crypto";

export function passcodeMiddleware(expected: string): RequestHandler {
  const expectedBuf = Buffer.from(expected, "utf8");
  return (req: Request, res: Response, next: NextFunction) => {
    const provided = req.headers["x-passcode"];
    if (typeof provided !== "string") {
      res.status(401).json({ error: "missing passcode", code: "AUTH_MISSING" });
      return;
    }
    const providedBuf = Buffer.from(provided, "utf8");
    if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
      res.status(401).json({ error: "wrong passcode", code: "AUTH_WRONG" });
      return;
    }
    next();
  };
}
```

- [ ] **Step 5: Run, expect pass**

```bash
npm --workspace server test
```

Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add server/vitest.config.ts server/src/middleware/
git commit -m "$(cat <<'EOF'
feat(server): passcode middleware with constant-time comparison

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `/api/auth/check` route (TDD with supertest)

**Files:**
- Create: `server/src/routes/auth.ts`
- Create: `server/src/routes/auth.test.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Write the failing test `server/src/routes/auth.test.ts`**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import express from "express";
import { passcodeMiddleware } from "../middleware/passcode.js";
import { authRouter } from "./auth.js";

function makeApp(passcode: string) {
  const app = express();
  app.use(express.json());
  app.use("/api", passcodeMiddleware(passcode));
  app.use("/api/auth", authRouter);
  return app;
}

describe("POST /api/auth/check", () => {
  const passcode = "test-passcode";
  let app: express.Express;
  beforeAll(() => { app = makeApp(passcode); });

  it("returns 200 with ok when passcode is correct", async () => {
    const res = await request(app)
      .post("/api/auth/check")
      .set("X-Passcode", passcode)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("returns 401 when passcode is wrong", async () => {
    const res = await request(app)
      .post("/api/auth/check")
      .set("X-Passcode", "wrong-passcode")
      .send({});
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
npm --workspace server test
```

Expected: 2 new failures: cannot find `./auth.js`.

- [ ] **Step 3: Implement `server/src/routes/auth.ts`**

```ts
import { Router } from "express";

export const authRouter = Router();

authRouter.post("/check", (_req, res) => {
  res.json({ ok: true });
});
```

- [ ] **Step 4: Wire into `server/src/index.ts`** (replace the `createApp` function)

```ts
import express from "express";
import { env } from "./env.js";
import { passcodeMiddleware } from "./middleware/passcode.js";
import { authRouter } from "./routes/auth.js";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.use("/api", passcodeMiddleware(env.PASSCODE));
  app.use("/api/auth", authRouter);
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`server listening on http://localhost:${env.PORT}`);
  });
}
```

- [ ] **Step 5: Run, expect pass**

```bash
npm --workspace server test
```

Expected: all tests passing.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/ server/src/index.ts
git commit -m "$(cat <<'EOF'
feat(server): POST /api/auth/check behind passcode middleware

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Local Postgres via docker-compose

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: nihongo
      POSTGRES_PASSWORD: nihongo
      POSTGRES_DB: nihongo
    ports:
      - "5432:5432"
    volumes:
      - nihongo_pg_data:/var/lib/postgresql/data

volumes:
  nihongo_pg_data:
```

- [ ] **Step 2: Bring it up and verify**

```bash
docker compose up -d postgres
sleep 3
docker compose exec -T postgres psql -U nihongo -d nihongo -c "select version();"
```

Expected: a `PostgreSQL 16.x ...` line is printed.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "$(cat <<'EOF'
chore(db): add docker-compose with Postgres 16 for local dev

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Migrations harness + initial empty migration

**Files:**
- Create: `db/migrations/1746374400000_initial.sql`
- Create: `server/src/db/migrate.ts`
- Create: `server/src/db/pool.ts`

- [ ] **Step 1: Write `db/migrations/1746374400000_initial.sql`** (Phase 1 adds the real tables; this just proves the harness runs)

```sql
-- 1746374400000_initial: enable extensions Phase 1 will need.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

- [ ] **Step 2: Write `server/src/db/pool.ts`**

```ts
import pg from "pg";
import { env } from "../env.js";

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
```

- [ ] **Step 3: Write `server/src/db/migrate.ts`**

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import migrationRunner from "node-pg-migrate";
import { env } from "../env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../../db/migrations");

const direction = (process.argv[2] === "down" ? "down" : "up") as "up" | "down";

await migrationRunner({
  databaseUrl: env.DATABASE_URL,
  dir: migrationsDir,
  migrationsTable: "pgmigrations",
  direction,
  count: Infinity,
  log: console.log,
});

process.exit(0);
```

- [ ] **Step 4: Run the migration**

```bash
npm --workspace server run db:migrate
```

Expected: log lines showing `1746374400000_initial` migrated up; `pgmigrations` table created.

- [ ] **Step 5: Verify the extension exists**

```bash
docker compose exec -T postgres psql -U nihongo -d nihongo -c "select extname from pg_extension where extname = 'pgcrypto';"
```

Expected: one row returned.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/ server/src/db/
git commit -m "$(cat <<'EOF'
feat(db): node-pg-migrate harness and initial migration enabling pgcrypto

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Server serves built client in production

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Update `createApp` in `server/src/index.ts` to serve `client/dist/` in production**

Replace the file with:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { env } from "./env.js";
import { passcodeMiddleware } from "./middleware/passcode.js";
import { authRouter } from "./routes/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../../client/dist");

export function createApp() {
  const app = express();
  app.use(express.json());
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.use("/api", passcodeMiddleware(env.PASSCODE));
  app.use("/api/auth", authRouter);

  if (env.NODE_ENV === "production") {
    app.use(express.static(clientDist));
    // SPA fallback: any non-/api GET returns index.html
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`server listening on http://localhost:${env.PORT}`);
  });
}
```

- [ ] **Step 2: Run existing tests to confirm no regression**

```bash
npm --workspace server test
```

Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add server/src/index.ts
git commit -m "$(cat <<'EOF'
feat(server): serve built client/dist in production with SPA fallback

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Establish v0 visual system via the frontend-design skill

The spec mandates: *"At the start of client implementation, invoke the `frontend-design` skill to produce a distinctive, production-grade interface."* Phase 0 ships only a passcode screen and a "0 cards due" placeholder, but the design system established here will carry through Phase 1.

**Files (output of the skill):**
- Create: `client/src/styles/tokens.css` — color, spacing, type, radius, shadows
- Create: `client/src/styles/base.css` — reset + body + safe-area handling
- Create: `client/src/styles/README.md` — short note explaining the system (this file IS expressly requested by the skill, so it's allowed)

- [ ] **Step 1: Invoke the skill**

Use the Skill tool: `frontend-design` (or `frontend-design:frontend-design`). Brief it with:

> "Establish the v0 design system for a single-user Japanese practice PWA used daily on iPhone. Constraints from the spec:
> - Mobile-first, iOS safe-area aware
> - Dark mode default, light mode supported (CSS custom properties)
> - Furigana legibility: `<ruby>` text appears at ~55% of the parent font-size with comfortable line-height; high contrast
> - Primary actions reachable in the lower thumb zone
> - Minimal chrome during a session — the card is the interface
>
> Deliverables: `client/src/styles/tokens.css` (CSS custom properties), `client/src/styles/base.css` (reset + body + safe-area), and a one-page `client/src/styles/README.md` documenting the token names and intent. Also propose the visual treatment for two screens — a passcode entry screen and a near-empty 'Today' screen — but do not write the React components yet; that's the next task."

- [ ] **Step 2: Verify the deliverables exist**

```bash
ls client/src/styles/
```

Expected: `tokens.css`, `base.css`, `README.md`.

- [ ] **Step 3: Commit whatever the skill produced**

```bash
git add client/src/styles/
git commit -m "$(cat <<'EOF'
feat(client): v0 design tokens and base styles via frontend-design skill

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Client scaffold (Vite + React + TS)

**Files:**
- Create: `client/package.json`
- Create: `client/tsconfig.json`
- Create: `client/tsconfig.node.json`
- Create: `client/vite.config.ts`
- Create: `client/index.html`
- Create: `client/public/manifest.json`
- Create: `client/src/main.tsx`
- Create: `client/src/App.tsx`

- [ ] **Step 1: Write `client/package.json`**

```json
{
  "name": "@nihongo/client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 5173 --host",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@nihongo/shared": "*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Write `client/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "moduleResolution": "Bundler",
    "noEmit": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 3: Write `client/tsconfig.node.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "noEmit": false,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node"]
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Write `client/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
```

- [ ] **Step 5: Write `client/index.html`** (iOS PWA-friendly)

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0b0b0f" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Nihongo" />
    <link rel="manifest" href="/manifest.json" />
    <title>Nihongo Practice</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Write `client/public/manifest.json`**

```json
{
  "name": "Nihongo Practice",
  "short_name": "Nihongo",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0b0b0f",
  "theme_color": "#0b0b0f",
  "icons": []
}
```

- [ ] **Step 7: Write `client/src/main.tsx`**

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/base.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("root element missing");
createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 8: Write a placeholder `client/src/App.tsx`** (the real auth flow lands in the next task)

```tsx
export default function App() {
  return <main>Nihongo Practice — Phase 0 boot</main>;
}
```

- [ ] **Step 9: Install + smoke build**

```bash
npm install
npm --workspace client run build
ls client/dist/index.html
```

Expected: `client/dist/index.html` exists.

- [ ] **Step 10: Commit**

```bash
git add client/ package-lock.json
git commit -m "$(cat <<'EOF'
feat(client): Vite + React + TS scaffold with iOS PWA meta tags

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Client passcode flow + Today placeholder

**Files:**
- Create: `client/src/auth.ts`
- Create: `client/src/api.ts`
- Create: `client/src/screens/PasscodeScreen.tsx`
- Create: `client/src/screens/TodayScreen.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Write `client/src/auth.ts`**

```ts
const KEY = "nihongo:passcode";

export const auth = {
  get(): string | null {
    return localStorage.getItem(KEY);
  },
  set(passcode: string): void {
    localStorage.setItem(KEY, passcode);
  },
  clear(): void {
    localStorage.removeItem(KEY);
  },
};
```

- [ ] **Step 2: Write `client/src/api.ts`**

```ts
import { auth } from "./auth";

const BASE = import.meta.env.VITE_API_BASE ?? "";

export class AuthError extends Error {}
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const passcode = auth.get();
  const headers = new Headers(init.headers);
  if (passcode) headers.set("X-Passcode", passcode);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 401) {
    auth.clear();
    throw new AuthError("unauthorized");
  }
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
```

- [ ] **Step 3: Write `client/src/screens/PasscodeScreen.tsx`** (apply the design tokens established in Task 9 — class names refer to the design system produced there)

```tsx
import { useState } from "react";
import { auth } from "../auth";
import { api, AuthError } from "../api";

export function PasscodeScreen({ onAuthed }: { onAuthed: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    auth.set(value);
    try {
      await api("/api/auth/check", { method: "POST", body: "{}" });
      onAuthed();
    } catch (err) {
      auth.clear();
      setError(err instanceof AuthError ? "Wrong passcode" : "Couldn't reach server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen screen--centered">
      <form onSubmit={submit} className="passcode-form">
        <h1>Nihongo</h1>
        <label>
          <span>Passcode</span>
          <input
            type="password"
            inputMode="text"
            autoComplete="current-password"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {error && <p role="alert" className="error">{error}</p>}
        <button type="submit" disabled={busy || value.length === 0}>
          {busy ? "Checking…" : "Enter"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Write `client/src/screens/TodayScreen.tsx`** (placeholder; Phase 1 fills in real data)

```tsx
import { auth } from "../auth";

export function TodayScreen({ onSignOut }: { onSignOut: () => void }) {
  function signOut() {
    auth.clear();
    onSignOut();
  }
  return (
    <main className="screen">
      <header className="topbar">
        <h1>Today</h1>
        <button onClick={signOut} className="link">Sign out</button>
      </header>
      <section className="hero">
        <p className="big-number">0</p>
        <p>cards due</p>
      </section>
      <p className="muted">The review loop ships in Phase 1.</p>
    </main>
  );
}
```

- [ ] **Step 5: Update `client/src/App.tsx`**

```tsx
import { useEffect, useState } from "react";
import { auth } from "./auth";
import { api, AuthError } from "./api";
import { PasscodeScreen } from "./screens/PasscodeScreen";
import { TodayScreen } from "./screens/TodayScreen";

type State = "checking" | "needs-auth" | "authed";

export default function App() {
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    if (!auth.get()) {
      setState("needs-auth");
      return;
    }
    api("/api/auth/check", { method: "POST", body: "{}" })
      .then(() => setState("authed"))
      .catch((err) => {
        if (err instanceof AuthError) setState("needs-auth");
        else setState("needs-auth"); // fall back to passcode screen on any failure
      });
  }, []);

  if (state === "checking") return <main className="screen screen--centered">Loading…</main>;
  if (state === "needs-auth") return <PasscodeScreen onAuthed={() => setState("authed")} />;
  return <TodayScreen onSignOut={() => setState("needs-auth")} />;
}
```

- [ ] **Step 6: Smoke run end-to-end locally**

In one terminal:

```bash
PASSCODE=test npm --workspace server run dev
```

In another:

```bash
npm --workspace client run dev
```

Open `http://localhost:5173` in a browser, enter `test` as the passcode, confirm you land on the Today placeholder. Refresh — you should still be in.

- [ ] **Step 7: Commit**

```bash
git add client/src/
git commit -m "$(cat <<'EOF'
feat(client): passcode entry, auth gate, and Today placeholder

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Playwright E2E smoke test

**Files:**
- Create: `e2e/package.json`
- Create: `e2e/playwright.config.ts`
- Create: `e2e/tests/smoke.spec.ts`

- [ ] **Step 1: Write `e2e/package.json`**

```json
{
  "name": "@nihongo/e2e",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "playwright test",
    "install-browsers": "playwright install --with-deps chromium"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0"
  }
}
```

- [ ] **Step 2: Write `e2e/playwright.config.ts`**

```ts
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "iphone-14", use: { ...devices["iPhone 14"] } },
  ],
});
```

- [ ] **Step 3: Write `e2e/tests/smoke.spec.ts`**

```ts
import { test, expect } from "@playwright/test";

const PASSCODE = process.env.E2E_PASSCODE ?? "test";

test("passcode → Today placeholder", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Passcode").fill(PASSCODE);
  await page.getByRole("button", { name: /enter/i }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByText("cards due")).toBeVisible();
});

test("wrong passcode shows an error", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Passcode").fill("definitely-wrong");
  await page.getByRole("button", { name: /enter/i }).click();
  await expect(page.getByRole("alert")).toHaveText(/wrong passcode/i);
});
```

- [ ] **Step 4: Install browsers + run against the local dev servers**

In two terminals: server and client running (`PASSCODE=test`). Then:

```bash
npm install
npm --workspace e2e run install-browsers
npm --workspace e2e test
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add e2e/ package-lock.json
git commit -m "$(cat <<'EOF'
test(e2e): Playwright smoke for passcode flow on iPhone 14 viewport

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: nihongo
          POSTGRES_PASSWORD: nihongo
          POSTGRES_DB: nihongo
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
    env:
      DATABASE_URL: postgres://nihongo:nihongo@localhost:5432/nihongo
      PASSCODE: test
      NODE_ENV: test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "24", cache: "npm" }
      - run: npm ci
      - run: npm --workspace server run db:migrate
      - run: npm --workspace server test

  e2e:
    runs-on: ubuntu-latest
    needs: test
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: nihongo
          POSTGRES_PASSWORD: nihongo
          POSTGRES_DB: nihongo
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
    env:
      DATABASE_URL: postgres://nihongo:nihongo@localhost:5432/nihongo
      PASSCODE: test
      NODE_ENV: production
      VITE_API_BASE: http://localhost:3001
      E2E_BASE_URL: http://localhost:3001
      E2E_PASSCODE: test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "24", cache: "npm" }
      - run: npm ci
      - run: npm --workspace server run db:migrate
      - run: npm --workspace client run build
      - run: npm --workspace server run build
      - run: npm --workspace e2e run install-browsers
      - name: Start server
        run: |
          npm --workspace server start &
          npx wait-on http://localhost:3001/healthz --timeout 30000
      - run: npm --workspace e2e test
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: e2e/playwright-report
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci: run server tests and Playwright smoke on every PR

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Deploy to spruce-cedar.exe.xyz

This task uses the `using-exe-dev` skill to determine the actual deploy mechanism (SSH + git pull + restart vs. container vs. exe.dev managed runner) — that detail is not yet known. Whatever the skill prescribes is what `scripts/deploy.sh` automates.

**Files:**
- Create: `scripts/deploy.sh`

- [ ] **Step 1: Invoke the `using-exe-dev` skill**

Use the Skill tool: `using-exe-dev`. Brief it with:

> "Need to deploy a Node 24 + React + Postgres app from this repo to the existing exe.dev VM at `spruce-cedar.exe.xyz`. The app is a single Express process (`npm --workspace server start`) that serves the built client from `client/dist`. It needs a Postgres database (managed if available, otherwise local on the VM) and these env vars: `DATABASE_URL`, `PASSCODE`, `NODE_ENV=production`, `PORT`. Need: (1) the deploy mechanism (SSH? container? CLI?), (2) where Postgres lives, (3) how to set env vars, (4) a runnable shell script the user can invoke from this repo to ship the current main branch. Confirm everything against the actual exe.dev tooling — don't guess."

- [ ] **Step 2: Translate the skill's guidance into `scripts/deploy.sh`**

Make the script idempotent and verbose. It should at minimum: build the client and server, ship the artifacts to the VM, run any pending migrations against the production DB, restart the service, and tail the health check until it returns 200.

- [ ] **Step 3: Make it executable and run it**

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

Expected: the script runs to completion; `curl -fsS https://spruce-cedar.exe.xyz/healthz` returns `{"ok":true}`.

- [ ] **Step 4: Manual smoke against the deployed URL**

Open `https://spruce-cedar.exe.xyz` on your iPhone. Enter the production passcode (whatever you set on the VM). Confirm the Today placeholder loads.

- [ ] **Step 5: Run Playwright against the deployed URL**

```bash
E2E_BASE_URL=https://spruce-cedar.exe.xyz E2E_PASSCODE=<prod-passcode> npm --workspace e2e test
```

Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add scripts/
git commit -m "$(cat <<'EOF'
chore(deploy): script to ship main to spruce-cedar.exe.xyz

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Open the PR

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feat/phase-0-bootstrap
gh pr create --title "feat: Phase 0 bootstrap" --body "$(cat <<'EOF'
## Summary
Implements Phase 0 of the spec: deployable, passcode-gated, empty-but-real
nihongo-practice app. Single repo with npm workspaces (`shared`,
`server`, `client`, `e2e`), Postgres via Docker locally, Express
serving the built React client in production, deployed to
`spruce-cedar.exe.xyz`.

## What's in
- npm-workspace monorepo + TS configs
- Express server: `/healthz`, `X-Passcode` middleware, `POST /api/auth/check`
- Postgres 16 in docker-compose; node-pg-migrate harness with an empty
  initial migration enabling `pgcrypto`
- Vite + React 18 client: passcode entry, auth gate, Today placeholder
- iOS PWA meta tags + manifest
- v0 design system established via the `frontend-design` skill
- Playwright smoke tests (mobile viewport)
- GitHub Actions CI: server tests + e2e on every PR
- Deploy script for `spruce-cedar.exe.xyz`

## What's deliberately not in
The whole review loop — that's Phase 1, planned next against this codebase.

## Test plan
- [ ] `npm test` passes locally
- [ ] `npm --workspace e2e test` passes against local dev servers
- [ ] CI is green
- [ ] `https://spruce-cedar.exe.xyz` loads passcode screen on iPhone
- [ ] Entering the production passcode lands on the Today placeholder
- [ ] Refreshing the page keeps you signed in

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Wait for CI to pass and for manual review.** Address any feedback as additional commits on the same branch. Do not merge — that's the owner's job.

---

## Self-review notes

- **Spec coverage (Phase 0 only):** repo scaffold ✓ (Tasks 1–3, 10), Postgres up locally ✓ (Tasks 6–7), deploy pipeline ✓ (Task 14), passcode auth ✓ (Tasks 4–5, 11), session screen that loads ✓ (Task 11). The frontend-design skill invocation is mandated by the spec and lands as Task 9.
- **Phase 1 / 1.5 / 2 deferrals:** items table, review_state, reviews, sessions, generations, all card components, AI top-up, user authoring — none of these are in this plan. They become subsequent plans written against the real codebase after this one merges.
- **Open spec questions resolved here:** deploy mechanism is deferred to Task 14 (the `using-exe-dev` skill produces it); seed content schema is deferred to Phase 1 (no items table yet).
- **Type consistency:** `AuthCheckResponse` (`shared/src/types.ts`) returns `{ ok: true }`; `authRouter` returns `{ ok: true }` ✓. `passcodeMiddleware(expected)` signature consistent across Tasks 4 and 5 ✓. `auth` module API (`get`/`set`/`clear`) consistent across `auth.ts`, `api.ts`, screens ✓.
