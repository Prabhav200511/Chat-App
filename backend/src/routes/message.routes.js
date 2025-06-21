import express from "express"
import { protectedRoute } from "../middleware/protectedRoute.middleware.js";
import { getUsersforSidebar,getMessages,sendMessage} from "../controllers/message.controller.js";

const router = express.Router();

router.get("/users", protectedRoute, getUsersforSidebar);
router.post("/send/:id", protectedRoute, sendMessage);
router.get("/:id([a-fA-F0-9]{24})", protectedRoute, getMessages);


export default router