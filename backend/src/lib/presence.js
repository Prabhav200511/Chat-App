/**
 * Presence registry — the ONLY owner of Map<userId, Set<socketId>>.
 *
 * Multi-tab truth lives in the server-side refcount: deltas fire only on the
 * 0<->1 tab transitions of that set, so opening or closing a second tab emits
 * nothing. `io` is always an argument, never an import — this module can be
 * adapted to a distributed store later; atomic transitions and crash cleanup
 * will still need an explicit distributed design.
 */
const connections = new Map();

/**
 * Called after room initialization: tracks the tab and reports whether this
 * is the user's first tab. Transport and room ownership stay in socket.js.
 *
 * Wire protocol (delta presence):
 * - `presence:snapshot` unicast to the newcomer with the current online ids
 *   (self already tracked, so self is included).
 * - `presence:join` broadcast ONLY on the 0->1 tab transition, so a second
 *   tab of an already-online user emits nothing.
 */
export function onConnect(io, socket) {
    if (!socket.connected) return { firstTab: false };
    const userId = String(socket.userId).toLowerCase();

    let sockets = connections.get(userId);
    if (!sockets) {
        sockets = new Set();
        connections.set(userId, sockets);
    }
    const firstTab = !sockets.size;
    sockets.add(socket.id);

    // A fresh tab learns the current state without a full-list broadcast.
    socket.emit("presence:snapshot", getOnlineUserIds());
    if (firstTab) socket.broadcast.emit("presence:join", { userId });

    return { firstTab };
}

export function onDisconnect(io, socket) {
    const userId = String(socket.userId).toLowerCase();
    const sockets = connections.get(userId);
    let lastTab = false;
    if (sockets?.delete(socket.id)) {
        if (sockets.size === 0) {
            connections.delete(userId);
            lastTab = true;
        }
    }

    // Only the last tab closing makes the user actually offline.
    if (lastTab) socket.broadcast.emit("presence:leave", { userId });

    return { lastTab };
}

export const isOnline = (userId) => connections.has(String(userId));

/** All currently-online user ids (includes the caller's own after connect). */
export const getOnlineUserIds = () => [...connections.keys()];

export const getSocketIds = (userId) => [
    ...(connections.get(String(userId)) ?? []),
];

/** Tests only: drop all tracked connections between test cases. */
export function reset() {
    connections.clear();
}
