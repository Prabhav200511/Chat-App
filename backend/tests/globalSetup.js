import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let testUrl;

/**
 * Resolves the test database before any worker starts:
 *
 * 1. TEST_MONGO_URL — explicit override (GitHub Actions provides a mongo
 *    service container; point it anywhere, e.g. a dev Atlas cluster).
 * 2. mongodb://127.0.0.1:27017 — matches `docker run -p 27017:27017 mongo`.
 *
 * backend/.env is deliberately NOT read here: it lives in a OneDrive
 * placeholder whose hydration can stall, which would deadlock the run, and
 * tests must never reuse the dev database anyway. A unique database name
 * (chatapp_test_<rand>) is appended regardless, and dropped in teardown.
 *
 * mongodb-memory-server was deliberately not used either: its package
 * extraction proved unreliable on this machine.
 *
 * Teardown drops the test database again.
 */
export default async function globalSetup() {
    const base = process.env.TEST_MONGO_URL || "mongodb://127.0.0.1:27017";

    const dbName = `chatapp_test_${crypto.randomUUID().slice(0, 8)}`;
    const url = new URL(base);
    url.pathname = `/${dbName}`;
    testUrl = url.toString();
    process.env.MONGO_URL = testUrl;

    console.log(`[tests] using database ${dbName}`);

    return async () => {
        try {
            const { MongoClient } = await import("mongodb");
            const client = new MongoClient(testUrl);
            await client.connect();
            await client.db().dropDatabase();
            await client.close();
            console.log(`[tests] dropped database ${dbName}`);
        } catch (err) {
            console.warn(`[tests] could not drop ${dbName}: ${err.message}`);
        }
    };
}
