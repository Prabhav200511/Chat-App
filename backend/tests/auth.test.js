import { describe, it, expect } from "vitest";
import request from "supertest";
import {
    app,
    signup,
    cookieHeaderFrom,
    authed,
    TEST_PASSWORD,
} from "./helpers.js";

describe("auth baseline (regression guard)", () => {
    it("signs up, sets an httpOnly cookie, and never returns the password", async () => {
        const email = `baseline_${Date.now()}@test.local`;
        const res = await request(app).post("/app/auth/signup").send({
            fullName: "Baseline User",
            email,
            password: TEST_PASSWORD,
        });

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ fullName: "Baseline User", email });
        expect(res.body).not.toHaveProperty("password");

        const setCookie = (res.headers["set-cookie"] || []).join(";");
        expect(setCookie).toMatch(/jwt=/);
        expect(setCookie.toLowerCase()).toContain("httponly");
    });

    it("rejects a duplicate signup", async () => {
        const email = `dupe_${Date.now()}@test.local`;
        const body = {
            fullName: "Dupe",
            email,
            password: TEST_PASSWORD,
        };
        expect((await request(app).post("/app/auth/signup").send(body)).status).toBe(201);
        const second = await request(app).post("/app/auth/signup").send(body);
        expect(second.status).toBe(400);
    });

    it("logs in with correct credentials and rejects wrong ones", async () => {
        const user = await signup("Login User");

        const ok = await request(app).post("/app/auth/login").send({
            email: user.email,
            password: TEST_PASSWORD,
        });
        expect(ok.status).toBe(200);
        expect(cookieHeaderFrom(ok)).toMatch(/jwt=/);

        const bad = await request(app).post("/app/auth/login").send({
            email: user.email,
            password: "totally-wrong-1",
        });
        expect(bad.status).toBe(400);
    });

    it("checkAuth returns the user for a valid cookie and 401 without one", async () => {
        const user = await signup("Check User");

        const ok = await request(app)
            .get("/app/auth/check")
            .set(authed(user.cookie));
        expect(ok.status).toBe(200);
        expect(ok.body.email).toBe(user.email);
        expect(ok.body).not.toHaveProperty("password");

        const anon = await request(app).get("/app/auth/check");
        expect(anon.status).toBe(401);
    });

    it("logout clears the cookie", async () => {
        const user = await signup("Logout User");

        const res = await request(app)
            .post("/app/auth/logout")
            .set(authed(user.cookie));
        expect(res.status).toBe(200);

        const setCookie = (res.headers["set-cookie"] || []).join(";");
        expect(setCookie).toMatch(/jwt=;/i);
    });
});
