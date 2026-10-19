import mongoose from "mongoose";
import Conversation from "../models/conversation.model.js";

/**
 * Returns the conversation only if `userId` is a participant, otherwise null.
 * Callers translate null into an identical 404 whether the conversation is
 * missing or simply not theirs — so the response never leaks existence.
 *
 * Defense in depth: route-level validation rejects non-ObjectId ids first;
 * this guard repeats the check so a missed validator cannot become a
 * Mongoose CastError (500).
 */
export const getAuthorizedConversation = async (conversationId, userId) => {
    if (!mongoose.Types.ObjectId.isValid(conversationId)) return null;
    return Conversation.findOne({
        _id: conversationId,
        participants: userId,
    });
};

export const respondNotFound = (res) =>
    res.status(404).json({ message: "Conversation not found" });
