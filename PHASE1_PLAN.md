# Phase 1: Security and Data Fixes — Implementation Plan

**Goal:** close IDOR across REST + sockets, move `Message` to a `conversationId` schema with
paginated reads, add input validation and rate limiting, and stand up the first CI test suite
proving it all holds.

---

## Status (2026-10-19)

| WS | State |
|---|---|
| WS0 testability refactor | ✅ done (`src/app.js`, slim `index.js`, `initSocket`/`getIO`) |
| WS1 socket auth + room membership | ✅ done (server + frontend `withCredentials`, ack-based join) |
| WS2 REST membership guards | ✅ done (`lib/conversationAccess.js`, all controllers 404 on non-members) |
| WS3 schema + pagination | ✅ implemented with stable `(createdAt, _id)` cursors (models, controller, frontend; **migration script not yet run against dev DB**) |
| WS4 validation + rate limits | ✅ done (zod schemas wired into routes, limiters mounted) |
| WS5 tests + CI | ✅ 63 backend tests / 6 suites and 11 frontend regression tests **green** locally; frontend production build passes; hosted CI must be checked after pushing |

**Remaining manual steps:** run `node scripts/migrate-phase1.js` against the dev/prod DB
(requires a hydrated `MONGO_URL`), then a two-browser smoke test; push to GitHub to see CI green.

### Review fixes (2026-10-19)

- Malformed socket acknowledgement arguments no longer crash the server; room IDs are normalized.
- Pagination returns `nextCursor: { before, beforeId }` and uses `_id` to break timestamp ties.
  The browser sends both fields; timestamp-only callers remain supported for compatibility.
- Chat updates merge against current state and deduplicate REST/socket responses. Selection
  generations reject stale reads, sends, older pages and smart replies after switching chats.
- Message and profile uploads require supported image MIME types and canonical base64 data URLs
  within the 4 MiB string limit. Text-only browser payloads with `image: null` remain valid.
- Profile updates exclude password hashes from their response.
- Frontend concurrency tests now run in CI before the production build. Locally, newly installed
  frontend test dependencies hit OneDrive read errors; the same 11 tests passed using the working
  backend Vitest 3.2.7 runtime against the frontend source and dependency tree.

## Environment notes (2026-10-19)

- **OneDrive broke the toolchain**: `backend/.env` is a cloud-only placeholder whose
  hydration *times out* (never read it programmatically — `globalSetup` does not), and
  freshly-installed `node_modules` files were being demoted/locked (errno -4094 read
  errors and ESM-load hangs).
- **`backend/node_modules` is now an NTFS junction** →
  `C:\Users\manik\AppData\Local\ChatAppNodeModules\backend` (outside OneDrive).
  Keep it; deleting `node_modules` removes only the junction, not the real files.
- **`mongodb-memory-server` dropped** (its package extraction was a victim of the above).
  Tests use **Docker**: `docker run -d --name chatty-test-mongo -p 27017:27017 mongo:7`,
  overridable via `TEST_MONGO_URL`. CI uses a `mongo:7` service container.


## WS0 — Refactor for testability (prerequisite, no behavior change)

Tests need to import the app without starting it. Today `src/index.js` mixes app setup,
DB connect, and `server.listen()`; `lib/socket.js` owns the express app + http server.

- **`src/app.js` (new):** `createApp(options)` → express app, middleware, routes, static
  serving. No `listen()`, no `connectDB()`. Accepts `options.limiters` so tests can mount
  apps with tiny rate-limit ceilings.
- **`src/index.js`:** becomes the boot file — `createApp()`, attach socket, `connectDB()`, `listen()`.
- **`lib/socket.js`:** stop creating app/server. Export `initSocket(httpServer)` (sets up
  `io` + handlers) and `getIO()`. `message.controller.js` switches `import { io }` → `import { getIO }`.
- `app.set("trust proxy", 1)` when `NODE_ENV === "production"` (Render proxy, needed for per-IP rate limits).
- CORS origin from `process.env.CLIENT_ORIGIN || "http://localhost:5173"`.
- Bump `engines.node` to `>=20` (vitest / mongodb-memory-server requirement).
- Add scripts: `"test": "vitest run"`.

## WS1 — Socket authentication + room membership

**Today:** `socket.handshake.query.userId` is client-supplied and trusted (`socket.js:24`);
`join_room` joins any room with zero checks (`socket.js:30-33`).

- `io.use()` middleware: parse `jwt` from `socket.handshake.headers.cookie`, verify with
  `JWT_SECRET`, set `socket.userId`. Reject (`next(new Error("unauthorized"))`) on missing/
  invalid token. Add tiny `cookie` package for parsing.
