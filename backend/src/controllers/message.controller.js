import cloudinary from "../lib/cloudinary.js";
import User from "../models/user.model.js";
import Message from "../models/message.model.js";
import Conversation from "../models/conversation.model.js";
import { io } from "../lib/socket.js";
import { GoogleGenerativeAI } from "@google/generative-ai";


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
        }).populate("participants", "-password");

        const formattedChats = conversations.map(conv => {
            if (conv.isGroup) {
                return {
                    _id: conv._id,
                    fullName: conv.groupName,
                    profilePic: "/avatar.png", // Or a group icon if you have one
                    isGroup: true,
                    isConversationId: true,
                    participants: conv.participants // <--- ADD THIS LINE
                };
            } else {
                const otherUser = conv.participants.find(p => p._id.toString() !== loggedInUserId.toString());
                return {
                    _id: otherUser._id,
                    fullName: otherUser.fullName,
                    profilePic: otherUser.profilePic,
                    isGroup: false
                };
            }
        }).filter(Boolean);

        res.status(200).json(formattedChats);
    } catch (error) {
        console.error("Error formatting sidebar:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
}

export const getMessages = async (req, res) => {
    try {
        const { id: chatOrUserId } = req.params;
        const myId = req.user._id;

        // 1. Try to find by Conversation ID (This handles Groups!)
        let conversation = await Conversation.findById(chatOrUserId).populate("messages");

        // 2. If not found, it must be a 1-on-1 chat, so search by participant IDs
        if (!conversation) {
            conversation = await Conversation.findOne({
                isGroup: false,
                participants: { $all: [myId, chatOrUserId] }
            }).populate("messages");
        }

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
        const { id: chatOrUserId } = req.params;
        const senderId = req.user._id;

        let imageUrl;
        if (image) {
            const uploadImage = await cloudinary.uploader.upload(image);
            imageUrl = uploadImage.secure_url;
        }

        // We use chatOrUserId as receiverId for compatibility with your Message model
        const newMessage = new Message({
            receiverId: chatOrUserId, 
            senderId: senderId,
            text: text,
            image: imageUrl,
        });

        await newMessage.save();

        // 1. Try to find by Conversation ID
        let conversation = await Conversation.findById(chatOrUserId);

        // 2. If not found, search by participant IDs
        if (!conversation) {
            conversation = await Conversation.findOne({
                isGroup: false,
                participants: { $all: [senderId, chatOrUserId] }
            });
        }

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

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export const getSmartReplies = async (req, res) => {
    try {
        const { id: chatOrUserId } = req.params;
        const myId = req.user._id;

        // 1. Try to find by Conversation ID (This handles Groups!)
        let conversation = await Conversation.findById(chatOrUserId).populate({
            path: "messages",
            options: { sort: { createdAt: -1 }, limit: 5 } // Fetch newest first
        });

        // 2. If not found, it must be a 1-on-1 chat, so search by participant IDs
        if (!conversation) {
            conversation = await Conversation.findOne({
                isGroup: false,
                participants: { $all: [myId, chatOrUserId] }
            }).populate({
                path: "messages",
                options: { sort: { createdAt: -1 }, limit: 5 }
            });
        }

        if (!conversation || conversation.messages.length === 0) {
            return res.status(200).json([]);
        }

        // Format chat history (Gemini can handle multiple speakers)
        const chatHistory = conversation.messages.reverse().map(msg => {
            const sender = msg.senderId.toString() === myId.toString() ? "Me" : "Someone else";
            return `${sender}: ${msg.text || "[Image attachment]"}`;
        }).join("\n");

        const prompt = `You are a helpful AI generating smart, quick replies for a chat application.
        Read the recent chat history below:
        
        ${chatHistory}
        
        Generate exactly 3 short, natural-sounding, and contextually appropriate reply options for "Me" to send next.
        Format the output strictly as a valid JSON array of strings. Do not include markdown code blocks, labels, or any other text.
        Example: ["Sounds good!", "What time?", "I'll check on that."]`;

        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" }); // Or whatever model you settled on
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        let replies = [];
        try {
            const cleanedText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
            replies = JSON.parse(cleanedText);
        } catch (parseError) {
            console.error("Failed to parse Gemini response:", responseText);
        }

        return res.status(200).json(replies);

    } catch (error) {
        console.error("Error generating smart replies:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};


export const createGroupChat = async (req, res) => {
    try {
        const { groupName, emails } = req.body; // e.g., emails: ["friend1@a.com", "friend2@a.com"]
        const myId = req.user._id;

        if (!groupName || !emails || emails.length === 0) {
            return res.status(400).json({ message: "Group name and at least one email required" });
        }

        // 1. Find all users matching the provided emails
        const usersToAdd = await User.find({ email: { $in: emails } });
        
        // 2. Extract their IDs and add the creator's ID
        const participantIds = usersToAdd.map(user => user._id);
        participantIds.push(myId);

        if (participantIds.length < 3) {
            return res.status(400).json({ message: "A group must have at least 3 people (you + 2 others)" });
        }

        // 3. Create the Group Conversation
        const groupConversation = await Conversation.create({
            isGroup: true,
            groupName: groupName,
            participants: participantIds,
            messages: []
        });

        res.status(201).json({ message: "Group created successfully", conversation: groupConversation });
    } catch (error) {
        console.error("Error creating group:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};