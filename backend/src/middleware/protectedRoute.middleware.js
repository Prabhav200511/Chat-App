import jwt from "jsonwebtoken";
import User from "../models/user.model.js";

export const protectedRoute = async (req,res,next) => {
    try {
        const token  = req.cookies.jwt //it's jwt as we named it jwt in util

        if(!token){
            return res.status(401).json({
                message:"No token to extract"
            });
        }

        const checkToken = jwt.verify(token,process.env.JWT_SECRET);

        if(!checkToken){
            res.status(401).json({
                message:"Invalid Token"
            })
        }

        const user = await User.findById(checkToken.userId).select("-password");

        if(!user){
            return res.status(401).json({
                message:"User not found"
            })
        }

        req.user = user;

        next();

    } catch (error) {
        console.error(error);
        return res.status(500).json({
            message:"Internal server error"
        })
    }
}