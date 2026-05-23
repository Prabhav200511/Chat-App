import mongoose from "mongoose";

const conversationSchema = mongoose.Schema({
    participants: {
        type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
        required: true,
        validate: [
            function (val) { return val.length >= 2; },
            'A conversation must have at least two participants'
        ]
    },
    messages: [{ type: mongoose.Schema.Types.ObjectId, ref: "Message", default: [] }]
}, { timestamps: true })

export default mongoose.model("Conversation", conversationSchema);