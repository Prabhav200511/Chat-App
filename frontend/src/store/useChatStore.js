import { create } from "zustand";
import { toast } from "react-hot-toast"
import { axiosInstance } from "../lib/axios";
import { useAuthStore } from "./useAuthStore";

export const useChatStore = create((set, get) => ({
    messages: [],
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
            set({ messages: res.data.messages });

            const socket = useAuthStore.getState().socket;
            if (socket && res.data.conversationId) {
                socket.emit("join_room", res.data.conversationId);
            }
        } catch (error) {
            toast.error(error.response?.data?.message)
        } finally {
            set({ isMessagesLoading: false })
        }
    },

    sendMessage: async (messageData) => {
        const { selectedUser, messages } = get();
        try {
            const res = await axiosInstance.post(`app/messages/send/${selectedUser._id}`, messageData);
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
            const isCorrectUser = newMessage.senderId === selectedUser._id
            if (!isCorrectUser) return;
            set({ messages: [...get().messages, newMessage] })
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