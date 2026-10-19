import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { parse as parseCookie } from "cookie";
import mongoose from "mongoose";
import Conversation from "../models/conversation.model.js";
import * as presence from "./presence.js";
import { conversationRoom, userRoom } from "./rooms.js";

let io = null;

export function getIO() {
    return io;
}

/**
 * Server-side batch join: puts every connected tab of every participant into
 * the conversation's room. Called from REST handlers (invite, group create)
 * where there is no socket context — an offline participant simply joins on
 * next connect via the auto-join query in initSocket().
 *
 * NOTE: there is no participant-removal path today. If one is added it must
 * call `ioRef.in(participantIds.map(userRoom)).socketsLeave(conversationRoom(id))`.
 */
export function joinUsersToConversation(conversationId, participantIds) {
    const ioRef = getIO();
    if (!ioRef || !participantIds?.length) return; // REST-only test apps: no-op
    ioRef
        .in(participantIds.map(userRoom))
        .socketsJoin(conversationRoom(conversationId));
}

/**
 * Attaches Socket.IO to an http server.
 * - Handshake is authenticated with the same JWT cookie the REST API uses;
 *   the client-sent query.userId is intentionally ignored.
 * - On connect the socket joins user:<id> (presence) plus EVERY conversation
 *   room the user participates in, so delivery never depends on the client
 *   having opened a chat first — and a reconnect re-establishes all rooms.
 * - join_room stays as an idempotent ensure that heals a failed auto-join.
 */
export function initSocket(httpServer) {
    io = new Server(httpServer, {
        cors: {
            origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
            credentials: true,
        },
    });

    io.use((socket, next) => {
        try {
            const cookies = parseCookie(socket.handshake.headers.cookie || "");
            const token = cookies.jwt;
            if (!token) return next(new Error("unauthorized"));

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            if (!decoded?.userId) return next(new Error("unauthorized"));

            socket.userId = decoded.userId;
            next();
        } catch {
            next(new Error("unauthorized"));
        }
    });

    io.on("connection", async (socket) => {
        const userId = socket.userId;

        // 1. Presence: joins user:<id>, tracks the tab, broadcasts deltas.
        presence.onConnect(io, socket);

        // Handlers are registered before the auto-join query below so a
        // client emitting join_room (or disconnecting) mid-query is never
        // met with a missing listener.
        socket.on("join_room", async (conversationId, ack) => {
            const respond = typeof ack === "function" ? ack : () => {};
            try {
                if (typeof conversationId !== "string" || !mongoose.Types.ObjectId.isValid(conversationId)) {
                    respond({ ok: false, message: "Invalid conversation id" });
                    return;
                }
                const roomId = conversationId.toLowerCase();

                // Membership check: only participants may join the room.
                const exists = await Conversation.exists({
                    _id: roomId,
                    participants: userId,
                });

                if (!exists) {
                    respond({ ok: false, message: "Conversation not found" });
                    return;
                }

                await socket.join(conversationRoom(roomId));
                respond({ ok: true });
            } catch {
                respond({ ok: false, message: "Could not join conversation" });
            }
        });

        socket.on("disconnect", () => {
            presence.onDisconnect(io, socket);
        });

        // 2+3. Join the user's entire conversation set up front: one indexed
        // query, one bulk socket.join. A DB failure only means the client's
        // join_room ensure has to heal this socket — the connection survives.
        try {
            const conversations = await Conversation.find({ participants: userId })
                .select("_id")
                .lean();
            if (conversations.length > 0) {
                await socket.join(conversations.map((c) => conversationRoom(c._id)));
            }
        } catch (error) {
            console.error("Auto-join of conversation rooms failed:", error);
        }
    });

    return io;
}

export function closeSocket(callback) {
    if (!io) {
        callback?.();
        return;
    }
    io.close(callback);
}
