import express from "express"
import { protectedRoute } from "../middleware/protectedRoute.middleware.js";
import { getUsersforSidebar, getMessages, sendMessage, inviteUserByEmail } from "../controllers/message.controller.js";

const router = express.Router();

router.get("/users", protectedRoute, getUsersforSidebar);
router.post("/invite", protectedRoute, inviteUserByEmail);
router.get("/:id", protectedRoute, getMessages);
router.post("/send/:id", protectedRoute, sendMessage);

export default router