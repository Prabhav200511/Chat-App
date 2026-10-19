import { create } from "zustand";
import { toast } from "react-hot-toast"
import { axiosInstance } from "../lib/axios";
import { useAuthStore } from "./useAuthStore";

// Read, send, and socket responses may arrive in any order.
const mergeMessages = (...pages) => [...new Map(
    pages.flat().map((message) => [message._id, message])
).values()].sort((a, b) =>
    Date.parse(a.createdAt) - Date.parse(b.createdAt) || a._id.localeCompare(b._id)
);

export const useChatStore = create((set, get) => {
    let selectionVersion = 0;
    let messagesRequest = 0;
    let repliesRequest = 0;
    const isCurrent = (conversationId, version) =>
        version === selectionVersion && get().selectedUser?._id === conversationId;

    return {
        messages: [],
        hasMore: false,
        nextCursor: null,
        users: [],
        selectedUser: null,
        isUsersLoading: false,
        isMessagesLoading: false,
        isOlderMessagesLoading: false,
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

        getMessages: async (conversationId) => {
            const version = selectionVersion;
            const requestId = ++messagesRequest;
            const isActive = () => isCurrent(conversationId, version) && requestId === messagesRequest;
            set({ isMessagesLoading: true });
            try {
                const res = await axiosInstance.get(`app/messages/${conversationId}`);
                if (!isActive()) return;
                set((state) => ({
                    messages: mergeMessages(res.data.messages, state.messages),
                    hasMore: res.data.hasMore ?? false,
                    nextCursor: res.data.nextCursor ?? null,
                }));

                const socket = useAuthStore.getState().socket;
                if (socket && res.data.conversationId) {
                    socket
                        .timeout(5000)
                        .emit("join_room", res.data.conversationId, (err, ack) => {
                            if (isActive() && (err || !ack?.ok)) {
                                toast.error("Could not connect to live messages. Please reopen the chat.");
                            }
                        });
                }
            } catch (error) {
                if (isActive()) toast.error(error.response?.data?.message || "Failed to load messages");
            } finally {
                if (isActive()) set({ isMessagesLoading: false });
            }
        },

        loadOlderMessages: async () => {
            const { selectedUser, messages, hasMore, nextCursor, isOlderMessagesLoading } = get();
            if (!hasMore || !selectedUser || messages.length === 0 || isOlderMessagesLoading) return;
            const conversationId = selectedUser._id;
            const version = selectionVersion;
            set({ isOlderMessagesLoading: true });

            try {
                const oldest = messages[0];
                const res = await axiosInstance.get(
                    `app/messages/${conversationId}`,
                    { params: { limit: 30, ...(nextCursor ?? {
                        before: oldest.createdAt,
                        beforeId: oldest._id,
                    }) } }
                );
                if (!isCurrent(conversationId, version)) return;
                set((state) => ({
                    messages: mergeMessages(res.data.messages, state.messages),
                    hasMore: res.data.hasMore ?? false,
                    nextCursor: res.data.nextCursor ?? null,
                }));
            } catch (error) {
                if (isCurrent(conversationId, version)) toast.error(
                    error.response?.data?.message || "Failed to load older messages"
                );
            } finally {
                if (isCurrent(conversationId, version)) set({ isOlderMessagesLoading: false });
            }
        },

        sendMessage: async (messageData) => {
            const { selectedUser } = get();
            if (!selectedUser) return;
            const conversationId = selectedUser._id;
            const version = selectionVersion;
            try {
                const res = await axiosInstance.post(
                    `app/messages/send/${conversationId}`,
                    messageData
                );
                if (!isCurrent(conversationId, version)) return;
                set((state) => ({ messages: mergeMessages(state.messages, [res.data]) }));
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

                // Either the socket echo or the REST response may arrive first.
                if (messages.some((m) => m._id === newMessage._id)) return;

                if (newMessage.createdAt) {
                    const latency = Date.now() - Date.parse(newMessage.createdAt);
                    console.log(`Real-time latency: ${latency}ms`);
                }

                set((state) => ({ messages: mergeMessages(state.messages, [newMessage]) }));
            });
        },

        unsubscribeFromMessages: () => {
            const socket = useAuthStore.getState().socket;
            socket?.off("newMessage");
        },

        setSelectedUser: (selectedUser) => {
            if (get().selectedUser?._id === selectedUser?._id) {
                set({ selectedUser });
                return;
            }
            selectionVersion++;
            set({
                selectedUser,
                messages: [],
                hasMore: false,
                nextCursor: null,
                smartReplies: [],
                isMessagesLoading: false,
                isOlderMessagesLoading: false,
                isRepliesLoading: false,
            });
        },

        getSmartReplies: async (conversationId) => {
            const version = selectionVersion;
            const requestId = ++repliesRequest;
            const isActive = () => isCurrent(conversationId, version) && requestId === repliesRequest;
            set({ isRepliesLoading: true, smartReplies: [] });
            try {
                const res = await axiosInstance.get(`app/messages/smart-replies/${conversationId}`);
                if (isActive()) set({ smartReplies: res.data });
            } catch (error) {
                console.error("Failed to fetch smart replies", error);
            } finally {
                if (isActive()) set({ isRepliesLoading: false });
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

    };
});
