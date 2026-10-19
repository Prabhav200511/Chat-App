import mongoose from "mongoose";

const conversationSchema = mongoose.Schema({
    isGroup: { type: Boolean, default: false },
    groupName: { type: String, default: "" },
    participants: {
        type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
        required: true,
        validate: [
            function (val) { return val.length >= 2; },
            'A conversation must have at least two participants'
        ]
    }
    // NOTE: the legacy messages[] array is gone — messages live on
    // Message.conversationId (indexed) and are paginated from there.
    // See scripts/migrate-phase1.js for the one-time backfill.
}, { timestamps: true })

export default mongoose.model("Conversation", conversationSchema);