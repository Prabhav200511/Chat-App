import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import http from "node:http";
import { io as ioc } from "socket.io-client";
import { createApp } from "../src/app.js";
import {
    initSocket,
    getIO,
    getRecieverSocketId,
    closeSocket,
} from "../src/lib/socket.js";
import { signup, createConversation, sendMessage, sleep } from "./helpers.js";

describe("IDOR: socket identity and room membership", () => {
    let server, url;
    let alice, bob, dave, convAC;
    const clients = [];

    const connectSocket = (cookie, query = {}) =>
        new Promise((resolve, reject) => {
            const socket = ioc(url, {
                extraHeaders: cookie ? { Cookie: cookie } : {},
                query,
                transports: ["websocket"],
                reconnection: false,
                timeout: 4000,
            });
            clients.push(socket);
            socket.once("connect", () => resolve(socket));
            socket.once("connect_error", (err) => reject(err));
            setTimeout(() => reject(new Error("connect timeout")), 4500);
        });

    const joinRoom = (socket, conversationId) =>
        new Promise((resolve, reject) => {
            socket
                .timeout(4000)
                .emit("join_room", conversationId, (err, res) =>
                    err ? reject(err) : resolve(res)
                );
        });

    beforeAll(async () => {
        const app = createApp();
        server = http.createServer(app);
        initSocket(server);
        await new Promise((res) => server.listen(0, res));
        url = `http://localhost:${server.address().port}`;

        alice = await signup("Alice");
        bob = await signup("Bob");
        const carol = await signup("Carol");
        dave = await signup("Dave");
        convAC = await createConversation(alice, carol.email);
    });

    afterEach(() => {
        while (clients.length) {
            try {
                clients.pop().disconnect();
            } catch {
                /* already gone */
            }
        }
    });

    afterAll(async () => {
        await Promise.race([
            new Promise((res) => closeSocket(() => res())),
            new Promise((res) => setTimeout(res, 2000)),
        ]);
        if (server?.listening) {
            await new Promise((res) => server.close(res));
        }
    });

    it("rejects connections without a JWT cookie", async () => {
        await expect(connectSocket(null)).rejects.toMatchObject({
            message: "unauthorized",
        });
    });

    it("rejects connections with a garbage token", async () => {
        await expect(
            connectSocket("jwt=not-a-real-token")
        ).rejects.toMatchObject({ message: "unauthorized" });
    });

    it("ignores a forged query.userId and uses the cookie identity", async () => {
        const socket = await connectSocket(alice.cookie, {
            userId: dave.user._id,
        });

        // The server must map the authenticated user (Alice), not the forged one.
        expect(getRecieverSocketId(alice.user._id)).toBe(socket.id);
        expect(getRecieverSocketId(dave.user._id)).toBeUndefined();
    });

    it.each(["not-a-function", 42, { ok: true }])(
        "survives a malformed acknowledgement argument: %j",
        async (malformedAck) => {
            const socket = await connectSocket(alice.cookie);
            socket.emit("join_room", "invalid-id", malformedAck);
            // A subsequent acknowledgement proves the handler and server survived.
            expect(await joinRoom(socket, convAC._id)).toEqual({ ok: true });
        }
    );

    it("normalizes uppercase conversation IDs to the broadcast room", async () => {
        const socket = await connectSocket(alice.cookie);
        expect(await joinRoom(socket, convAC._id.toUpperCase())).toEqual({ ok: true });
        expect(getIO().sockets.adapter.rooms.get(convAC._id)?.has(socket.id)).toBe(true);
    });

    it("only lets participants join a conversation room", async () => {
        const socketA = await connectSocket(alice.cookie);
        const socketB = await connectSocket(bob.cookie);

        const aJoin = await joinRoom(socketA, convAC._id);
        expect(aJoin).toEqual({ ok: true });

        const bJoin = await joinRoom(socketB, convAC._id);
        expect(bJoin.ok).toBe(false);

        const bogus = await joinRoom(socketB, "definitely-not-an-id");
        expect(bogus.ok).toBe(false);

        const room = getIO().sockets.adapter.rooms.get(convAC._id);
        expect(room?.has(socketA.id)).toBe(true);
        expect(room?.has(socketB.id)).toBeFalsy();
    });

    it("delivers room messages to members but not to outsiders", async () => {
        const socketA = await connectSocket(alice.cookie);
        const socketB = await connectSocket(bob.cookie);

        await joinRoom(socketA, convAC._id);
        await joinRoom(socketB, convAC._id); // outsider: rejected

        const receivedByA = new Promise((resolve) =>
            socketA.once("newMessage", resolve)
        );
        const bMessages = [];
        socketB.on("newMessage", (m) => bMessages.push(m));

        getIO()
            .to(convAC._id)
            .emit("newMessage", { _id: "probe", text: "secret" });

        const message = await receivedByA;
        expect(message.text).toBe("secret");

        await sleep(300);
        expect(bMessages).toHaveLength(0);
    });

    it("relays a REST-sent message to the room in real time", async () => {
        const socketA = await connectSocket(alice.cookie);
        socketA.emit("join_room", convAC._id);
        await sleep(150); // membership is established server-side

        const received = new Promise((resolve) =>
            socketA.once("newMessage", resolve)
        );

        const res = await sendMessage(alice, convAC._id, {
            text: "realtime hello",
        });
        expect(res.status).toBe(201);

        const message = await Promise.race([
            received,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error("no realtime delivery")), 4000)
            ),
        ]);
        expect(message.text).toBe("realtime hello");
    });
});
