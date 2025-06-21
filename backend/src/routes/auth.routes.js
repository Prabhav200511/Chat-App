import express from "express";
const router = express.Router();
import { signup,login,logout, updateProfile,checkAuth } from "../controllers/auth.controller.js";
import { protectedRoute } from "../middleware/protectedRoute.middleware.js";

router.post('/signup',signup);

router.post('/login',login);

router.post('/logout',logout);

router.put('/update-profile',protectedRoute, updateProfile)

router.get('/check',protectedRoute,checkAuth);

export default router;