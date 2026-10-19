import request from "supertest";
import crypto from "node:crypto";
import { createApp } from "../src/app.js";

export const app = createApp();

export const TEST_PASSWORD = "password123";

let seq = 0;
const unique = () =>
    `${Date.now()}_${seq++}_${crypto.randomUUID().slice(0, 8)}`;

/** Extracts the raw "jwt=..." cookie header from a response. */
export const cookieHeaderFrom = (res) => {
    const cookies = res.headers["set-cookie"] || [];
    return cookies.map((c) => c.split(";")[0]).join("; ");
};

export const authed = (cookie) => ({ Cookie: cookie });

/** Signs up a fresh user and returns { user, email, cookie }. */
export const signup = async (fullName) => {
    const email = `${unique()}@test.local`;
    const res = await request(app)
        .post("/app/auth/signup")
        .send({ fullName, email, password: TEST_PASSWORD });

    if (res.status !== 201) {
        throw new Error(
            `signup failed (${res.status}): ${JSON.stringify(res.body)}`
        );
    }
    return { user: res.body, email, cookie: cookieHeaderFrom(res) };
};

/** Invites a user by email, creating a 1:1 conversation. */
export const createConversation = async (inviter, inviteeEmail) => {
    const res = await request(app)
        .post("/app/messages/invite")
        .set(authed(inviter.cookie))
        .send({ email: inviteeEmail });

    if (res.status !== 201) {
        throw new Error(
            `invite failed (${res.status}): ${JSON.stringify(res.body)}`
        );
    }
    return res.body.conversation;
};

export const sendMessage = (from, conversationId, body) =>
    request(app)
        .post(`/app/messages/send/${conversationId}`)
        .set(authed(from.cookie))
        .send(body);

export const getMessages = (user, conversationId, query = {}) =>
    request(app)
        .get(`/app/messages/${conversationId}`)
        .set(authed(user.cookie))
        .query(query);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
