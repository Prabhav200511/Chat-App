import React, { useEffect, useState } from 'react'
import { useChatStore } from '../store/useChatStore'
import SidebarSkeleton from "../components/skeletons/SidebarSkeleton"
import { Users, MailPlus } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';

const Sidebar = () => {
    const { getUsers, users, selectedUser, setSelectedUser, isUserLoading, inviteByEmail, createGroup } = useChatStore();
    const [showOnlineOnly, setShowOnlineOnly] = useState(false);
    const [inviteEmail, setInviteEmail] = useState("");
    const [isCreatingGroup, setIsCreatingGroup] = useState(false);
    const [groupName, setGroupName] = useState("");
    const [groupEmails, setGroupEmails] = useState("");

    const { onlineUsers } = useAuthStore();

    const filteredUsers = showOnlineOnly ? users.filter(user => onlineUsers.includes(user._id)) : users;

    useEffect(() => {
        getUsers()
    }, [getUsers]);

    const handleInvite = (e) => {
        e.preventDefault();
        if (!inviteEmail.trim()) return;
        inviteByEmail(inviteEmail);
        setInviteEmail("");
    };

    if (isUserLoading) return <SidebarSkeleton />

    return (
        <aside className="h-full w-20 lg:w-72 border-r border-base-300 flex flex-col transition-all duration-200">
            <div className="border-b border-base-300 w-full p-5">
                <div className="flex items-center gap-2">
                    <Users className="size-6" />
                    <span className="font-medium hidden lg:block">Contacts</span>
                </div>
                
                <div className="mt-4 hidden lg:flex flex-col gap-2">
                    <div className="flex gap-2 mb-2">
                        <button 
                            className={`btn btn-xs ${!isCreatingGroup ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => setIsCreatingGroup(false)}
                        >
                            Invite
                        </button>
                        <button 
                            className={`btn btn-xs ${isCreatingGroup ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => setIsCreatingGroup(true)}
                        >
                            New Group
                        </button>
                    </div>

                    {!isCreatingGroup ? (
                        <form onSubmit={handleInvite} className="flex items-center gap-2">
                            <input
                                type="email"
                                placeholder="Invite by email..."
                                value={inviteEmail}
                                onChange={(e) => setInviteEmail(e.target.value)}
                                className="input input-sm input-bordered w-full"
                            />
                            <button type="submit" className="btn btn-sm btn-square btn-primary">
                                <MailPlus className="size-4" />
                            </button>
                        </form>
                    ) : (
                        <form onSubmit={(e) => {
                            e.preventDefault();
                            if (!groupName || !groupEmails) return;
                            const emailsArray = groupEmails.split(",").map(email => email.trim());
                            createGroup(groupName, emailsArray);
                            setGroupName("");
                            setGroupEmails("");
                            setIsCreatingGroup(false);
                        }} className="flex flex-col gap-2 p-2 bg-base-200 rounded-lg">
                            <input
                                type="text"
                                placeholder="Group Name"
                                value={groupName}
                                onChange={(e) => setGroupName(e.target.value)}
                                className="input input-sm input-bordered w-full"
                            />
                            <input
                                type="text"
                                placeholder="Emails (comma separated)"
                                value={groupEmails}
                                onChange={(e) => setGroupEmails(e.target.value)}
                                className="input input-sm input-bordered w-full text-xs"
                            />
                            <button type="submit" className="btn btn-sm btn-primary w-full">
                                Create Group
                            </button>
                        </form>
                    )}
                </div>

                <div className="mt-3 hidden lg:flex items-center gap-2">
                    <label className="cursor-pointer flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={showOnlineOnly}
                            onChange={(e) => setShowOnlineOnly(e.target.checked)}
                            className="checkbox checkbox-sm"
                        />
                        <span className="text-sm">Show online only</span>
                    </label>
                    <span className="text-xs text-zinc-500">({onlineUsers.length - 1} online)</span>
                </div>
            </div>

            <div className="overflow-y-auto w-full py-3">
                {filteredUsers.map((user) => (
                    <button
                        key={user._id}
                        onClick={() => setSelectedUser(user)}
                        className={`
                            w-full p-3 flex items-center gap-3
                            hover:bg-base-300 transition-colors
                            ${selectedUser?._id === user._id ? "bg-base-300 ring-1 ring-base-300" : ""}
                        `}
                    >
                        <div className="relative mx-auto lg:mx-0">
                            <img
                                src={user.profilePic || "/avatar.png"}
                                alt={user.name}
                                className="size-12 object-cover rounded-full"
                            />
                            {onlineUsers.includes(user._id) && (
                                <span
                                    className="absolute bottom-0 right-0 size-3 bg-green-500 
                                    rounded-full ring-2 ring-zinc-900"
                                />
                            )}
                        </div>

                        <div className="hidden lg:block text-left min-w-0">
                            <div className="font-medium truncate">{user.fullName}</div>
                            <div className="text-sm text-zinc-400">
                                {onlineUsers.includes(user._id) ? "Online" : "Offline"}
                            </div>
                        </div>
                    </button>
                ))}

                {filteredUsers.length === 0 && (
                    <div className="text-center text-zinc-500 py-4">No users found</div>
                )}
            </div>
        </aside>
    )
}

export default Sidebar