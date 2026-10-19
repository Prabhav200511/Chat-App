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
    let accountVersion = 0;
    let usersRequest = 0;
    let removeMessageListener = () => {};
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
            const version = accountVersion;
            const requestId = ++usersRequest;
            const userId = useAuthStore.getState().authUser?._id;
            if (!userId) return;
            const isActive = () => version === accountVersion && requestId === usersRequest &&
                userId === useAuthStore.getState().authUser?._id;
            set({ isUsersLoading: true });
            try {
                const res = await axiosInstance.get("app/messages/users");
                if (isActive()) set({ users: res.data });
            } catch (error) {
                if (isActive()) toast.error(error.response?.data?.message || "Failed to load conversations");
            }
            finally {
                if (isActive()) set({ isUsersLoading: false });
            }
        },

        getMessages: async (conversationId, { ensureJoined = false } = {}) => {
            const version = selectionVersion;
            const requestId = ++messagesRequest;
            const isActive = () => isCurrent(conversationId, version) && requestId === messagesRequest;
            set({ isMessagesLoading: true });
            try {
                const socket = useAuthStore.getState().socket;
                if (ensureJoined && socket && socket.connected !== false) {
                    // Subscribe before catch-up: messages arriving during the read
                    // are merged by the live listener instead of falling into a gap.
                    await new Promise((resolve) => {
                        socket.timeout(5000).emit("join_room", conversationId, (err, ack) => {
                            if (isActive() && (err || !ack?.ok)) {
                                toast.error("Could not connect to live messages. Please reopen the chat.");
                            }
                            resolve();
                        });
                    });
                    if (!isActive()) return;
                }
                const res = await axiosInstance.get(`app/messages/${conversationId}`);
                if (!isActive()) return;
                set((state) => ({
                    messages: mergeMessages(res.data.messages, state.messages),
                    hasMore: res.data.hasMore ?? false,
                    nextCursor: res.data.nextCursor ?? null,
                }));

                if (!ensureJoined && socket && socket.connected !== false && res.data.conversationId) {
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

        subscribeToMessages: (socket = useAuthStore.getState().socket) => {
            removeMessageListener();
            const { selectedUser } = get();
            if (!selectedUser || !socket) return () => {};
            const version = accountVersion;

            const handler = (newMessage) => {
                if (version !== accountVersion || socket !== useAuthStore.getState().socket) return;
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
            };
            socket.on("newMessage", handler);
            const cleanup = () => socket.off("newMessage", handler);
            removeMessageListener = cleanup;
            return cleanup;
        },

        unsubscribeFromMessages: () => removeMessageListener(),

        subscribeToConversations: (socket = useAuthStore.getState().socket) => {
            if (!socket) return () => {};
            const version = accountVersion;
            const handler = () => {
                if (version === accountVersion && socket === useAuthStore.getState().socket) get().getUsers();
            };
            socket.on("conversation:new", handler);
            return () => socket.off("conversation:new", handler);
        },

        resetForAccount: () => {
            accountVersion++;
            selectionVersion++;
            usersRequest++;
            removeMessageListener();
            set({
                selectedUser: null, users: [], messages: [], smartReplies: [],
                hasMore: false, nextCursor: null, isUsersLoading: false,
                isMessagesLoading: false, isOlderMessagesLoading: false, isRepliesLoading: false,
            });
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

// Keep account cleanup here so the auth store never imports the chat store.
useAuthStore.subscribe((state, previous) => {
    if (state.authUser?._id !== previous.authUser?._id) useChatStore.getState().resetForAccount();
});
