import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import Conversation from "../src/models/conversation.model.js";
import Message from "../src/models/message.model.js";

/**
 * Phase 1 migration: backfill Message.conversationId from each conversation's
 * legacy messages[] array, then drop the array.
 *
 * Idempotent — safe to run repeatedly. Uses the native driver collections so
 * the (new) Mongoose schemas cannot strip the legacy paths from the updates.
 *
 *   node scripts/migrate-phase1.js
 */
const run = async () => {
    if (!process.env.MONGO_URL) {
        throw new Error("MONGO_URL is not set");
    }
    await mongoose.connect(process.env.MONGO_URL);
    console.log("Connected. Starting Phase 1 migration...");

    const conversations = await Conversation.collection
        .find({})
        .toArray();
    console.log(`Found ${conversations.length} conversations`);

    let backfilled = 0;
    for (const conv of conversations) {
        const ids = conv.messages || [];
        if (ids.length > 0) {
            const res = await Message.collection.updateMany(
                { _id: { $in: ids }, conversationId: { $exists: false } },
                { $set: { conversationId: conv._id } }
            );
            backfilled += res.modifiedCount;
        }
        await Conversation.collection.updateOne(
            { _id: conv._id },
            { $unset: { messages: "" } }
        );
    }

    // Messages that were never attached to a conversation (historical send
    // failures, or sends where the conversation lookup missed).
    const orphanCursor = await Message.collection.find(
        { conversationId: { $exists: false } },
        { projection: { _id: 1, senderId: 1, text: 1, createdAt: 1 } }
    );
    const orphans = await orphanCursor.toArray();

    console.log(`Backfilled conversationId on ${backfilled} messages`);
    console.log(`Removed messages[] from ${conversations.length} conversations`);
    console.log(`Orphan messages left untouched: ${orphans.length}`);
    for (const o of orphans.slice(0, 20)) {
        console.log(
            `  - ${o._id} from ${o.senderId} at ${o.createdAt}: ${String(
                o.text || "[image]"
            ).slice(0, 60)}`
        );
    }
    if (orphans.length > 20) {
        console.log(`  ...and ${orphans.length - 20} more`);
    }

    await mongoose.disconnect();
    console.log("Done.");
};

run().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
});
