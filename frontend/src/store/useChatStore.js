import { create } from "zustand";
import { toast } from "react-hot-toast"
import { axiosInstance } from "../lib/axios";
import { useAuthStore } from "./useAuthStore";

export const useChatStore = create((set, get) => ({
    messages: [],
    hasMore: false,
    users: [],
    selectedUser: null,
    isUsersLoading: false,
    isMessagesLoading: false,
    smartReplies: [],
    isRepliesLoading: false,
    
    getUsers: async () => {
        set({ isUsersLoading: true });
        try {
            const res = await axiosInstance.get("app/messages/users");
            set({ users: res.data });
        } catch (error) {
            toast.error(error.response.data.message);
        }
        finally {
            set({ isUsersLoading: false });
        }
    },

    getMessages: async (userId) => {
        set({ isMessagesLoading: true });
        try {
            const res = await axiosInstance.get(`app/messages/${userId}`);
            set({ messages: res.data.messages, hasMore: res.data.hasMore ?? false });

            const socket = useAuthStore.getState().socket;
            if (socket && res.data.conversationId) {
                socket
                    .timeout(5000)
                    .emit("join_room", res.data.conversationId, (err, ack) => {
                        if (err || !ack?.ok) {
                            console.warn(
                                "Could not join conversation room:",
                                err?.message || ack?.message
                            );
                        }
                    });
            }
        } catch (error) {
            toast.error(error.response?.data?.message)
        } finally {
            set({ isMessagesLoading: false })
        }
    },

    loadOlderMessages: async () => {
        const { selectedUser, messages, hasMore } = get();
        if (!hasMore || !selectedUser || messages.length === 0) return;

        try {
            const oldest = messages[0];
            const res = await axiosInstance.get(
                `app/messages/${selectedUser._id}`,
                { params: { limit: 30, before: oldest.createdAt } }
            );
            const known = new Set(messages.map((m) => m._id));
            const older = res.data.messages.filter((m) => !known.has(m._id));
            set({
                messages: [...older, ...messages],
                hasMore: res.data.hasMore ?? false,
            });
        } catch (error) {
            toast.error(
                error.response?.data?.message || "Failed to load older messages"
            );
        }
    },

    sendMessage: async (messageData) => {
        const { selectedUser, messages } = get();
        try {
            const res = await axiosInstance.post(
                `app/messages/send/${selectedUser._id}`,
                messageData
            );
            set({ messages: [...messages, res.data] });
        } catch (error) {
            toast.error(error.response?.data?.message);
        }
    },

    inviteByEmail: async (email) => {
        try {
            await axiosInstance.post("app/messages/invite", { email });
            toast.success("User invited successfully");
            get().getUsers();
        } catch (error) {
            toast.error(error.response?.data?.message);
        }
    },

    subscribeToMessages: () => {
        const { selectedUser } = get();
        if (!selectedUser) return;

        const socket = useAuthStore.getState().socket;

        if (!socket) return;

        socket.on("newMessage", (newMessage) => {
            const { selectedUser: current, messages } = get();

            // The socket may still be sitting in rooms of previously opened
            // chats; only render messages for the conversation on screen.
            if (!current || newMessage.conversationId !== current._id) return;

            // The sender's own message already arrived via the REST response.
            if (messages.some((m) => m._id === newMessage._id)) return;

            if (newMessage.createdAt) {
                const latency = Date.now() - Date.parse(newMessage.createdAt);
                console.log(`Real-time latency: ${latency}ms`);
            }

            set({ messages: [...messages, newMessage] });
        });
    },

    unsubscribeFromMessages: () => {
        const socket = useAuthStore.getState().socket;
        socket.off("newMessage");
    },

    setSelectedUser: (selectedUser) => set({ selectedUser }),

    getSmartReplies: async (userId) => {
        set({ isRepliesLoading: true, smartReplies: [] });
        try {
            const res = await axiosInstance.get(`app/messages/smart-replies/${userId}`);
            set({ smartReplies: res.data });
        } catch (error) {
            console.error("Failed to fetch smart replies", error);
        } finally {
            set({ isRepliesLoading: false });
        }
    },

    createGroup: async (groupName, emailsArray) => {
        try {
            await axiosInstance.post("app/messages/group", { 
                groupName, 
                emails: emailsArray 
            });
            toast.success("Group created successfully!");
            get().getUsers(); // Refresh the sidebar
        } catch (error) {
            toast.error(error.response?.data?.message || "Failed to create group");
        }
    }
    
}))