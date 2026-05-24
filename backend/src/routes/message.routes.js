import express from "express"
import { protectedRoute } from "../middleware/protectedRoute.middleware.js";
import { getUsersforSidebar, getMessages, sendMessage, inviteUserByEmail, getSmartReplies } from "../controllers/message.controller.js";

const router = express.Router();

router.get("/users", protectedRoute, getUsersforSidebar);
router.post("/invite", protectedRoute, inviteUserByEmail);
router.get("/smart-replies/:id", protectedRoute, getSmartReplies);
router.get("/:id", protectedRoute, getMessages);
router.post("/send/:id", protectedRoute, sendMessage);

export default router