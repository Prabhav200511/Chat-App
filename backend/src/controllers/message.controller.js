import cloudinary from "../lib/cloudinary.js";
import User from "../models/user.model.js";
import Message from "../models/message.model.js"
import { io } from "../lib/socket.js";
import { getRecieverSocketId } from "../lib/socket.js";

export const getUsersforSidebar = async (req,res) => {
    try {
        const loggedInUserId = req.user._id;
        const filteredUsers = await User.find({_id: {$ne:loggedInUserId}}).select("-password");

        res.status(200).json(filteredUsers);
    } catch (error) {
        console.error("Error in fetching Users for Sidebar",error);
        res.status(500).json({message:"Internal Server Error"});
    }
}

export const getMessages = async (req,res) => {
    try {
        const {id:userToChatWithId} = req.params;
        const myId = req.user._id;

        const messages = await Message.find({
            $or: [
                {senderId: myId,receiverId:userToChatWithId},
                {senderId:userToChatWithId,receiverId:myId}
            ],
        });
        return res.status(200).json(messages);
    } catch (error) {
        console.error("Unable to fetch messages",error);
        res.status(500).json({message:"Internal server error"});
    }
}

export const sendMessage = async (req,res) => {
    try {
        const {text,image} = req.body;
        const {id : receiverId} = req.params;
        const senderId = req.user._id;

        let imageUrl;
        if(image){
            const uploadImage = await cloudinary.uploader.upload(image);
            imageUrl = uploadImage.secure_url;
        };

        const newMessage = new Message({
            receiverId:receiverId,
            senderId:senderId,
            text:text,
            image:imageUrl,
        });

        await newMessage.save();

        const recieverSocketId = getRecieverSocketId(receiverId);

        if(recieverSocketId){
            io.to(recieverSocketId).emit("newMessage",newMessage);
        }

        return res.status(201).json(newMessage);

    } catch (error) {
        console.error("Error in sending message controller:",error);
        res.status(500).json({message:"Internal server error"});
    }
}