import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import cloudinary from "../src/lib/cloudinary.js";
import {
    app,
    signup,
    createConversation,
    authed,
    sendMessage,
    TEST_PASSWORD,
} from "./helpers.js";

vi.mock("../src/lib/cloudinary.js", () => ({
    default: { uploader: { upload: vi.fn(async () => ({ secure_url: "https://images.test/upload.png" })) } },
}));

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
    const validImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
    const invalidImages = [
        "https://example.com/image.png",
        "/etc/passwd",
        "not an image",
        "data:text/plain;base64,aGVsbG8=",
        "data:image/png;base64,",
        "data:image/png;base64,%%%invalid%%%",
        "data:image/png;base64,aGVsbG8",
        "data:image/png;base64,aGVsbG9=", // noncanonical padding bits
    ];

    beforeEach(() => cloudinary.uploader.upload.mockClear());

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
        expect(cloudinary.uploader.upload).not.toHaveBeenCalled();
    });

    it.each(invalidImages)("rejects an invalid message image before uploading: %s", async (image) => {
        expect((await sendMessage(alice, convAB._id, { image })).status).toBe(400);
        expect(cloudinary.uploader.upload).not.toHaveBeenCalled();
    });

    it.each(invalidImages)("rejects an invalid profile image before uploading: %s", async (profilePic) => {
        const res = await request(app).put("/app/auth/update-profile")
            .set(authed(alice.cookie)).send({ profilePic });
        expect(res.status).toBe(400);
        expect(cloudinary.uploader.upload).not.toHaveBeenCalled();
    });

    it("accepts a valid message image", async () => {
        const res = await sendMessage(alice, convAB._id, { image: validImage });
        expect(res.status).toBe(201);
        expect(res.body.image).toBe("https://images.test/upload.png");
        expect(cloudinary.uploader.upload).toHaveBeenCalledWith(validImage);
    });

    it("accepts a valid profile image", async () => {
        const res = await request(app).put("/app/auth/update-profile")
            .set(authed(alice.cookie)).send({ profilePic: validImage });
        expect(res.status).toBe(200);
        expect(res.body).not.toHaveProperty("password");
        expect(cloudinary.uploader.upload).toHaveBeenCalledWith(validImage);
    });

    it("accepts the text-only payload emitted by the browser", async () => {
        const res = await sendMessage(alice, convAB._id, { text: "no attachment", image: null });
        expect(res.status).toBe(201);
        expect(cloudinary.uploader.upload).not.toHaveBeenCalled();
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
