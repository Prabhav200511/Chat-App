import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "path";
import authRoutes from "./routes/auth.routes.js";
import messageRoutes from "./routes/message.routes.js";
import { globalLimiter } from "./middleware/rateLimit.js";

const __dirname = path.resolve();

/**
 * Builds the Express app with all middleware and routes mounted.
 * Deliberately contains no server.listen() and no DB connection so
 * tests can import it via Supertest without side effects.
 */
export const createApp = () => {
    const app = express();

    // Render (and most hosts) sit behind a reverse proxy; trusting the proxy
    // makes req.ip reflect the real client so per-IP rate limits work.
    app.set("trust proxy", 1);

    app.use(express.json({ limit: "5mb" }));
    app.use(express.urlencoded({ extended: true, limit: "5mb" }));
    app.use(cookieParser());
    app.use(
        cors({
            origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
            credentials: true,
        })
    );

    // Per-IP blast protection for the whole API (route-specific limiters are
    // mounted in the route files).
    app.use(globalLimiter);

    app.use("/app/auth", authRoutes);
    app.use("/app/messages", messageRoutes);

    if (process.env.NODE_ENV === "production") {
        app.use(express.static(path.join(__dirname, "../frontend/dist")));

        app.get("/{*any}", (req, res) => {
            res.sendFile(path.join(__dirname, "../frontend", "dist", "index.html"));
        });
    }

    return app;
};