- Connection handler uses `socket.userId` (verified) — the `query.userId` param is ignored.
  *Bonus fix:* store `Map<userId, Set<socketId>>` so multi-tab doesn't corrupt the
  online-users list on first-tab disconnect.
- `join_room` (async, with ack):
  ```js
  if (!isValidObjectId(id)) return ack?.({ ok: false });
  const exists = await Conversation.exists({ _id: id, participants: socket.userId });
  if (!exists) return ack?.({ ok: false });   // membership enforced
  socket.join(id); ack?.({ ok: true });
  ```
- **Frontend** `useAuthStore.connectSocket`: drop `query.userId`, add `withCredentials: true`.
- **Frontend** `useChatStore.getMessages`: handle the join ack; on `{ok:false}` show toast.

## WS2 — Membership enforcement on every message route

**Today:** `getMessages` (l.85), `sendMessage` (l.133), `getSmartReplies` (l.163) all do
`Conversation.findById(id)` with no participant check → classic IDOR.

- New helper `lib/conversationAccess.js`:
  ```js
  export const getAuthorizedConversation = (convId, userId) =>
    isValidObjectId(convId)
      ? Conversation.findOne({ _id: convId, participants: userId })
      : null;
  ```
- All three controllers: `if (!conv) return res.status(404).json({ message: "Conversation not found" })`.
  **404, not 403** — a 403 would confirm the conversation exists (existence oracle).
- Drop the legacy "fallback: search by participant pair" dual lookup — params are now always
  conversation IDs (see WS3 sidebar change). Smart-replies 404 happens *before* any Gemini call.
- `getUsersforSidebar` returns a consistent shape keyed by **conversation**:
  ```js
  { _id: conv._id, isGroup, fullName, profilePic, otherUser }  // otherUser null for groups
  ```
  (`fullName`/`profilePic` derived server-side, same as today.)

## WS3 — Schema: `Message.conversationId` + pagination

**Today:** `Message.receiverId` refs User but group sends store a *conversation* ID in it
(broken data); `Conversation.messages[]` array grows unbounded; `getMessages` populates the
whole array; client-supplied `timestamp` drives latency logs.

- **`message.model.js`:** add `conversationId` (required, ref Conversation); **remove**
  `receiverId`; index `{ conversationId: 1, createdAt: -1, _id: -1 }`. Ordering uses server
  `createdAt` only — client `timestamp` is no longer accepted (zod strips it).
- **`conversation.model.js`:** **remove the `messages` array** — messages live on
  `Message.conversationId`. Kills the push+save race in `sendMessage` and the 16MB doc risk.
- **Migration** `scripts/migrate-phase1.js` (idempotent):
  ```js
  for each conversation:
    Message.updateMany({ _id: { $in: conv.messages } },
                       { $set: { conversationId: conv._id } });
    Conversation.updateOne({ _id }, { $unset: { messages: "" } });
  // report orphans: messages with no conversationId (pre-existing send failures)
  ```
  Backfill works for group chats too (their messages are in the conv array even though
  `receiverId` was garbage).
- **`getMessages` pagination** (cursor = `before` ISO date + `beforeId`, fetch `limit+1` to detect more):
  ```js
  const query = { conversationId: conv._id };
  if (before && beforeId) query.$or = [
    { createdAt: { $lt: new Date(before) } },
    { createdAt: new Date(before), _id: { $lt: beforeId } }
  ];
  const rows = await Message.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
  res.json({ conversationId, messages: rows.slice(0, limit).reverse(), hasMore, nextCursor });
  ```
  Default `limit=30`, max 100. Response keeps the `messages` key → minimal frontend churn.
- **`sendMessage`** becomes: authorize → `Message.create({ conversationId, senderId, text, image })`
  → `io.to(conv._id).emit("newMessage", msg)` → 201. No conv lookup fallback, no array push.
- **Frontend changes:**
  - `Sidebar`: `user._id` is now a conversation ID → online dot/filter must use
    `chat.otherUser?._id` (groups never "online").
  - `useChatStore.subscribeToMessages`: replace the `senderId === selectedUser._id` filter
    (breaks now that selectedUser is a conversation) with **dedupe by `_id`** — covers 1:1
    and groups, and stops the sender's own REST-response + socket-echo double append.
  - `loadOlderMessages` prepending when `hasMore` (scroll-top trigger or "Load earlier" button).

## WS4 — Input validation + rate limiting

**Today:** zero validation libs; controllers read `req.body` raw; password rules conflict
( signup says ≥6, User schema says ≥8, seeds use 8 ).

