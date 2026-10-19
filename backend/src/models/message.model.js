import mongoose from "mongoose";

const messageSchema = mongoose.Schema(
    {
        // Every message belongs to exactly one conversation. This replaces the
        // old receiverId field (which held a *conversation* id for group
        // messages — broken data) and the Conversation.messages[] array.
        conversationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Conversation",
            required: true,
        },
        senderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        text: {
            type: String,
        },
        image: {
            type: String,
        },
        // Ordering and cursor pagination use server-side createdAt only;
        // client clocks are never trusted (the old client-sent `timestamp`
        // field was stripped from the API in Phase 1).
    },
    { timestamps: true }
);

// Cursor index for GET /app/messages/:id?before=...
messageSchema.index({ conversationId: 1, createdAt: -1 });

export default mongoose.model("Message", messageSchema);
