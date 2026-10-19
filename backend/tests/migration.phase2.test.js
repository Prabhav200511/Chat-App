import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import Conversation from "../src/models/conversation.model.js";

it("creates the participant index without dropping operator-created indexes", async () => {
    await Conversation.collection.createIndex({ groupName: 1 }, { name: "operator_group_name" });
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL("../scripts/migrate-phase2.js", import.meta.url))], {
        // Avoid loading the development .env; MONGO_URL is the suite's unique test DB.
        cwd: fileURLToPath(new URL(".", import.meta.url)),
        env: process.env,
        timeout: 20000,
        windowsHide: true,
    });
    const indexes = await Conversation.collection.indexes();
    expect(indexes.some((index) => index.name === "operator_group_name")).toBe(true);
    expect(indexes.some((index) => index.key.participants === 1)).toBe(true);
});
