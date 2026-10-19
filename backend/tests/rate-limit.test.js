import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app, signup, createConversation, sendMessage } from "./helpers.js";

/**
 * Rate limits are read per request from the environment (see
 * middleware/rateLimit.js), so this file lowers the ceilings for its own
 * window and restores them afterwards.
 */
describe("rate limiting", () => {
    const saved = {};

    beforeAll(() => {
        for (const key of [
            "RATE_LIMIT_AUTH_MAX",
            "RATE_LIMIT_SEND_MAX",
        ]) {
            saved[key] = process.env[key];
        }
        process.env.RATE_LIMIT_AUTH_MAX = "3";
        process.env.RATE_LIMIT_SEND_MAX = "2";
    });

    afterAll(() => {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    it("429s login attempts past the auth ceiling", async () => {
        const statuses = [];
        for (let i = 0; i < 5; i++) {
            const res = await request(app).post("/app/auth/login").send({
                email: "nobody@nowhere.local",
                password: "wrong-password",
            });
            statuses.push(res.status);
        }

        // First requests pass through to normal auth handling...
        expect(statuses[0]).toBe(400);
        // ...then the limiter kicks in.
        expect(statuses).toContain(429);
        expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(2);
    });

    it("429s message sends past the send ceiling", async () => {
        // The auth limiter's budget was already burned by the test above;
        // raise it just for these fixtures (limits are read per request from
        // the environment, so this takes effect immediately).
        process.env.RATE_LIMIT_AUTH_MAX = "100000";
        const alice = await signup("Rate Alice");
        const bob = await signup("Rate Bob");
        process.env.RATE_LIMIT_AUTH_MAX = "3";
        const conv = await createConversation(alice, bob.email);

        const statuses = [];
        for (let i = 0; i < 4; i++) {
            const res = await sendMessage(alice, conv._id, {
                text: `burst ${i}`,
            });
            statuses.push(res.status);
        }

        expect(statuses.filter((s) => s === 201).length).toBeLessThanOrEqual(2);
        expect(statuses).toContain(429);
    });

    it("answers 429 with a JSON body, not an HTML error page", async () => {
        let last;
        for (let i = 0; i < 6; i++) {
            last = await request(app).post("/app/auth/login").send({
                email: "nobody@nowhere.local",
                password: "wrong-password",
            });
            if (last.status === 429) break;
        }
        expect(last.status).toBe(429);
        expect(last.headers["content-type"]).toMatch(/json/);
        expect(last.body).toHaveProperty("message");
    });
});
