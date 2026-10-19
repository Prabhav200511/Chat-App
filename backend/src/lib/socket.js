import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { parse as parseCookie } from "cookie";
import mongoose from "mongoose";
import Conversation from "../models/conversation.model.js";

let io = null;

// userId -> Set<socketId> (a user may be connected from several tabs/devices)
const userSocketMap = new Map();

export function getIO() {
    return io;
}

export function getRecieverSocketId(userId) {
    const sockets = userSocketMap.get(String(userId));
    if (!sockets || sockets.size === 0) return undefined;
    return [...sockets][sockets.size - 1];
}

/**
 * Attaches Socket.IO to an http server.
 * - Handshake is authenticated with the same JWT cookie the REST API uses;
 *   the client-sent query.userId is intentionally ignored.
 * - join_room only joins conversations the authenticated user participates in.
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

    io.on("connection", (socket) => {
        const userId = socket.userId;
        console.log("A user has connected", socket.id);

        if (!userSocketMap.has(userId)) userSocketMap.set(userId, new Set());
        userSocketMap.get(userId).add(socket.id);
        io.emit("getOnlineUsers", [...userSocketMap.keys()]);

        socket.on("join_room", async (conversationId, ack) => {
            try {
                if (!mongoose.Types.ObjectId.isValid(conversationId)) {
                    ack?.({ ok: false, message: "Invalid conversation id" });
                    return;
                }

                // Membership check: only participants may join the room.
                const exists = await Conversation.exists({
                    _id: conversationId,
                    participants: userId,
                });

                if (!exists) {
                    ack?.({ ok: false, message: "Conversation not found" });
                    return;
                }

                socket.join(conversationId);
                ack?.({ ok: true });
            } catch {
                ack?.({ ok: false, message: "Could not join conversation" });
            }
        });

        socket.on("disconnect", () => {
            console.log("A user has disconnected: ", socket.id);

            const sockets = userSocketMap.get(userId);
            if (sockets) {
                sockets.delete(socket.id);
                if (sockets.size === 0) userSocketMap.delete(userId);
            }
            io.emit("getOnlineUsers", [...userSocketMap.keys()]);
        });
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
