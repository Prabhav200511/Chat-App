import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import Conversation from "../src/models/conversation.model.js";

/**
 * Phase 2 migration: build the indexes Phase 2's connect-time query needs.
 *
 * `Conversation.find({ participants: userId })` now runs on EVERY socket
 * connect (to auto-join all of the user's rooms), so the `{ participants: 1 }`
 * index must exist before the new server code takes traffic.
 *
 * Additive and idempotent: createIndexes() creates declared indexes without
 * dropping existing indexes that may have been added by an operator.
 *
 *   node scripts/migrate-phase2.js
 */
const run = async () => {
    if (!process.env.MONGO_URL) {
        throw new Error("MONGO_URL is not set");
    }
    await mongoose.connect(process.env.MONGO_URL);
    console.log("Connected. Creating Phase 2 indexes...");

    const before = await Conversation.collection.indexes().catch(() => []);
    await Conversation.createIndexes();
    const after = await Conversation.collection.indexes();

    console.log(`Conversation indexes before: ${before.map((i) => i.name).join(", ") || "(none)"}`);
    console.log(
        `Conversation indexes now: ${after.map((i) => i.name).join(", ")}`
    );

    await mongoose.disconnect();
    console.log("Done.");
};

run().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
});
