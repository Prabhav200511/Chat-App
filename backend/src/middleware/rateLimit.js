import { rateLimit } from "express-rate-limit";

const intEnv = (name, fallback) => {
    const value = Number.parseInt(process.env[name], 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
};

/**
 * Factory for all limiters. Ceilings are read from the environment on every
 * request, so operators can tune them without redeploying and tests can lower
 * them for a specific window and restore them afterwards.
 */
export const createLimiter = ({ windowMs, envMax, fallbackMax }) =>
    rateLimit({
        windowMs,
        limit: () => intEnv(envMax, fallbackMax),
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { message: "Too many requests" },
    });

/** General API blast protection. */
export const globalLimiter = createLimiter({
    windowMs: 60 * 1000,
    envMax: "RATE_LIMIT_GLOBAL_MAX",
    fallbackMax: 300,
});

/** Login + signup: credential stuffing / account spam. */
export const authLimiter = createLimiter({
    windowMs: 15 * 60 * 1000,
    envMax: "RATE_LIMIT_AUTH_MAX",
    fallbackMax: 10,
});

/** Outgoing messages: flooding a conversation. */
export const sendLimiter = createLimiter({
    windowMs: 60 * 1000,
    envMax: "RATE_LIMIT_SEND_MAX",
    fallbackMax: 60,
});

/** Smart replies: every hit costs a Gemini call. */
export const smartRepliesLimiter = createLimiter({
    windowMs: 15 * 60 * 1000,
    envMax: "RATE_LIMIT_SMART_MAX",
    fallbackMax: 10,
});

/** Invites + group creation: spam vector. */
export const socialLimiter = createLimiter({
    windowMs: 15 * 60 * 1000,
    envMax: "RATE_LIMIT_SOCIAL_MAX",
    fallbackMax: 10,
});
