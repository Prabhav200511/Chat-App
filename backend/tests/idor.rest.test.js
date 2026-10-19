import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import Message from "../src/models/message.model.js";
import {
    app,
    signup,
    createConversation,
    authed,
    sendMessage,
    getMessages,
} from "./helpers.js";

// The LLM must never be reached for a conversation the caller isn't in.
vi.mock("@google/generative-ai", () => {
    const generateContentMock = vi.fn(async () => ({
        response: { text: () => '["Sounds good!", "Sure!", "On my way."]' },
    }));
    return {
        GoogleGenerativeAI: class {
            getGenerativeModel() {
                return { generateContent: generateContentMock };
            }
        },
        generateContentMock,
    };
});

import { generateContentMock } from "@google/generative-ai";

describe("IDOR: message routes enforce conversation membership", () => {
    let alice, bob, dave, convAC;

    beforeAll(async () => {
        alice = await signup("Alice");
        bob = await signup("Bob");
        const carol = await signup("Carol");
        dave = await signup("Dave");

        convAC = await createConversation(alice, carol.email);
        // Give the conversation some history.
        await sendMessage(alice, convAC._id, { text: "hello carol" });
    });

    it("lets a participant read the conversation", async () => {
        const res = await getMessages(alice, convAC._id);
        expect(res.status).toBe(200);
        expect(res.body.conversationId).toBe(convAC._id);
        expect(res.body.messages.length).toBeGreaterThan(0);
    });

    it("404s a non-participant reading the conversation", async () => {
        const res = await getMessages(bob, convAC._id);
        expect(res.status).toBe(404);
        expect(res.body).not.toHaveProperty("messages");
    });

    it("404s a non-participant sending, and writes nothing", async () => {
        const scoped = { conversationId: convAC._id };
        const before = await Message.countDocuments(scoped);

        const res = await sendMessage(bob, convAC._id, { text: "sneaky" });
        expect(res.status).toBe(404);

        const after = await Message.countDocuments(scoped);
        expect(after).toBe(before);
    });

    it("404s a non-participant fetching smart replies and never calls the LLM", async () => {
        generateContentMock.mockClear();

        const res = await request(app)
            .get(`/app/messages/smart-replies/${convAC._id}`)
            .set(authed(bob.cookie));

        expect(res.status).toBe(404);
        expect(generateContentMock).not.toHaveBeenCalled();
    });

    it("401s without a cookie", async () => {
        const res = await request(app).get(`/app/messages/${convAC._id}`);
        expect(res.status).toBe(401);
    });

    it("401s with a garbage token", async () => {
        const res = await request(app)
            .get(`/app/messages/${convAC._id}`)
            .set("Cookie", "jwt=definitely-not-a-jwt");
        expect(res.status).toBe(401);
    });

    it("400s a non-ObjectId conversation id instead of a 500", async () => {
        const res = await getMessages(alice, "not-an-objectid");
        expect(res.status).toBe(400);
    });

    it("does not leak the existence of a conversation via invite", async () => {
        // Dave inviting Alice when they already... no: verify the 404 body is
        // identical whether the conversation exists or not.
        const exists = await getMessages(dave, convAC._id);
        const missing = await getMessages(
            dave,
            "0123456789abcdef01234567"
        );
        // Both are "not found for you" — same status, same message shape.
        expect(exists.status).toBe(404);
        expect(missing.status).toBe(404);
        expect(exists.body.message).toBe(missing.body.message);
    });
});
