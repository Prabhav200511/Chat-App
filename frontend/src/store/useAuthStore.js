import {create} from "zustand"
import {axiosInstance} from "../lib/axios.js"
import toast from "react-hot-toast";
import { io } from "socket.io-client";

const HOME_URL = import.meta.env.MODE ==="development"? "http://localhost:4000" : "/"

export const useAuthStore = create((set , get) => ({
    authUser: null,
    isSigningUp: false,
    isLoggingIn: false,
    isUpdatingProfile: false,
    isCheckingAuth: true,    
    onlineUsers: [],
    socket :null,

    checkAuth: async () => { 
        set({ isCheckingAuth: true });
        try {
            const res = await axiosInstance.get("/app/auth/check", {
                withCredentials: true
            });

            if (!res.data) {
                set({ authUser: null });
                return;
            }

            set({ authUser: res.data });
            get().connectSocket();
        } catch (error) {
            console.error("Error in checkingAuth:", error);
            set({ authUser: null });
        } finally {
            set({ isCheckingAuth: false });
        }
    },

    signup: async (data) => {
        set({isSigningUp:true});
        try {
            const res = await axiosInstance.post("app/auth/signup",data);
            toast.success("Account is successfully created");
            set({authUser:res.data});
            get().connectSocket();
        } catch (error) {
            toast.error(error.response.data.message);
        }
        finally{
            set({isSigningUp:false});
        }
    },

    logout: async () => {
        try {
            await axiosInstance.post("app/auth/logout");
            set({authUser:null});
            toast.success("Logged out successfully");
            get().disconnectSocket();
        } catch (error) {
            toast.error(error.response.data.message);
        }
    },

    login : async(data) => {
        set({isLoggingIn:true});
        try {
            const res = await axiosInstance.post("app/auth/login",data);
            toast.success("Logged in sucessfully");
            set({authUser:res.data});

            get().connectSocket();
        } catch (error) {
            toast.error(error.response.data.message);
        }
        finally{
            set({isLoggingIn:false});
        }
    },

    updatingProfile: async(data) => {
        set({isUpdatingProfile:true});
        try {
            const res = await axiosInstance.put("/app/auth/update-profile",data);
            toast.success("Profile Updated Successfully");
            set({authUser:res.data});
            
        } catch (error) {
            toast.error(error.response.data.message);
        }
        finally{
            set({isUpdatingProfile:false});
        }
    },

    connectSocket: () => {
        const {authUser} = get();
        // A socket instance must never be duplicated. The old check only
        // guarded `connected`, so a disconnected-but-alive socket spawned a
        // second instance with duplicated listeners.
        if(!authUser||get().socket) return;

        // Identity comes from the httpOnly JWT cookie, never from a query param.
        const socket = io(HOME_URL, {
            withCredentials: true,
        }
        );
        socket.connect();

        set({socket:socket})

        // Delta presence: a snapshot on (re)connect plus transition-only
        // deltas. Handlers enforce set semantics so interleaved/duplicate
        // events are idempotent by design.
        socket.on("presence:snapshot", (userIds) => {
            set({onlineUsers: [...new Set(userIds)]});
        })

        socket.on("presence:join", ({userId}) => {
            set((state) =>
                state.onlineUsers.includes(userId)
                    ? state
                    : {onlineUsers: [...state.onlineUsers, userId]}
            );
        })

        socket.on("presence:leave", ({userId}) => {
            set((state) => ({
                onlineUsers: state.onlineUsers.filter((id) => id !== userId),
            }));
        })
    },

    disconnectSocket: () => {
        const socket = get().socket;
        if (!socket) return;
        // Drop listeners and presence state so a logout/login as a different
        // user can never inherit stale events.
        socket.removeAllListeners();
        socket.disconnect();
        set({socket:null, onlineUsers:[]});
    }
}));