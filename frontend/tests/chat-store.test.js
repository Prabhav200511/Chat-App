import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "../src/store/useChatStore.js";

const { api, socket, toast } = vi.hoisted(() => ({
    api: { get: vi.fn(), post: vi.fn() },
    socket: { on: vi.fn(), off: vi.fn(), timeout: vi.fn(), emit: vi.fn() },
    toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("../src/lib/axios.js", () => ({ axiosInstance: api }));
vi.mock("../src/store/useAuthStore.js", () => ({
    useAuthStore: { getState: () => ({ socket }) },
}));
vi.mock("react-hot-toast", () => ({ toast }));

const chatA = { _id: "conversation-a" };
const chatB = { _id: "conversation-b" };
const message = (n, conversationId = chatA._id) => ({
    _id: n.toString(16).padStart(24, "0"),
    conversationId,
    text: `message-${n}`,
    createdAt: new Date(Date.UTC(2026, 0, 1) + n * 1000).toISOString(),
});
const page = (messages, conversationId = chatA._id) => ({
    data: { conversationId, messages, hasMore: false, nextCursor: null },
});
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};
const state = () => useChatStore.getState();
const listen = () => {
    state().subscribeToMessages();
    return socket.on.mock.calls.find(([event]) => event === "newMessage")[1];
};

beforeEach(() => {
    vi.clearAllMocks();
    socket.timeout.mockReturnValue(socket);
    socket.emit.mockImplementation((_event, _id, ack) => ack(null, { ok: true }));
    useChatStore.setState(useChatStore.getInitialState(), true);
    state().setSelectedUser(chatA);
});

describe("chat message concurrency", () => {
    it.each(["socket-first", "rest-first"])(
        "keeps incoming messages and deduplicates sent messages (%s)",
        async (order) => {
            useChatStore.setState({ messages: [message(1)] });
            const receive = listen();
            const response = deferred();
            api.post.mockReturnValueOnce(response.promise);
            const pending = state().sendMessage({ text: "hello" });
            receive(message(2));
            if (order === "socket-first") receive(message(3));
            response.resolve({ data: message(3) });
            await pending;
            if (order === "rest-first") receive(message(3));
            expect(state().messages).toEqual([message(1), message(2), message(3)]);
        }
    );

    it("preserves live messages while loading an older page and prevents parallel loads", async () => {
        const cursor = { before: message(30).createdAt, beforeId: message(30)._id };
        useChatStore.setState({ messages: [message(30)], hasMore: true, nextCursor: cursor });
        const receive = listen();
        const response = deferred();
        api.get.mockReturnValueOnce(response.promise);
        const pending = state().loadOlderMessages();
        await state().loadOlderMessages();
        expect(api.get).toHaveBeenCalledTimes(1);
        expect(api.get).toHaveBeenCalledWith(`app/messages/${chatA._id}`, {
            params: { limit: 30, ...cursor },
        });
        receive(message(31));
        response.resolve(page([message(29), message(30)]));
        await pending;
        expect(state().messages).toEqual([message(29), message(30), message(31)]);
        expect(state().isOlderMessagesLoading).toBe(false);
        expect(state().nextCursor).toBeNull();
    });

    it("merges messages arriving while the initial page is loading", async () => {
        const receive = listen();
        const response = deferred();
        api.get.mockReturnValueOnce(response.promise);
        const pending = state().getMessages(chatA._id);
        receive(message(2));
        response.resolve(page([message(1)]));
        await pending;
        expect(state().messages).toEqual([message(1), message(2)]);
    });

    it("uses the newest response for repeated loads of the same conversation", async () => {
        const older = deferred(), newer = deferred();
        api.get.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
        const first = state().getMessages(chatA._id);
        const second = state().getMessages(chatA._id);
        newer.resolve(page([message(2)]));
        await second;
        older.resolve(page([message(1)]));
        await first;
        expect(state().messages).toEqual([message(2)]);
        expect(socket.emit).toHaveBeenCalledTimes(1);
    });
});

describe("conversation switching", () => {
    it("ignores an old read without clearing the current conversation's loading flag", async () => {
        const responseA = deferred(), responseB = deferred();
        api.get.mockReturnValueOnce(responseA.promise).mockReturnValueOnce(responseB.promise);
        const pendingA = state().getMessages(chatA._id);
        state().setSelectedUser(chatB);
        const pendingB = state().getMessages(chatB._id);
        responseA.resolve(page([message(1)]));
        await pendingA;
        expect(state().messages).toEqual([]);
        expect(state().isMessagesLoading).toBe(true);
        expect(socket.emit).not.toHaveBeenCalled();
        responseB.resolve(page([message(2, chatB._id)], chatB._id));
        await pendingB;
        expect(state().messages).toEqual([message(2, chatB._id)]);
        expect(state().isMessagesLoading).toBe(false);
    });

    it("rejects a stale response after switching away and back to the same chat", async () => {
        const response = deferred();
        api.get.mockReturnValueOnce(response.promise);
        const pending = state().getMessages(chatA._id);
        state().setSelectedUser(chatB);
        state().setSelectedUser(chatA);
        response.resolve(page([message(1)]));
        await pending;
        expect(state().messages).toEqual([]);
        expect(socket.emit).not.toHaveBeenCalled();
    });

    it("does not append a completed send to another conversation", async () => {
        const response = deferred();
        api.post.mockReturnValueOnce(response.promise);
        const pending = state().sendMessage({ text: "hello" });
        state().setSelectedUser(chatB);
        response.resolve({ data: message(1) });
        await pending;
        expect(state().selectedUser).toEqual(chatB);
        expect(state().messages).toEqual([]);
    });

    it("does not prepend an older page to another conversation", async () => {
        useChatStore.setState({ messages: [message(30)], hasMore: true });
        const response = deferred();
        api.get.mockReturnValueOnce(response.promise);
        const pending = state().loadOlderMessages();
        state().setSelectedUser(chatB);
        response.resolve(page([message(1)]));
        await pending;
        expect(state().messages).toEqual([]);
        expect(state().isOlderMessagesLoading).toBe(false);
    });

    it("does not show smart replies from a previously selected conversation", async () => {
        const response = deferred();
        api.get.mockReturnValueOnce(response.promise);
        const pending = state().getSmartReplies(chatA._id);
        state().setSelectedUser(chatB);
        response.resolve({ data: ["Reply to A"] });
        await pending;
        expect(state().smartReplies).toEqual([]);
    });

    it("clears the previous conversation's messages, cursor and replies immediately", () => {
        useChatStore.setState({
            messages: [message(1)], hasMore: true,
            nextCursor: { before: message(1).createdAt, beforeId: message(1)._id },
            smartReplies: ["Reply to A"],
        });
        state().setSelectedUser(chatB);
        expect(state()).toMatchObject({
            selectedUser: chatB, messages: [], hasMore: false, nextCursor: null, smartReplies: [],
        });
    });
});
