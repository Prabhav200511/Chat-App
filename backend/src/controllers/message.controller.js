import cloudinary from "../lib/cloudinary.js";
import User from "../models/user.model.js";
import Message from "../models/message.model.js";
import Conversation from "../models/conversation.model.js";
import { getIO } from "../lib/socket.js";
import {
    getAuthorizedConversation,
    respondNotFound,
} from "../lib/conversationAccess.js";
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
            participants: { $all: [myId, targetUser._id] },
            isGroup: false,
        });

        if (conversation) {
            return res.status(400).json({ message: "Conversation already exists" });
        }

        conversation = await Conversation.create({
            participants: [myId, targetUser._id],
        });

        res.status(201).json({ message: "Invite successful", conversation });
    } catch (error) {
        console.error("Error inviting user:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

export const getUsersforSidebar = async (req, res) => {
    try {
        const loggedInUserId = req.user._id;

        const conversations = await Conversation.find({
            participants: loggedInUserId,
        }).populate("participants", "-password");

        // Sidebar entries are keyed by CONVERSATION id in both cases, so the
        // frontend can route getMessages/sendMessage without guessing whether
        // it holds a user id or a conversation id.
        const formattedChats = conversations
            .map((conv) => {
                const participants = conv.participants.filter(Boolean);

                if (conv.isGroup) {
                    return {
                        _id: conv._id,
                        fullName: conv.groupName,
                        profilePic: "/avatar.png",
                        isGroup: true,
                        participants,
                    };
                }

                const otherUser = participants.find(
                    (p) => p._id.toString() !== loggedInUserId.toString()
                );
                if (!otherUser) return null;

                return {
                    _id: conv._id,
                    fullName: otherUser.fullName,
                    profilePic: otherUser.profilePic,
                    isGroup: false,
                    otherUser,
                };
            })
            .filter(Boolean);

        res.status(200).json(formattedChats);
    } catch (error) {
        console.error("Error formatting sidebar:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
};

export const getMessages = async (req, res) => {
    try {
        const { id: conversationId } = req.params;
        const myId = req.user._id;

        // Membership gate: unknown id and foreign id are indistinguishable
        // to the caller (both 404) — no existence oracle.
        const conversation = await getAuthorizedConversation(conversationId, myId);
        if (!conversation) return respondNotFound(res);

        const { limit = 30, before } = req.validated?.query ?? {};

        const query = { conversationId: conversation._id };
        if (before) {
            query.createdAt = { $lt: new Date(before) };
        }

        // Fetch one extra row to detect whether an older page exists.
        const rows = await Message.find(query)
            .sort({ createdAt: -1 })
            .limit(limit + 1)
            .lean();

        const hasMore = rows.length > limit;
        const messages = rows.slice(0, limit).reverse();

        return res.status(200).json({
            conversationId: conversation._id,
            messages,
            hasMore,
        });
    } catch (error) {
        console.error("Error in getMessages:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

export const sendMessage = async (req, res) => {
    try {
        const { text, image } = req.body;
        const { id: conversationId } = req.params;
        const senderId = req.user._id;

        // Authorize BEFORE spending a Cloudinary upload.
        const conversation = await getAuthorizedConversation(conversationId, senderId);
        if (!conversation) return respondNotFound(res);

        let imageUrl;
        if (image) {
            const uploadImage = await cloudinary.uploader.upload(image);
            imageUrl = uploadImage.secure_url;
        }

        const newMessage = await Message.create({
            conversationId: conversation._id,
            senderId,
            text,
            image: imageUrl,
        });

        getIO()?.to(conversation._id.toString()).emit("newMessage", newMessage);

        return res.status(201).json(newMessage);
    } catch (error) {
        console.error("Error in sendMessage:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export const getSmartReplies = async (req, res) => {
    try {
        const { id: conversationId } = req.params;
        const myId = req.user._id;

        // 404 before any Gemini call — an unauthorized caller must never
        // cost us an LLM request.
        const conversation = await getAuthorizedConversation(conversationId, myId);
        if (!conversation) return respondNotFound(res);

        const recent = await Message.find({ conversationId: conversation._id })
            .sort({ createdAt: -1 })
            .limit(5)
            .lean();

        if (recent.length === 0) {
            return res.status(200).json([]);
        }

        // Format chat history (Gemini can handle multiple speakers)
        const chatHistory = recent
            .reverse()
            .map((msg) => {
                const sender =
                    msg.senderId.toString() === myId.toString() ? "Me" : "Someone else";
                return `${sender}: ${msg.text || "[Image attachment]"}`;
            })
            .join("\n");

        const prompt = `You are a helpful AI generating smart, quick replies for a chat application.
        Read the recent chat history below:
        
        ${chatHistory}
        
        Generate exactly 3 short, natural-sounding, and contextually appropriate reply options for "Me" to send next.
        Format the output strictly as a valid JSON array of strings. Do not include markdown code blocks, labels, or any other text.
        Example: ["Sounds good!", "What time?", "I'll check on that."]`;

        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        let replies = [];
        try {
            const cleanedText = responseText
                .replace(/```json/g, "")
                .replace(/```/g, "")
                .trim();
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
        const { groupName, emails } = req.body;
        const myId = req.user._id;

        if (!groupName || !emails || emails.length === 0) {
            return res.status(400).json({ message: "Group name and at least one email required" });
        }

        // 1. Find all users matching the provided emails
        const usersToAdd = await User.find({ email: { $in: emails } });

        // 2. Extract their IDs and add the creator's ID
        const participantIds = usersToAdd.map((user) => user._id);
        participantIds.push(myId);

        if (participantIds.length < 3) {
            return res.status(400).json({ message: "A group must have at least 3 people (you + 2 others)" });
        }

        // 3. Create the Group Conversation
        const groupConversation = await Conversation.create({
            isGroup: true,
            groupName: groupName,
            participants: participantIds,
        });

        res.status(201).json({ message: "Group created successfully", conversation: groupConversation });
    } catch (error) {
        console.error("Error creating group:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};
