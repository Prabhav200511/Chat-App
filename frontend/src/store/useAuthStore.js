import { create } from "zustand";
import { axiosInstance } from "../lib/axios.js";
import toast from "react-hot-toast";
import { io } from "socket.io-client";

const HOME_URL = import.meta.env.MODE === "development" ? "http://localhost:4000" : "/";

export const useAuthStore = create((set, get) => {
    let authVersion = 0;
    let socketVersion = 0;
    let removeSocketHandlers = () => {};
    const setAccount = (user) => {
        if (get().authUser?._id !== user?._id) get().disconnectSocket();
        set({ authUser: user });
        if (user) get().connectSocket();
    };

    return {
        authUser: null,
        isSigningUp: false,
        isLoggingIn: false,
        isUpdatingProfile: false,
        isCheckingAuth: true,
        onlineUsers: [],
        socket: null,
        realtimeReady: false,
        roomsReady: false,
        realtimeEpoch: 0,

        checkAuth: async () => {
            const version = authVersion;
            set({ isCheckingAuth: true });
            try {
                const res = await axiosInstance.get("/app/auth/check", { withCredentials: true });
                if (version === authVersion) setAccount(res.data || null);
            } catch (error) {
                if (version === authVersion) {
                    console.error("Error in checkingAuth:", error);
                    setAccount(null);
                }
            } finally {
                if (version === authVersion) set({ isCheckingAuth: false });
            }
        },

        signup: async (data) => {
            const version = ++authVersion;
            set({ isSigningUp: true, isCheckingAuth: false });
            try {
                const res = await axiosInstance.post("app/auth/signup", data);
                if (version !== authVersion) return;
                setAccount(res.data);
                toast.success("Account is successfully created");
            } catch (error) {
                if (version === authVersion) toast.error(error.response?.data?.message || "Signup failed");
            } finally {
                if (version === authVersion) set({ isSigningUp: false });
            }
        },

        login: async (data) => {
            const version = ++authVersion;
            set({ isLoggingIn: true, isCheckingAuth: false });
            try {
                const res = await axiosInstance.post("app/auth/login", data);
                if (version !== authVersion) return;
                setAccount(res.data);
                toast.success("Logged in successfully");
            } catch (error) {
                if (version === authVersion) toast.error(error.response?.data?.message || "Login failed");
            } finally {
                if (version === authVersion) set({ isLoggingIn: false });
            }
        },

        logout: async () => {
            const version = ++authVersion;
            try {
                await axiosInstance.post("app/auth/logout");
                if (version !== authVersion) return;
                get().disconnectSocket();
                set({ authUser: null, isCheckingAuth: false, isLoggingIn: false, isSigningUp: false, isUpdatingProfile: false });
                toast.success("Logged out successfully");
            } catch (error) {
                if (version === authVersion) toast.error(error.response?.data?.message || "Logout failed");
            }
        },

        updatingProfile: async (data) => {
            const version = authVersion;
            set({ isUpdatingProfile: true });
            try {
                const res = await axiosInstance.put("/app/auth/update-profile", data);
                if (version !== authVersion) return;
                set({ authUser: res.data });
                toast.success("Profile updated successfully");
            } catch (error) {
                if (version === authVersion) toast.error(error.response?.data?.message || "Profile update failed");
            } finally {
                if (version === authVersion) set({ isUpdatingProfile: false });
            }
        },

        connectSocket: () => {
            const userId = get().authUser?._id;
            if (!userId || get().socket) return;
            const socket = io(HOME_URL, { withCredentials: true, autoConnect: false });
            const version = ++socketVersion;
            const isCurrent = () => version === socketVersion && get().socket === socket && get().authUser?._id === userId;
            const handlers = {
                "presence:snapshot": (ids) => {
                    if (isCurrent()) set({ onlineUsers: [...new Set(ids)] });
                },
                "presence:join": ({ userId }) => {
                    if (isCurrent()) set((state) => state.onlineUsers.includes(userId)
                        ? state : { onlineUsers: [...state.onlineUsers, userId] });
                },
                "presence:leave": ({ userId }) => {
                    if (isCurrent()) set((state) => state.onlineUsers.includes(userId)
                        ? { onlineUsers: state.onlineUsers.filter((id) => id !== userId) } : state);
                },
                "realtime:ready": ({ roomsReady }) => {
                    if (!isCurrent()) return;
                    set((state) => ({
                        realtimeReady: true, roomsReady,
                        realtimeEpoch: state.realtimeEpoch + 1,
                    }));
                    if (!roomsReady) toast.error("Live connection is limited. Reconnecting or reopening the chat may help.");
                },
                disconnect: () => {
                    if (isCurrent()) set({ onlineUsers: [], realtimeReady: false, roomsReady: false });
                },
                connect_error: () => {
                    if (isCurrent()) set({ onlineUsers: [], realtimeReady: false, roomsReady: false });
                },
            };
            set({ socket, onlineUsers: [], realtimeReady: false, roomsReady: false });
            for (const [event, handler] of Object.entries(handlers)) socket.on(event, handler);
            removeSocketHandlers = () => {
                for (const [event, handler] of Object.entries(handlers)) socket.off(event, handler);
            };
            socket.connect();
        },

        disconnectSocket: () => {
            socketVersion++;
            const socket = get().socket;
            set({ socket: null, onlineUsers: [], realtimeReady: false, roomsReady: false });
            removeSocketHandlers();
            removeSocketHandlers = () => {};
            socket?.disconnect();
        },
    };
});
