/**
 * Room name namespaces — the single place room strings are built.
 *
 * - `user:<id>`         every socket joins its own on connect; per-user delivery
 *                       across all tabs (replaces getRecieverSocketId).
 * - `conversation:<id>` one per conversation; all participants join on connect
 *                       (plus explicitly via the idempotent join_room ensure).
 *
 * Both lowercased: conversation ids arrive from client join_room calls as raw
 * hex (possibly uppercase) and from mongoose as lowercase, so normalization
 * here guarantees one canonical room per entity.
 */
export const userRoom = (userId) => `user:${String(userId).toLowerCase()}`;
export const conversationRoom = (convId) =>
    `conversation:${String(convId).toLowerCase()}`;
