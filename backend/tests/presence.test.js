import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import http from "node:http";
import request from "supertest";
import { io as ioc } from "socket.io-client";
import { createApp } from "../src/app.js";
import { initSocket, getIO, closeSocket } from "../src/lib/socket.js";
import * as presence from "../src/lib/presence.js";
import { userRoom, conversationRoom } from "../src/lib/rooms.js";
import Conversation from "../src/models/conversation.model.js";
import {
    signup,
    createConversation,
    sendMessage,
    sleep,
    app,
    authed,
} from "./helpers.js";

/**
 * Phase 2 real-time refactor:
 * - rooms: user:<id> + conversation:<id>, all joined on connect
 * - delta presence: presence:snapshot (unicast) + presence:join/leave (transitions)
 * - conversation lifecycle: invite/group create batch-joins connected members
 */
describe("realtime: rooms, presence deltas, lifecycle joins", () => {
    let server, url;
    // Users are re-created per test so refcounts always start from zero.
    const clients = [];

    const waitFor = async (predicate, { timeout = 4000, interval = 25 } = {}) => {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            const value = predicate();
            if (value) return value;
            await sleep(interval);
        }
        throw new Error("waitFor timed out");
    };

    const connect = (cookie) =>
        new Promise((resolve, reject) => {
            const socket = ioc(url, {
                extraHeaders: cookie ? { Cookie: cookie } : {},
                transports: ["websocket"],
                reconnection: false,
                timeout: 4000,
                autoConnect: false,
            });
            clients.push(socket);

            // Listeners attach synchronously after construction, before the
            // handshake completes, so no early event can be missed.
            const events = {
                snapshots: [],
                joins: [],
                leaves: [],
                legacy: [],
                messages: [],
                conversations: [],
                ready: [],
            };
            const filter = (list, userId) =>
                list.filter((e) => String(e.userId) === String(userId)).length;

            socket.on("presence:snapshot", (ids) => events.snapshots.push(ids));
            socket.on("presence:join", (p) => events.joins.push(p));
            socket.on("presence:leave", (p) => events.leaves.push(p));
            socket.on("getOnlineUsers", (ids) => events.legacy.push(ids));
            socket.on("newMessage", (m) => events.messages.push(m));
            socket.on("conversation:new", (m) => events.conversations.push(m));

            const timer = setTimeout(() => reject(new Error("connect timeout")), 4500);
            socket.on("realtime:ready", (ready) => events.ready.push(ready));
            socket.once("realtime:ready", () => {
                clearTimeout(timer);
                resolve({
                    socket,
                    events,
                    joins: (userId) => filter(events.joins, userId),
                    leaves: (userId) => filter(events.leaves, userId),
                });
            });
            socket.once("connect_error", (error) => { clearTimeout(timer); reject(error); });
            socket.connect();
        });

    /** Waits until the server-side auto-join query has put this socket in its rooms. */
    const waitInRoom = (room, socket) =>
        waitFor(() => getIO().sockets.adapter.rooms.get(room)?.has(socket.id));

    beforeAll(async () => {
        const app = createApp();
        server = http.createServer(app);
        initSocket(server);
        await new Promise((res) => server.listen(0, res));
        url = `http://localhost:${server.address().port}`;
    });

    afterEach(async () => {
        while (clients.length) {
            try {
                clients.pop().disconnect();
            } catch {
                /* already gone */
            }
        }
        // Barrier: the registry only empties once every server-side
        // disconnect handler has run, so the next test starts from zero tabs.
        await waitFor(() => presence.getOnlineUserIds().length === 0);
        expect(presence.getOnlineUserIds()).toEqual([]);
        presence.reset();
        vi.restoreAllMocks();
    });

    afterAll(async () => {
        await Promise.race([
            new Promise((res) => closeSocket(() => res())),
            new Promise((res) => setTimeout(res, 2000)),
        ]);
        if (server?.listening) {
            await new Promise((res) => server.close(res));
        }
        expect(getIO()).toBeNull();
    });

    it("auto-joins user:<me> and every conversation room, but no non-member rooms", async () => {
        const alice = await signup("Alice");
        const bob = await signup("Bob");
        const carol = await signup("Carol");
        const convAB = await createConversation(alice, bob.email);
        const convAC = await createConversation(alice, carol.email); // bob is NOT in it

        const { socket, events } = await connect(alice.cookie);

        // user room + snapshot happen synchronously inside the connection handler.
        expect(getIO().sockets.adapter.rooms.get(userRoom(alice.user._id))?.has(socket.id)).toBe(true);
        await waitFor(() => events.snapshots.length >= 1);
        expect(events.snapshots[0]).toContain(alice.user._id);

        // Alice is a member of both conversations -> both rooms.
        await waitInRoom(conversationRoom(convAB._id), socket);
        await waitInRoom(conversationRoom(convAC._id), socket);

        // Bob is only in convAB. Once his own auto-join query has completed
        // (proven by his membership in convAB), he must NOT be in convAC's room.
        const bobConn = await connect(bob.cookie);
        await waitInRoom(conversationRoom(convAB._id), bobConn.socket);
        const outsiderRoom = getIO().sockets.adapter.rooms.get(conversationRoom(convAC._id));
        expect(outsiderRoom?.has(bobConn.socket.id)).toBeFalsy();
    });

    it("delivers a REST send to every tab of a participant with no join_room", async () => {
        const alice = await signup("Alice");
        const bob = await signup("Bob");
        const conv = await createConversation(alice, bob.email);

        const tab1 = await connect(alice.cookie);
        const tab2 = await connect(alice.cookie);
        await waitInRoom(conversationRoom(conv._id), tab1.socket);
        await waitInRoom(conversationRoom(conv._id), tab2.socket);

        const res = await sendMessage(bob, conv._id, { text: "fan-out" });
        expect(res.status).toBe(201);

        const bothGot = () =>
            tab1.events.messages.some((m) => m.text === "fan-out") &&
            tab2.events.messages.some((m) => m.text === "fan-out");
        await waitFor(bothGot);
        expect(bothGot()).toBe(true);
    });

    it("emits deltas only on 0<->1 tab transitions", async () => {
        const alice = await signup("Alice");
        const observer = await signup("Observer");
        await createConversation(alice, observer.email);

        const obs = await connect(observer.cookie);
        await waitFor(() => obs.events.snapshots.length >= 1);

        const tab1 = await connect(alice.cookie);
        await waitFor(() => tab1.events.snapshots.length >= 1);
        await waitFor(() => obs.joins(alice.user._id) >= 1);
        expect(obs.joins(alice.user._id)).toBe(1);

        // Second tab: no additional presence:join.
        const tab2 = await connect(alice.cookie);
        await waitFor(() => tab2.events.snapshots.length >= 1);
        await sleep(250);
        expect(obs.joins(alice.user._id)).toBe(1);

        // Closing one of two tabs: no presence:leave.
        tab1.socket.disconnect();
        await sleep(300);
        expect(obs.leaves(alice.user._id)).toBe(0);

        // Closing the last tab: exactly one presence:leave.
        tab2.socket.disconnect();
        await waitFor(() => obs.leaves(alice.user._id) >= 1);
        expect(obs.leaves(alice.user._id)).toBe(1);
    });

    it("unicasts a snapshot with current users (including itself); others get none", async () => {
        const alice = await signup("Alice");
        const bob = await signup("Bob");
        await createConversation(alice, bob.email);

        const a = await connect(alice.cookie);
        await waitFor(() => a.events.snapshots.length >= 1);

        const b = await connect(bob.cookie);
        await waitFor(() => b.events.snapshots.length >= 1);

        const snapshot = b.events.snapshots[0];
        expect(snapshot).toContain(alice.user._id);
        expect(snapshot).toContain(bob.user._id);

        // Alice already received her own snapshot on connect — Bob's connect
        // must not send her another.
        await sleep(200);
        expect(a.events.snapshots).toHaveLength(1);

        // Once Alice is offline, a fresh connection no longer sees her.
        a.socket.disconnect();
        await waitFor(() => !presence.getOnlineUserIds().includes(alice.user._id));

        const carol = await signup("Carol");
        const c = await connect(carol.cookie);
        await waitFor(() => c.events.snapshots.length >= 1);
        expect(c.events.snapshots[0]).not.toContain(alice.user._id);
    });

    it("never emits the retired getOnlineUsers event", async () => {
        const alice = await signup("Alice");
        const bob = await signup("Bob");
        await createConversation(alice, bob.email);

        // Bob connects first so he observes Alice's connect/disconnect deltas.
        const b = await connect(bob.cookie);
        await waitFor(() => b.events.snapshots.length >= 1);
        const a = await connect(alice.cookie);
        await waitFor(() => a.events.snapshots.length >= 1);

        // Sanity: the replacement events do flow.
        await waitFor(() => b.joins(alice.user._id) >= 1);

        a.socket.disconnect();
        await waitFor(() => b.leaves(alice.user._id) >= 1);
        await sleep(150);

        expect(a.events.legacy).toHaveLength(0);
        expect(b.events.legacy).toHaveLength(0);
    });

    it("re-establishes all rooms on reconnect, without reopening the chat", async () => {
        const alice = await signup("Alice");
        const bob = await signup("Bob");
        const conv = await createConversation(alice, bob.email);
        const room = conversationRoom(conv._id);

        const a = await connect(alice.cookie);
        await waitInRoom(room, a.socket);
        expect(getIO().sockets.adapter.rooms.get(room)?.has(a.socket.id)).toBe(true);

        a.socket.disconnect();
        await waitFor(() => presence.getOnlineUserIds().length === 0);

        const reconnected = new Promise((res) => a.socket.once("realtime:ready", res));
        a.socket.connect();
        await reconnected;
        await waitInRoom(room, a.socket); // new socket id, still in the room

        expect(a.events.snapshots.length).toBeGreaterThanOrEqual(2);

        const res = await sendMessage(bob, conv._id, { text: "after-reconnect" });
        expect(res.status).toBe(201);
        await waitFor(() =>
            a.events.messages.some((m) => m.text === "after-reconnect")
        );
    });

    it("auto-joins an invitee who is already connected (WS3)", async () => {
        const alice = await signup("Alice");
        const dave = await signup("Dave");

        const daveConn = await connect(dave.cookie);
        await waitFor(() => daveConn.events.snapshots.length >= 1);

        const conv = await createConversation(alice, dave.email);
        const room = conversationRoom(conv._id);

        // The REST invite batch-joined Dave's live socket — no join_room call.
        await waitInRoom(room, daveConn.socket);

        const res = await sendMessage(alice, conv._id, { text: "hi dave" });
        expect(res.status).toBe(201);
        await waitFor(() =>
            daveConn.events.messages.some((m) => m.text === "hi dave")
        );
    });

    it("reports readiness only after discovery completes, even for users with no conversations", async () => {
        const alice = await signup("Ready Alice");
        let finish, started;
        const query = new Promise((resolve) => { finish = resolve; });
        const queried = new Promise((resolve) => { started = resolve; });
        vi.spyOn(Conversation, "find").mockImplementationOnce(() => ({
            select: () => ({ lean: () => { started(); return query; } }),
        }));
        const pending = connect(alice.cookie);
        await queried;
        expect(presence.isOnline(alice.user._id)).toBe(false);
        finish([]);
        const connection = await pending;
        expect(connection.events.ready).toEqual([{ roomsReady: true }]);
        expect(connection.events.snapshots).toHaveLength(1);
    });

    it("does not add ghost presence after disconnect during room discovery", async () => {
        const alice = await signup("Disconnect Alice");
        let finish, started;
        const query = new Promise((resolve) => { finish = resolve; });
        const queried = new Promise((resolve) => { started = resolve; });
        vi.spyOn(Conversation, "find").mockImplementationOnce(() => ({
            select: () => ({ lean: () => { started(); return query; } }),
        }));
        const socket = ioc(url, {
            extraHeaders: { Cookie: alice.cookie }, transports: ["websocket"], reconnection: false,
        });
        clients.push(socket);
        const events = [];
        socket.on("presence:snapshot", (data) => events.push(data));
        socket.on("realtime:ready", (data) => events.push(data));
        await queried;
        socket.disconnect();
        await waitFor(() => getIO().sockets.sockets.size === 0);
        finish([]);
        await sleep(50); // bounded observation after the deferred lookup resolves
        expect(events).toEqual([]);
        expect(presence.isOnline(alice.user._id)).toBe(false);
    });

    it("reports failed discovery and keeps the authorized join fallback usable", async () => {
        const alice = await signup("Fallback Alice");
        const bob = await signup("Fallback Bob");
        const conv = await createConversation(alice, bob.email);
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(Conversation, "find").mockImplementationOnce(() => ({
            select: () => ({ lean: () => Promise.reject(new Error("temporary DB failure")) }),
        }));
        const connection = await connect(alice.cookie);
        expect(connection.events.ready).toEqual([{ roomsReady: false }]);
        const ack = await connection.socket.timeout(4000).emitWithAck("join_room", conv._id);
        expect(ack).toEqual({ ok: true });
        await waitInRoom(conversationRoom(conv._id), connection.socket);
    });

    it("announces new conversations to all participant tabs and excludes outsiders", async () => {
        const alice = await signup("Announce Alice");
        const bob = await signup("Announce Bob");
        const outsider = await signup("Announce Outsider");
        const tabs = await Promise.all([connect(alice.cookie), connect(alice.cookie), connect(bob.cookie)]);
        const other = await connect(outsider.cookie);
        const conv = await createConversation(alice, bob.email);
        for (const tab of tabs) {
            await waitFor(() => tab.events.conversations.length === 1);
            expect(tab.events.conversations).toEqual([{ conversationId: conv._id }]);
            await waitInRoom(conversationRoom(conv._id), tab.socket);
        }
        expect(other.events.conversations).toEqual([]);
        const res = await sendMessage(alice, conv._id, { text: "immediate delivery" });
        expect(res.status).toBe(201);
        for (const tab of tabs) await waitFor(() => tab.events.messages.length === 1);
        expect(other.events.messages).toEqual([]);
    });

    it("deduplicates the creator and announces groups to each unique participant", async () => {
        const alice = await signup("Group Alice");
        const bob = await signup("Group Bob");
        const carol = await signup("Group Carol");
        const tabs = await Promise.all([connect(alice.cookie), connect(bob.cookie), connect(carol.cookie)]);
        const invalid = await request(app).post("/app/messages/group").set(authed(alice.cookie))
            .send({ groupName: "Not three people", emails: [alice.email, bob.email] });
        expect(invalid.status).toBe(400);
        const valid = await request(app).post("/app/messages/group").set(authed(alice.cookie))
            .send({ groupName: "Three people", emails: [alice.email, bob.email, carol.email, bob.email] });
        expect(valid.status).toBe(201);
        expect(valid.body.conversation.participants).toHaveLength(3);
        for (const tab of tabs) {
            await waitFor(() => tab.events.conversations.length === 1);
            expect(tab.events.conversations[0].conversationId).toBe(valid.body.conversation._id);
        }
    });

    it("does not return a failed create when notification fails after persistence", async () => {
        const alice = await signup("Persisted Alice");
        const bob = await signup("Persisted Bob");
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(getIO(), "in").mockImplementationOnce(() => { throw new Error("adapter failed"); });
        const conv = await createConversation(alice, bob.email);
        expect(await Conversation.exists({ _id: conv._id })).toBeTruthy();
    });

    it("discovers conversations created while the connection query is in flight", async () => {
        const alice = await signup("Concurrent Alice");
        const bob = await signup("Concurrent Bob");
        let finish, started;
        const query = new Promise((resolve) => { finish = resolve; });
        const queried = new Promise((resolve) => { started = resolve; });
        vi.spyOn(Conversation, "find").mockImplementationOnce(() => ({
            select: () => ({ lean: () => { started(); return query; } }),
        }));
        const pending = connect(alice.cookie);
        await queried;
        // Deliberately return a stale/empty query result. The user-room join
        // must cover conversations created after the query's snapshot.
        const conv = await createConversation(alice, bob.email);
        finish([]);
        const connection = await pending;
        await waitInRoom(conversationRoom(conv._id), connection.socket);
        expect((await sendMessage(bob, conv._id, { text: "during initialization" })).status).toBe(201);
        await waitFor(() => connection.events.messages.length === 1);
    });
});
