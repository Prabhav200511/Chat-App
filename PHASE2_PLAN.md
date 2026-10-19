# Phase 2: Real-time Refactor — Implementation Plan

**Goal:** move delivery onto namespaced `user:<id>` and `conversation:<id>` rooms, join a user's
*entire* room set on connect (no lazy joining), replace the full-array online broadcast with
**delta presence** that is correct across multiple tabs, and isolate all presence logic into one
module that can later be lifted behind MyCache pub/sub.

---

## Status (2026-10-19)

| WS | State |
|---|---|
| WS0 presence module extraction (no behavior change) | ✅ done — `src/lib/presence.js` |
| WS1 room naming + auto-join all rooms on connect | ✅ done — `src/lib/rooms.js`, connect-time join |
| WS2 delta presence with multi-tab support | ✅ done — snapshot/join/leave, `getOnlineUsers` retired |
| WS3 conversation lifecycle auto-join (invite/group) | ✅ done — `joinUsersToConversation` |
| WS4 frontend delta listeners + socket lifecycle fixes | ✅ done — `useAuthStore.js` |
| WS5 tests (backend presence suite + frontend reducer tests) | ✅ done — 70 backend + 18 frontend green |

**Result:** the gate is met (and exceeded). Pre-Phase-2 backend baseline was **63** tests
(`validation` 28, `pagination` 9, `idor.socket` 10 grew in commit `147454d`, which landed after
this plan was written); **+7** new `presence.test.js` cases → **70** backend tests. Frontend:
11 existing `chat-store.test.js` + **7** new `presence.test.js` = **18**. `npm run build` passes.

**Manual follow-up (not blocking):** run `node scripts/migrate-phase2.js` once a `MONGO_URL` is
reachable, so the `{ participants: 1 }` index exists before the connect-time query takes traffic.
(Phase 1's `migrate-phase1.js` still runs independently.) Hosted CI runs on the next push.

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
| S→C | `newMessage` | message doc | to `conversation:<id>` only |
| ~~S→C~~ | ~~`getOnlineUsers`~~ | | **retired** (breaking wire change → ship server+client together) |
| C→S | `join_room` | convId, ack | kept as an idempotent **ensure** (heals a failed auto-join) |

---

## WS0 — Extract presence module (pure refactor, no behavior change)

Tests must stay green after this workstream.

- **New `src/lib/presence.js`** — the only owner of `Map<userId, Set<socketId>>`:
  ```js
  export function onConnect(io, socket)   // join user room, track, return { firstTab }
  export function onDisconnect(io, socket)// untrack, return { lastTab }
  export function isOnline(userId)
  export function getOnlineUserIds()
  export function getSocketIds(userId)
  export function reset()                 // tests only
  ```
  - `onConnect`/`onDisconnect` take `io` as an argument (never import a singleton) — this is the
    seam that lets a later phase swap `io.emit` for MyCache pub/sub without touching callers.
  - Today's connect/disconnect `console.log` moves in here (gate behind `NODE_ENV !== "test"`).
  - No imports beyond `rooms.js` → the module can be moved verbatim.
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
  1. `presence.onConnect(io, socket)` → joins `user:<id>`, tracks, `{ firstTab }`.
  2. One DB query: `Conversation.find({ participants: userId }).select("_id").lean()`.
  3. Single `socket.join(ids.map(conversationRoom))` call for the whole array.
  4. DB failure → log and continue; the connection stays alive and the client-side `join_room`
     ensure (WS4) heals it.
- **`message.controller.js:167`:** `getIO()?.to(conversationRoom(conversation._id)).emit("newMessage", …)`.
- **`join_room` handler:** unchanged logic (membership check + ack) but joins `conversationRoom(id)`.
- **Index:** `conversation.model.js` gets `{ participants: 1 }` (this query now runs on *every*
  connect, plus `getUsersforSidebar` and `conversationAccess` already use it). Add
  `Conversation.syncIndexes()` to the migration script or a one-off `migrate-phase2.js`.
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
- Emission stays inside `presence.js` so the future broker swap is a one-file change.

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
  ```
  Connected participants join instantly (both sides of a fresh invite, mid-group-create); offline
  participants join on their next connect via WS1's query.
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
  - `disconnectSocket`: `socket.removeAllListeners(); socket.disconnect(); set({ socket: null, onlineUsers: [] })`
    so a logout/login as a different user can't inherit listeners or stale presence.
- **Reconnect needs no client code:** Socket.IO re-runs the server `connection` handler, so the
  full room set + a fresh snapshot are re-established automatically — this fixes today's
  "reconnect leaves me in no rooms" bug.

**`useChatStore.js`:**
- Keep the `join_room` emit in `getMessages` as an idempotent ensure (ack + toast unchanged).
  It is now redundant in the happy path but heals a failed WS1 auto-join and keeps the
  membership-enforcement tests meaningful.
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

- **Room prefixes** `conversation:` / `user:` — a breaking wire change, but server and client ship
  from one repo/deploy, so there is no compatibility window.
- **Presence protocol:** `presence:snapshot` (unicast) + `presence:join`/`presence:leave` with a
  `{ userId }` object payload (extensible later for typing/last-seen) — `getOnlineUsers` retired.
- **Frontend keeps `onlineUsers: []`** — zero component churn; handlers enforce Set semantics.
- **`join_room` kept**, not deleted: it becomes an idempotent ensure rather than the primary
  mechanism.
- **Presence stays process-local** (single Render instance, as today). Deltas broadcast only to
  locally-connected sockets; the `io`-argument API in `presence.js` is the designated seam for
  MyCache pub/sub in a later phase — no other file changes when that happens.
- **Multi-tab truth = server-side socket refcount**; no client-side tab coordination.
- **Out of scope:** typing indicators, read receipts, presence heartbeat/TTL, delivery guarantees
  (at-least-once acks), sidebar unread previews (stretch only).

## Risks / gotchas

- **Ordering races** between snapshot and deltas → reducer must be idempotent (WS4 handles it).
- **New indexed query per connect** → add the `participants` index *before* this ships (WS1).
- **Heavy accounts** joining thousands of rooms on connect: one query + one bulk `socket.join`;
  if a user ever has an absurd conversation count, cap/ paginate — not a concern at current scale.
- **Presence registry leaks** if a socket is neither connected nor disconnected cleanly —
  `presence.reset()` in test teardown, and Socket.IO's own disconnect guarantees cover prod.
- Two sources of truth during rollout (old clients listening for `getOnlineUsers`) — acceptable
  because deploy is atomic; do **not** emit both events long-term.
