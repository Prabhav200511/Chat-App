import { X } from "lucide-react";
import { useAuthStore } from "../store/useAuthStore";
import { useChatStore } from "../store/useChatStore";

const ChatHeader = () => {
    const { selectedUser, setSelectedUser } = useChatStore();
    const { onlineUsers } = useAuthStore();

    // Helper to format the participant names for groups
    const getParticipantNames = () => {
        if (!selectedUser?.participants) return "";
        // Extract names, filter out the current user if you want, and join with commas
        return selectedUser.participants.map(p => p.fullName).join(", ");
    };

    return (
        <div className="p-2.5 border-b border-base-300">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className="avatar">
                        <div className="size-10 rounded-full relative">
                            <img src={selectedUser.profilePic || "/avatar.png"} alt={selectedUser.fullName} />
                        </div>
                    </div>

                    {/* User / Group info */}
                    <div>
                        <h3 className="font-medium">{selectedUser.fullName}</h3>
                        
                        {/* CONDITIONAL SUBTITLE */}
                        {selectedUser.isGroup ? (
                            <p className="text-xs text-base-content/70 truncate max-w-[200px] lg:max-w-md">
                                {getParticipantNames()}
                            </p>
                        ) : (
                            <p className="text-sm text-base-content/70">
                                {onlineUsers.includes(selectedUser._id) ? "Online" : "Offline"}
                            </p>
                        )}
                    </div>
                </div>

                {/* Close button */}
                <button onClick={() => setSelectedUser(null)}>
                    <X />
                </button>
            </div>
        </div>
    );
};

export default ChatHeader;