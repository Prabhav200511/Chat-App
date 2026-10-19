import express from "express"
import { protectedRoute } from "../middleware/protectedRoute.middleware.js";
import { getUsersforSidebar, getMessages, sendMessage, inviteUserByEmail, getSmartReplies,createGroupChat} from "../controllers/message.controller.js";
import { validate } from "../middleware/validate.js";
import {
    idParamSchema,
    inviteSchema,
    groupSchema,
    sendMessageSchema,
    paginationSchema,
} from "../lib/validation.js";
import {
    sendLimiter,
    smartRepliesLimiter,
    socialLimiter,
} from "../middleware/rateLimit.js";

const router = express.Router();

router.get("/users", protectedRoute, getUsersforSidebar);
router.post("/invite", protectedRoute, socialLimiter, validate(inviteSchema), inviteUserByEmail);
router.get("/smart-replies/:id", protectedRoute, smartRepliesLimiter, validate(idParamSchema, "params"), getSmartReplies);
router.get("/:id", protectedRoute, validate(idParamSchema, "params"), validate(paginationSchema, "query"), getMessages);
router.post("/group", protectedRoute, socialLimiter, validate(groupSchema), createGroupChat);
router.post("/send/:id", protectedRoute, sendLimiter, validate(idParamSchema, "params"), validate(sendMessageSchema), sendMessage);

export default router
