import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import {
    app,
    signup,
    createConversation,
    authed,
    sendMessage,
    TEST_PASSWORD,
} from "./helpers.js";

vi.mock("@google/generative-ai", () => ({
    GoogleGenerativeAI: class {
        getGenerativeModel() {
            return {
                generateContent: async () => ({
                    response: { text: () => '["ok", "ok", "ok"]' },
                }),
            };
        }
    },
}));

describe("input validation", () => {
    let alice, bob, convAB;

    beforeAll(async () => {
        alice = await signup("Alice");
        bob = await signup("Bob");
        convAB = await createConversation(alice, bob.email);
    });

    it("rejects a password shorter than 8 characters at signup", async () => {
        const res = await request(app).post("/app/auth/signup").send({
            fullName: "Shorty",
            email: "short-password@test.local",
            password: "123456", // passes the old 6-char check, fails the schema
        });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/password/i);
    });

    it("rejects a message text longer than 4000 characters", async () => {
        const res = await sendMessage(alice, convAB._id, {
            text: "x".repeat(4001),
        });
        expect(res.status).toBe(400);
    });

    it("rejects a message with neither text nor image", async () => {
        const res = await sendMessage(alice, convAB._id, {});
        expect(res.status).toBe(400);
    });

    it("rejects a non-string text field", async () => {
        const res = await sendMessage(alice, convAB._id, { text: 12345 });
        expect(res.status).toBe(400);
    });

    it("rejects an oversized image payload", async () => {
        const res = await sendMessage(alice, convAB._id, {
            image: "data:image/png;base64," + "A".repeat(4.2 * 1024 * 1024),
        });
        expect(res.status).toBe(400);
    });

    it("rejects a malformed email on invite", async () => {
        const res = await request(app)
            .post("/app/messages/invite")
            .set(authed(alice.cookie))
            .send({ email: "not-an-email" });
        expect(res.status).toBe(400);
    });

    it("rejects a group name longer than 50 characters", async () => {
        const carol = await signup("Carol");
        const dave = await signup("Dave");

        const res = await request(app)
            .post("/app/messages/group")
            .set(authed(alice.cookie))
            .send({
                groupName: "g".repeat(60),
                emails: [carol.email, dave.email],
            });
        expect(res.status).toBe(400);
    });

    it("400s a non-ObjectId id on send instead of a 500", async () => {
        const res = await sendMessage(alice, "who-am-i", { text: "hi" });
        expect(res.status).toBe(400);
    });

    it("accepts a valid message (guard against over-blocking)", async () => {
        const res = await sendMessage(alice, convAB._id, {
            text: "perfectly normal",
        });
        expect(res.status).toBe(201);
        expect(TEST_PASSWORD.length).toBeGreaterThanOrEqual(8);
    });
});
