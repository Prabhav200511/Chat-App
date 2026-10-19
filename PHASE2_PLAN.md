# Phase 2: Real-time Refactor — Implementation Plan

**Goal:** move delivery onto namespaced `user:<id>` and `conversation:<id>` rooms, join a user's
*entire* room set on connect (no lazy joining), replace the full-array online broadcast with
**delta presence** that is correct across multiple tabs, and isolate all presence logic into one
module that provides a boundary for a later distributed presence design.

---

## Status (2026-10-19)

| WS | State |
|---|---|
| WS0 presence module extraction (no behavior change) | ✅ done — `src/lib/presence.js` |
| WS1 room naming + auto-join all rooms on connect | ✅ done — `src/lib/rooms.js`, connect-time join |
| WS2 delta presence with multi-tab support | ✅ done — snapshot/join/leave, `getOnlineUsers` retired |
| WS3 conversation lifecycle auto-join (invite/group) | ✅ done — `joinUsersToConversation` |
| WS4 frontend delta listeners + socket lifecycle fixes | ✅ done — `useAuthStore.js` |
| WS5 tests (backend presence/lifecycle + frontend store regressions) | ✅ reviewed — expanded regression coverage; results recorded below |

**Review fixes:** readiness is now explicit and emitted after room discovery; a disconnected
socket cannot become online when a pending query resolves. New conversations notify every
participant tab and refresh the sidebar. Reconnects refresh the selected chat from REST after
an authorized join acknowledgement. Account changes clear chat data and invalidate stale
requests/events. Group minimums count unique participants, and index creation is additive.

The original implementation had 70 backend and 18 frontend tests. The review adds lifecycle,
creation-race, index-preservation, reconnect/catch-up and account-isolation regressions.
Final verification results are recorded at the end of this document.

