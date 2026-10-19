import React, { useEffect } from 'react'
import { useChatStore } from '../store/useChatStore'
import ChatHeader from './ChatHeader';
import MessageInput from './MessageInput';
import MessageSkeleton from './skeletons/MessageSkeleton';
import { useAuthStore } from '../store/useAuthStore';
import {formatMessageTime} from "../lib/utils.js"
import { useRef } from 'react';

const ChatContainer = () => {

    const {messages,getMessages,isMessagesLoading,selectedUser,subscribeToMessages,unsubscribeFromMessages,getSmartReplies,hasMore,loadOlderMessages,isOlderMessagesLoading} = useChatStore();
    const {authUser} = useAuthStore();
    const messageEndRef = useRef(null);

    useEffect(() => {
        getMessages(selectedUser._id);
        getSmartReplies(selectedUser._id);
        subscribeToMessages();

        return () => unsubscribeFromMessages();
    },[selectedUser._id,getMessages,subscribeToMessages,unsubscribeFromMessages]);

    // Scroll to the newest message when the tail changes — not when older
    // messages are prepended, which would yank the viewport down.
    const lastMessageId = messages?.[messages.length - 1]?._id;
    useEffect(() => {
      if(lastMessageId && messageEndRef.current){
        messageEndRef.current.scrollIntoView({behavior: "smooth"});
      }
    },[lastMessageId]);

    if(isMessagesLoading){
         return (
            <div className="flex-1 flex flex-col overflow-auto">
                <ChatHeader />
                <MessageSkeleton />
                <MessageInput />
            </div>
        );
    }
  return (
    <div className="flex-1 flex flex-col overflow-auto">
      <ChatHeader />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {hasMore && (
          <div className="flex justify-center">
            <button
              className="btn btn-xs btn-ghost"
              onClick={loadOlderMessages}
              disabled={isOlderMessagesLoading}
            >
              {isOlderMessagesLoading ? "Loading..." : "Load earlier messages"}
            </button>
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message._id}
            className={`chat ${message.senderId === authUser._id ? "chat-end" : "chat-start"}`}
          >
            <div className=" chat-image avatar">
              <div className="size-10 rounded-full border">
                <img
                  src={
                    message.senderId === authUser._id
                      ? authUser.profilePic || "/avatar.png"
                      : selectedUser.profilePic || "/avatar.png"
                  }
                  alt="profile pic"
                />
              </div>
            </div>
            <div className="chat-header mb-1">
              <time className="text-xs opacity-50 ml-1">
                {formatMessageTime(message.createdAt)}
              </time>
            </div>
            <div className="chat-bubble flex flex-col">
              {message.image && (
                <img
                  src={message.image}
                  alt="Attachment"
                  className="sm:max-w-[200px] rounded-md mb-2"
                />
              )}
              {message.text && <p>{message.text}</p>}
            </div>
          </div>
        ))}
        {/* Scroll sentinel: only the LAST ref assignment wins in the map above,
            so an explicit node keeps the anchor unambiguous. */}
        <div ref={messageEndRef} />
      </div>

      <MessageInput />
    </div>
  )
}

export default ChatContainer