- **Deps:** `zod`, `express-rate-limit`, `cookie` (WS1).
- **`middleware/validate.js`:** `validate(schema, "body"|"query"|"params")` → 400 + zod issues.
- **Schemas** (`lib/validation.js`):
  | Route | Rules |
  |---|---|
  | signup | fullName 2–80, email, password **≥8** (unify schema/controller/UI copy) |
  | login | email + password present |
  | send/:id | text ≤4000 optional, image data-URL ≤ ~4MB, **require text or image**, `timestamp` stripped |
  | invite | email |
  | group | groupName 1–50, emails array 1–100, each valid + deduped |
  | messages query | limit 1–100 (default 30), before = ISO datetime |
  | all `:id` params | `/^[0-9a-fA-F]{24}$/` → 400 instead of Mongoose CastError → 500 |
  | update-profile | image data-URL ≤ 4MB |
- **Rate limits** — `middleware/rateLimit.js` exports a `createLimiter(opts)` factory
  (so the rate-limit test can mount a custom app):
  | Scope | Ceiling |
  |---|---|
  | global | 300/min/IP |
  | `/app/auth/login` + `/signup` | 10/15min/IP |
  | `/app/messages/send/*` | 60/min/IP |
  | `/app/messages/smart-replies/*` | 10/15min/IP (Gemini cost) |
  | `/app/messages/invite` + `/group` | 10/15min/IP |
  → 429 `{ message: "Too many requests" }`. In-memory store (fine for single-instance
  Render; note: needs Redis if scaled to multiple instances).
- Small fix while here: `protectedRoute.middleware.js:17` missing `return` before the
  invalid-token 401.

## WS5 — IDOR tests (first CI suite) + GitHub Actions

- **Deps (dev):** `vitest`, `supertest`, `socket.io-client`. Test DB: Docker
  `mongo:7` on 27017 (or `TEST_MONGO_URL`); `tests/globalSetup.js` creates a unique
  `chatapp_test_<rand>` database and drops it in teardown — never touches real data.
- **`tests/setup.js`:** boot memory Mongo → `process.env.MONGO_URL`, `JWT_SECRET=test-secret`,
  `createApp()` on an ephemeral port. Fixtures: users A/B/C/D, conv(A↔B), group(A,B,C),
  conv(A↔C).
- **Test files:**
  1. `idor.rest.test.js`
     - B `GET /app/messages/:convAC` → **404**; A → **200**
     - B `POST send/:convAC` → **404** and `Message.countDocuments` unchanged
     - B `GET smart-replies/:convAC` → **404** (no Gemini call)
     - no cookie → 401; garbage/expired token → 401; non-ObjectId id → **400** (not 500)
  2. `idor.socket.test.js`
     - connect without cookie → rejected
     - A's cookie + `join_room convAC` → joined; B's attempt → `{ok:false}`, not joined
     - `newMessage` emitted to convAC room is **not received by B**
     - forged `query.userId=D` with A's cookie → server uses A (identity forgery fails)
  3. `pagination.test.js` — seed 120 msgs: default page 30, `limit` honored, `hasMore`,
     `before` cursor pages back with no overlap, response ascending
  4. `validation.test.js` — 7-char password rejected, 5000-char text → 400, empty message → 400
  5. `rate-limit.test.js` — custom app with limit 5 → 6th request 429
  6. `auth.test.js` — signup/login/check/logout happy paths (CI isn't only attack tests)
  - Gemini + Cloudinary mocked (`vi.mock`) where a happy path would call them.
- **CI** `.github/workflows/ci.yml`: push+PR → Node 22 → `npm ci` (backend) → `mongo:7`
  service container → `npm test`. Env: `TEST_MONGO_URL`, `JWT_SECRET`. Second job:
  frontend `npm ci` + `npm run build` to guard the JSX changes.

## Execution order

1. **WS0** refactor (app/server/socket split) → smoke `npm run dev`
2. **WS5 scaffold** (vitest+supertest+memory mongo) + write failing IDOR tests → **red**
3. **WS1 + WS2** socket auth + membership helpers → IDOR tests **green**
4. **WS3** schema + migration script + pagination + frontend fixes (sidebar shape, dedupe,
   load-older) → migration run against dev DB → smoke test
5. **WS4** validation + rate limits + their tests
6. **WS5** CI workflow committed → first green run
7. Manual smoke: two browser profiles, 1:1 + group + image + smart replies

## Decisions (defaults, overridable)

- **Migration:** write the backfill script and run it (idempotent, safe for Render prod) — *default: backfill, not wipe*.
- **`Conversation.messages[]`:** remove outright (WS3) — no transition period.
- **Password minimum:** 8 everywhere (schema + controller + signup UI copy) — seeds already comply.
- **Client `timestamp`:** dropped from send payload; ordering = server `createdAt`.
  Latency logging kept client-side via `Date.now()` at receipt if still wanted.