**Deployment follow-up:** run `node scripts/migrate-phase2.js` once a `MONGO_URL` is
reachable, so the `{ participants: 1 }` index exists before the connect-time query takes traffic.
(Phase 1's `migrate-phase1.js` still runs independently.) Verify both migrations and the
two-browser smoke checks in the deployment environment. Hosted CI runs on push.

---

## Why (current problems)

1. **Lazy room joining.** `join_room` fires only when a chat is opened (`useChatStore.getMessages`).
   Consequences: nothing is received for a chat you haven't opened; between connect and open you
   silently miss messages; **after a Socket.IO reconnect you are in zero rooms** until you reopen a
   chat (the client never re-joins).
2. **Raw-id rooms.** Rooms are bare ObjectIds (`socket.js:67`, `message.controller.js:167`). Works
   today only because nothing else creates rooms — it leaves no room namespace for `user:<id>`.
3. **Full-array presence broadcast.** `io.emit("getOnlineUsers", [...all keys])` fires on *every*
   connect *and* disconnect (`socket.js:58`, `socket.js:95`) — O(online users) payload per tab
   open/close, even though multi-tab refcounting already exists in `userSocketMap`.
4. **Presence is inlined in `initSocket`.** Registry, refcounting, broadcasting and logging are
   interleaved with auth + room membership, so none of it can move to a broker later.
5. **`getRecieverSocketId` picks one socket** (`socket.js:16`) — inherently multi-tab-broken, and
   already dead code except for one test. User rooms replace it.

---

## Target contract

### Rooms

| Room | Joined by | Used for |
|---|---|---|
| `user:<userId>` | every socket, on connect (no DB) | per-user delivery across **all** tabs; replaces `getRecieverSocketId`; batch-join hook for new conversations |
| `conversation:<convId>` (lowercased) | every participant socket, on connect; again on `join_room`; on conversation creation for all participants | `newMessage` fan-out |

Room names live in one place: `src/lib/rooms.js` → `userRoom(id)`, `conversationRoom(id)`.

### Wire events

| Direction | Event | Payload | Notes |
|---|---|---|---|
| S→C | `presence:snapshot` | `string[]` online userIds | sent **once, to the connecting socket only** (includes itself) |
| S→C | `presence:join` | `{ userId }` | broadcast only when the user goes 0→1 tabs |
| S→C | `presence:leave` | `{ userId }` | broadcast only when the user goes 1→0 tabs |
| S→C | `realtime:ready` | `{ roomsReady }` | application readiness after snapshot; false reports degraded room discovery |
| S→C | `conversation:new` | `{ conversationId }` | invalidates each participant's sidebar, across all tabs |
| S→C | `newMessage` | message doc | to `conversation:<id>` only |
| ~~S→C~~ | ~~`getOnlineUsers`~~ | | **retired** (breaking wire change → ship server+client together) |
| C→S | `join_room` | convId, ack | kept as an idempotent **ensure** (heals a failed auto-join) |

---

## WS0 — Extract presence module (pure refactor, no behavior change)

Tests must stay green after this workstream.

- **New `src/lib/presence.js`** — the only owner of `Map<userId, Set<socketId>>`:
  ```js
  export function onConnect(io, socket)   // track after initialization, snapshot/delta, return { firstTab }
  export function onDisconnect(io, socket)// untrack, return { lastTab }
  export function isOnline(userId)
  export function getOnlineUserIds()
  export function getSocketIds(userId)
  export function reset()                 // tests only
  ```
  - `onConnect`/`onDisconnect` take `io` as an argument (never import a singleton) — this is the
    seam for future work; distributed transitions and crash cleanup still require explicit design.
  - Routine connect/disconnect logs are removed; initialization failures retain error logs.
  - Room management stays in `socket.js`; the presence module owns only its registry and emissions.
- **`src/lib/socket.js`** shrinks to: CORS + JWT middleware, `presence.onConnect/onDisconnect`
  delegation, conversation-room joining, and the `join_room` handler. Existing
  `getIO()`/`closeSocket()` exports stay.
- Re-export nothing: `getRecieverSocketId` is deleted here; its test is updated in WS1/WS5 to
  assert `user:`-room membership instead.
- For WS0 the still-inlined broadcast is preserved (`io.emit("getOnlineUsers", getOnlineUserIds())`)
  so this workstream is provably behavior-preserving.

## WS1 — Room naming + join all rooms on connect

- **`src/lib/rooms.js` (new):** `userRoom(userId)`, `conversationRoom(convId)` (lowercases, same
  normalization `join_room` does today).
- **Connect sequence** (in `socket.js` connection handler):
  1. Register disconnect and authorized `join_room` handlers before the first await.
  2. Await the authenticated user-room join, then query the user's conversation IDs. This order
     covers conversations created concurrently with discovery through the already-joined user room.
  3. Check connectivity after awaits; bulk-join the conversation rooms, then track presence
     and emit its snapshot followed by `realtime:ready { roomsReady: true }`.
  4. Discovery failure → log, keep the connected socket usable and emit readiness with
     `roomsReady: false`. The selected-chat join fallback helps that room; it does not imply
     every room recovered. Initialization has an explicit rejection boundary.
- **`message.controller.js:167`:** `getIO()?.to(conversationRoom(conversation._id)).emit("newMessage", …)`.
- **`join_room` handler:** unchanged logic (membership check + ack) but joins `conversationRoom(id)`.
- **Index:** `conversation.model.js` gets `{ participants: 1 }` (this query now runs on *every*
  connect, plus `getUsersforSidebar` and `conversationAccess` already use it). Add
  additive `Conversation.createIndexes()` in `migrate-phase2.js`. Do not use `syncIndexes()`:
  it can remove operator-created indexes absent from the schema. The migration has a regression test.
- **Test updates in the same workstream (keeps the suite green per step):**
  - `idor.socket.test.js` adapter assertions → `conversation:${convAC._id}`
  - delivery probe `.to(convAC._id)` → `.to(conversationRoom(convAC._id))`
  - forged-`query.userId` test → assert the socket sits in `user:<alice>` and not `user:<dave>`.

## WS2 — Delta presence with multi-tab support

Replace both `io.emit("getOnlineUsers", …)` sites inside `presence.js`:

```js
// onConnect
socket.emit("presence:snapshot", getOnlineUserIds());   // self already tracked
if (firstTab) socket.broadcast.emit("presence:join", { userId });

// onDisconnect
if (lastTab) socket.broadcast.emit("presence:leave", { userId });
```

- **Multi-tab rule:** deltas fire only on the 0↔1 tab transitions of the server-side refcount —
  opening/closing a second tab emits nothing. The server is the source of truth; no client-side
  tab coordination (BroadcastChannel/heartbeat) is needed.
- Snapshot is **unicast** to the newcomer, so a fresh tab learns the current state without a
  full-list broadcast, and existing tabs never see a redundant event.
- Snapshot and deltas can interleave (a `presence:join` may arrive before/after a snapshot that
  already contains that id) → the reducer in WS4 must be idempotent **by design**, not by luck.
- Emission stays inside `presence.js`. Multiple instances will also need atomic shared
  presence transitions, crash/TTL cleanup, a compatible room adapter and shared rate limits.

## WS3 — Conversation lifecycle: auto-join created rooms

A room is only useful if everyone is in it. New conversations are created in two REST paths that
run *outside* any socket handler:

- `inviteUserByEmail` (`message.controller.js:35`) and `createGroup` (`message.controller.js:259`)
  call, right after `Conversation.create`:
  ```js
  joinUsersToConversation(conversation._id, participants);
  ```
- **`joinUsersToConversation`** exported from `socket.js`:
  ```js
  const ioRef = getIO(); if (!ioRef) return;   // REST-only test apps: no-op
  ioRef.in(participantIds.map(userRoom)).socketsJoin(conversationRoom(convId));
  ioRef.to(participantIds.map(userRoom)).emit("conversation:new", { conversationId: String(convId) });
  ```
  Connected participants join instantly (both sides of a fresh invite, mid-group-create); offline
  participants join on their next connect via WS1's query.
- Notifications use unique participant rooms and the saved conversation. Failures after
  persistence are logged without converting a successful create into an HTTP 500. Group
  membership is deduplicated before enforcing its three-person minimum.
- Sidebar listeners refetch the existing formatted `/users` response on the event and on
  readiness/reconnect; overlapping requests and old account responses cannot overwrite it.
- No participant-removal path exists today. If one is added later it must call `socketsLeave` —
  note this in a comment.

## WS4 — Frontend: delta listeners + socket lifecycle

**`useAuthStore.js`:**
- Drop the `getOnlineUsers` listener; register in `connectSocket`:
  ```js
  socket.on("presence:snapshot", (ids) => set({ onlineUsers: [...new Set(ids)] }));
  socket.on("presence:join", ({ userId }) => set((s) =>
      s.onlineUsers.includes(userId) ? s : { onlineUsers: [...s.onlineUsers, userId] }));
  socket.on("presence:leave", ({ userId }) => set((s) =>
      ({ onlineUsers: s.onlineUsers.filter((id) => id !== userId) }));
  ```
- Keep the `onlineUsers` **array** shape → `Sidebar.jsx` and `ChatHeader.jsx` `.includes()` calls
  stay untouched. Set semantics are enforced in the handlers above.
- **Lifecycle fixes (real bugs today):**
  - guard becomes `if (!authUser || get().socket) return;` — currently a *disconnected* socket
    passes `socket?.connected === false` and spawns a second instance with duplicated listeners.
  - Use `autoConnect: false`; register listeners and store the socket before connecting.
  - Disconnect/error clears presence and readiness. Teardown removes exact owned handlers,
    disconnects even a pending connection, and clears the socket reference.
  - Socket/account generations reject obsolete callbacks and pending auth responses.
- **Reconnect restores rooms and also requires client catch-up:** the server repeats discovery;
  each readiness event advances a frontend connection epoch, refreshing the sidebar and
  selected conversation. A join acknowledgement precedes the catch-up read, so new live
  messages merge with the REST response. A latest page does not replay unlimited missed history;
  older persisted messages remain available through composite-cursor pagination.

**`useChatStore.js`:**
- Keep the `join_room` emit in `getMessages` as an idempotent ensure (ack + toast unchanged).
  It is now redundant in the happy path but heals a failed WS1 auto-join and keeps the
  membership-enforcement tests meaningful.
- Component subscriptions depend on the actual socket; cleanup captures that exact instance
  and listener. Account changes clear selected chat, messages and sidebar and invalidate pending
  requests. Sidebar loading uses the store's actual `isUsersLoading` property.
- `subscribeToMessages` already filters by `newMessage.conversationId === selectedUser._id`,
  which is now the *only* thing standing between you and every chat's traffic — keep it.
- **Optional stretch (flagged, not required):** since the socket now receives all conversations'
  messages, add a handler that updates `users[]` previews/unread for non-selected chats.

## WS5 — Tests

**New `backend/tests/presence.test.js`:**
1. connect auto-joins `user:<me>` and every conversation room; does **not** join a non-member conv.
2. REST send with **no** `join_room` call is delivered to *both* tabs of a participant
   (multi-tab fan-out through the room, not one socket).
3. Multi-tab deltas: 2nd tab connects → zero extra `presence:join`; 1st tab closes → no
   `presence:leave`; last tab closes → exactly one `presence:leave`.
4. A newly connected socket receives `presence:snapshot` containing already-online users
   (and itself), unicast — other sockets receive no snapshot.
5. Regression guard: `getOnlineUsers` is never emitted.
6. Disconnect → reconnect re-establishes all rooms (message still delivered without re-opening
   the chat).
7. Invite while the invitee is connected → invitee's socket auto-joins → message delivered with
   no `join_room` (WS3).

**Updated `backend/tests/idor.socket.test.js`:** room-name assertions, `conversationRoom()` probe,
identity assertion via `user:` rooms. All existing IDOR/membership/ack cases must keep passing.

**New `frontend/tests/presence.test.js`** (mock socket the way `chat-store.test.js` does):
snapshot replaces state; duplicate `presence:join` is idempotent; `presence:leave` removes;
`leave` for an unknown user is a no-op; logout clears `onlineUsers`.

**Gate:** 63 backend + 11 frontend tests green, then `npm run build`.

---

## Execution order

1. **WS0** extraction → backend suite green (pure refactor).
2. **WS1** rooms + connect-time auto-join + `idor.socket.test.js` updates + `participants` index →
   green.
3. **WS2** server-side deltas → new `presence.test.js` (cases 1–6) green.
4. **WS3** lifecycle joins → `presence.test.js` case 7 green.
5. **WS4 + WS5 frontend** → frontend tests green + production build.
6. Manual smoke: two tabs of one profile (presence dot never flickers, message lands in both),
   two profiles, a group, invite while the other user is online, then DevTools offline → online
   (rooms + snapshot come back with no chat reopen).

## Decisions (defaults, overridable)

- **Room prefixes** `conversation:` / `user:` are centralized. The presence-event change
  requires matching server/client versions and a refresh of existing browser tabs.
- **Presence protocol:** `presence:snapshot` (unicast) + `presence:join`/`presence:leave` with a
  `{ userId }` object payload (extensible later for typing/last-seen) — `getOnlineUsers` retired.
- **Frontend keeps `onlineUsers: []`** — zero component churn; handlers enforce Set semantics.
- **`join_room` kept**, not deleted: it becomes an idempotent ensure rather than the primary
  mechanism.
- **Presence stays process-local** (single Render instance). The module boundary helps a future
  broker integration, but distributed room readiness and shared stores require more work.
- **Multi-tab truth = server-side socket refcount**; no client-side tab coordination.
- **Out of scope:** typing indicators, read receipts, presence heartbeat/TTL, delivery guarantees
  (at-least-once acks), sidebar unread previews (stretch only).

## Risks / gotchas

- **Ordering races** between snapshot and deltas → reducer must be idempotent (WS4 handles it).
- **New indexed query per connect** → add the `participants` index *before* this ships (WS1).
- **Heavy accounts** joining thousands of rooms on connect: one query + one bulk `socket.join`;
  if a user ever has an absurd conversation count, cap/ paginate — not a concern at current scale.
- **Presence registry leaks** if a socket is neither connected nor disconnected cleanly —
  disconnect handlers are registered before awaits, pending discovery checks connectivity,
  and teardown verifies empty presence before resetting it.
- Two sources of truth during rollout (old clients listening for `getOnlineUsers`) — acceptable
  only with an explicit client refresh requirement. Existing browser code is not replaced by
  a server deployment or transport reconnect; do **not** emit both events long-term.

## Review verification (2026-10-19)

- Backend: **78 tests across 8 suites passed**, using a unique temporary MongoDB database.
- Frontend: **29 tests across 2 suites passed**, including subscription ordering, sidebar
  races, account cleanup, stale callbacks and reconnect/readiness behavior. Local tests used
  the working backend Vitest 3.2.7 runtime to avoid OneDrive dependency read errors.
- Frontend production build passed. Existing CI runs both standard test commands and build
  on push; check its result for the published commit.
- The migration preservation test runs the real Phase 2 script against the temporary database
  and confirms that operator-created indexes survive. No development/production database was migrated.
- Browser smoke checks and deployment migration/index verification remain follow-up work;
  automated checks do not establish those rollout steps as complete.
