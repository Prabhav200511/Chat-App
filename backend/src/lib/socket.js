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
    try {
        const rooms = [...new Set(participantIds.map(userRoom))];
        // The current in-memory adapter completes this join synchronously.
        ioRef.in(rooms).socketsJoin(conversationRoom(conversationId));
        ioRef.to(rooms).emit("conversation:new", { conversationId: String(conversationId) });
    } catch (error) {
        // Persistence already succeeded. Reconciliation on reconnect/refresh
        // recovers the conversation without misleading callers into retrying creation.
        console.error("Conversation notification failed:", error);
    }
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
    const ioRef = new Server(httpServer, {
        cors: {
            origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
            credentials: true,
        },
    });
    io = ioRef;

    ioRef.use((socket, next) => {
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

    ioRef.on("connection", (socket) => {
        const userId = socket.userId;

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
            presence.onDisconnect(ioRef, socket);
        });

        const initialize = async () => {
            let roomsReady = false;
            try {
                // Join the user room BEFORE the query: concurrent creations
                // either appear in the query or reach this socket through that room.
                await socket.join(userRoom(userId));
                if (!socket.connected) return;
                const conversations = await Conversation.find({ participants: userId })
                    .select("_id").lean();
                if (!socket.connected) return;
                await socket.join(conversations.map((c) => conversationRoom(c._id)));
                roomsReady = true;
            } catch (error) {
                console.error("Auto-join of conversation rooms failed:", error);
            }
            if (!socket.connected) return;
            presence.onConnect(ioRef, socket);
            socket.emit("realtime:ready", { roomsReady });
        };
        void initialize().catch((error) => console.error("Socket initialization failed:", error));
    });

    return ioRef;
}

export function closeSocket(callback) {
    if (!io) {
        callback?.();
        return;
    }
    const closing = io;
    io = null;
    closing.close(callback);
}
