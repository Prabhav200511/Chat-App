import { z } from "zod";

export const objectId = z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const email = z.string().trim().email("Invalid email").max(254);

// Matches the User schema and the seed data; signup UI copy must agree.
export const MIN_PASSWORD_LENGTH = 8;

export const signupSchema = z.object({
    fullName: z.string().trim().min(2, "Name too short").max(80, "Name too long"),
    email,
    password: z
        .string()
        .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
        .max(128, "Password too long"),
});

export const loginSchema = z.object({
    email,
    password: z.string().min(1, "Password is required").max(128),
});

export const updateProfileSchema = z.object({
    profilePic: z
        .string()
        .min(1, "Profile pic is required")
        .max(4 * 1024 * 1024, "Profile image too large"),
});

export const inviteSchema = z.object({ email });

export const groupSchema = z.object({
    groupName: z.string().trim().min(1, "Group name required").max(50, "Group name too long"),
    emails: z.array(email).min(1, "At least one email required").max(100, "Too many recipients"),
});

const MAX_IMAGE_DATA_URL = 4 * 1024 * 1024;

export const sendMessageSchema = z
    .object({
        text: z.string().max(4000, "Message too long").optional(),
        image: z.string().max(MAX_IMAGE_DATA_URL, "Image too large").optional(),
    })
    // Must contain something sendable; unknown keys (e.g. a client
    // timestamp) are stripped by zod's default strip mode.
    .refine((d) => (d.text && d.text.trim().length > 0) || d.image, {
        message: "Message must contain text or an image",
    });

export const paginationSchema = z.object({
    limit: z.coerce.number().int().min(1).max(100, "Limit max is 100").default(30),
    before: z.string().datetime({ offset: true, message: "before must be an ISO datetime" }).optional(),
});

export const idParamSchema = z.object({ id: objectId });
