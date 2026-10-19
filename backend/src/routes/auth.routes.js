import express from "express";
import { signup,login,logout, updateProfile,checkAuth } from "../controllers/auth.controller.js";
import { protectedRoute } from "../middleware/protectedRoute.middleware.js";
import { validate } from "../middleware/validate.js";
import { signupSchema, loginSchema, updateProfileSchema } from "../lib/validation.js";
import { authLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

// authLimiter covers login + signup only: credential stuffing and account
// spam. checkAuth runs on every page load and must never be throttled.
router.post('/signup', authLimiter, validate(signupSchema), signup);

router.post('/login', authLimiter, validate(loginSchema), login);

router.post('/logout', logout);

router.put('/update-profile', protectedRoute, validate(updateProfileSchema), updateProfile)

router.get('/check',protectedRoute,checkAuth);

export default router;
