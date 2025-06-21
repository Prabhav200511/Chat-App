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
        if(!authUser||get().socket?.connected) return;

        const socket = io(HOME_URL, {
            query:{
                userId:authUser._id,
            },
        }
        );
        socket.connect();

        set({socket:socket})

        socket.on("getOnlineUsers", (userIds) => {
            set({onlineUsers: userIds});
        })
    },

    disconnectSocket: () => {
        if (get().socket?.connected) get().socket.disconnect();
    }
}));