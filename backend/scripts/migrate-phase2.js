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
 * Idempotent — syncIndexes() only creates missing indexes; safe to re-run.
 *
 *   node scripts/migrate-phase2.js
 */
const run = async () => {
    if (!process.env.MONGO_URL) {
        throw new Error("MONGO_URL is not set");
    }
    await mongoose.connect(process.env.MONGO_URL);
    console.log("Connected. Syncing Phase 2 indexes...");

    const before = await Conversation.collection.indexes().catch(() => []);
    const changed = await Conversation.syncIndexes();

    console.log(`Conversation indexes before: ${before.map((i) => i.name).join(", ") || "(none)"}`);
    console.log(
        `Conversation indexes removed by sync: ${changed.length ? changed.join(", ") : "(none)"}`
    );
    console.log(
        `Conversation indexes now: ${Object.keys(Conversation.schema.indexes().reduce((acc, [keys]) => ({ ...acc, [JSON.stringify(keys)]: 1 }), {}))
            .concat(["_id_"])
            .join(", ")}`
    );

    await mongoose.disconnect();
    console.log("Done.");
};

run().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
});
