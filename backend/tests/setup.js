import { beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";

// Deterministic secrets for the suite (tests never load .env).
process.env.JWT_SECRET ||= "test-secret";

// Rate limits are read per request from the environment; default them very
// high so unrelated tests never trip a 429. tests/rate-limit.test.js lowers
// them explicitly for its own cases.
process.env.RATE_LIMIT_GLOBAL_MAX ||= "100000";
process.env.RATE_LIMIT_AUTH_MAX ||= "100000";
process.env.RATE_LIMIT_SEND_MAX ||= "100000";
process.env.RATE_LIMIT_SMART_MAX ||= "100000";
process.env.RATE_LIMIT_SOCIAL_MAX ||= "100000";

beforeAll(async () => {
    if (!process.env.MONGO_URL) {
        throw new Error("MONGO_URL was not provided by the global setup");
    }
    if (mongoose.connection.readyState !== 1) {
        await mongoose.connect(process.env.MONGO_URL);
    }
});

afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
        await mongoose.disconnect();
    }
});
