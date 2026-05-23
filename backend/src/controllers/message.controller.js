import cloudinary from "../lib/cloudinary.js";
import User from "../models/user.model.js";
import Message from "../models/message.model.js";
import Conversation from "../models/conversation.model.js";
import { io } from "../lib/socket.js";

export const inviteUserByEmail = async (req, res) => {
    try {
        const { email } = req.body;
        const myId = req.user._id;

        if (req.user.email === email) {
            return res.status(400).json({ message: "You cannot invite yourself" });
        }

        const targetUser = await User.findOne({ email }).select("-password");
        if (!targetUser) {
            return res.status(404).json({ message: "User not found with that email" });
        }

        let conversation = await Conversation.findOne({
            participants: { $all: [myId, targetUser._id] }
        });

        if (conversation) {
            return res.status(400).json({ message: "Conversation already exists" });
        }

        conversation = await Conversation.create({
            participants: [myId, targetUser._id],
            messages: []
        });

        res.status(201).json({ message: "Invite successful", conversation });
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
};

export const getUsersforSidebar = async (req, res) => {
    try {
        const loggedInUserId = req.user._id;
        
        const conversations = await Conversation.find({
            participants: loggedInUserId
        }).populate({
            path: "participants",
            match: { _id: { $ne: loggedInUserId } },
            select: "-password"
        });

        const filteredUsers = conversations.map(conv => conv.participants[0]).filter(Boolean);

        res.status(200).json(filteredUsers);
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}

export const getMessages = async (req, res) => {
    try {
        const { id: userToChatWithId } = req.params;
        const myId = req.user._id;

        const conversation = await Conversation.findOne({
            participants: { $all: [myId, userToChatWithId] }
        }).populate("messages");

        if (!conversation) {
            return res.status(200).json({ conversationId: null, messages: [] });
        }

        return res.status(200).json({ 
            conversationId: conversation._id, 
            messages: conversation.messages 
        });
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
}

export const sendMessage = async (req, res) => {
    try {
        const { text, image } = req.body;
        const { id: receiverId } = req.params;
        const senderId = req.user._id;

        let imageUrl;
        if (image) {
            const uploadImage = await cloudinary.uploader.upload(image);
            imageUrl = uploadImage.secure_url;
        };

        const newMessage = new Message({
            receiverId: receiverId,
            senderId: senderId,
            text: text,
            image: imageUrl,
        });

        await newMessage.save();

        let conversation = await Conversation.findOne({
            participants: { $all: [senderId, receiverId] }
        });

        if (conversation) {
            conversation.messages.push(newMessage._id);
            await conversation.save();
            io.to(conversation._id.toString()).emit("newMessage", newMessage);
        }

        return res.status(201).json(newMessage);

    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
}