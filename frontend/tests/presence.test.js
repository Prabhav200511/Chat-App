import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../src/store/useAuthStore.js";
import { useChatStore } from "../src/store/useChatStore.js";

/**
 * Delta presence reducer tests (Phase 2 WS4).
 *
 * The store's socket is mocked exactly like chat-store.test.js mocks it:
 * a fake instance whose registered handlers we capture from on.mock.calls and
 * invoke directly.
 */
const { api, socket, ioMock, toast } = vi.hoisted(() => {
    const socket = {
        connected: false,
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        removeAllListeners: vi.fn(),
    };
    const ioMock = vi.fn(() => socket);
    return {
        api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
        socket,
        ioMock,
        toast: { error: vi.fn(), success: vi.fn() },
    };
});

vi.mock("socket.io-client", () => ({ io: ioMock }));
vi.mock("../src/lib/axios.js", () => ({ axiosInstance: api }));
vi.mock("react-hot-toast", () => ({ default: toast, toast }));

const handler = (event) =>
    socket.on.mock.calls.find(([name]) => name === event)?.[1];

const state = () => useAuthStore.getState();

const connectAs = (id = "me") => {
    useAuthStore.setState({ authUser: { _id: id }, socket: null, onlineUsers: [] });
    state().connectSocket();
};

beforeEach(() => {
    state().disconnectSocket();
    vi.clearAllMocks();
    socket.on.mockClear();
    socket.connect.mockImplementation(() => {});
    useAuthStore.setState(useAuthStore.getInitialState(), true);
});

describe("delta presence", () => {
    it("replaces state with the snapshot (never merges)", () => {
        connectAs();
        handler("presence:snapshot")(["u1", "u2"]);
        expect(state().onlineUsers).toEqual(["u1", "u2"]);

        // A later snapshot is authoritative — replaced, not unioned.
        handler("presence:snapshot")(["u3"]);
        expect(state().onlineUsers).toEqual(["u3"]);
    });

    it("dedupes a snapshot containing repeated ids", () => {
        connectAs();
        handler("presence:snapshot")(["u1", "u1", "u2", "u2"]);
        expect(state().onlineUsers).toEqual(["u1", "u2"]);
    });

    it("makes a duplicate presence:join idempotent", () => {
        connectAs();
        handler("presence:snapshot")([]);
        const join = handler("presence:join");

        join({ userId: "u1" });
        join({ userId: "u1" });
        join({ userId: "u2" });
        join({ userId: "u1" });

        expect(state().onlineUsers).toEqual(["u1", "u2"]);
    });

    it("removes the user on presence:leave", () => {
        connectAs();
        handler("presence:snapshot")(["u1", "u2", "u3"]);
        handler("presence:leave")({ userId: "u2" });
        expect(state().onlineUsers).toEqual(["u1", "u3"]);
    });

    it("treats a leave for an unknown user as a no-op", () => {
        connectAs();
        handler("presence:snapshot")(["u1"]);
        const before = state();
        handler("presence:leave")({ userId: "never-seen" });
        expect(state().onlineUsers).toEqual(["u1"]);
        expect(state()).toBe(before);
    });

    it("clears onlineUsers and fully tears down the socket on logout", async () => {
        connectAs();
        handler("presence:snapshot")(["u1", "u2"]);
        expect(state().onlineUsers).toEqual(["u1", "u2"]);

        api.post.mockResolvedValue({ data: {} });
        await state().logout();

        expect(state().onlineUsers).toEqual([]);
        expect(state().socket).toBeNull();
        expect(socket.off).toHaveBeenCalledWith("presence:snapshot", expect.any(Function));
        expect(socket.removeAllListeners).not.toHaveBeenCalled();
        expect(socket.disconnect).toHaveBeenCalled();
    });

    it("does not spawn a second socket when the existing one is disconnected", () => {
        connectAs();
        socket.connected = false; // e.g. a dropped connection awaiting reconnect
        state().connectSocket();
        expect(ioMock).toHaveBeenCalledTimes(1);
    });

    it("installs listeners before connecting, including immediate snapshot/readiness events", () => {
        socket.connect.mockImplementationOnce(() => {
            handler("presence:snapshot")(["me"]);
            handler("realtime:ready")({ roomsReady: true });
        });
        connectAs();
        expect(ioMock).toHaveBeenCalledWith(expect.any(String), { withCredentials: true, autoConnect: false });
        expect(state().onlineUsers).toEqual(["me"]);
        expect(state().realtimeReady).toBe(true);
        expect(state().realtimeEpoch).toBe(1);
    });

    it.each(["disconnect", "connect_error"])("clears stale presence and readiness on %s", (event) => {
        connectAs();
        handler("presence:snapshot")(["u1"]);
        handler("realtime:ready")({ roomsReady: true });
        handler(event)();
        expect(state()).toMatchObject({ onlineUsers: [], realtimeReady: false, roomsReady: false });
        handler("presence:snapshot")(["u2"]);
        handler("realtime:ready")({ roomsReady: true });
        expect(state().onlineUsers).toEqual(["u2"]);
        expect(state().realtimeEpoch).toBe(2);
    });

    it("warns about failed room initialization without claiming healthy delivery", () => {
        connectAs();
        handler("realtime:ready")({ roomsReady: false });
        expect(state()).toMatchObject({ realtimeReady: true, roomsReady: false });
        expect(toast.error).toHaveBeenCalled();
    });

    it("ignores callbacks from a retired socket, including login as the same user", () => {
        connectAs();
        const oldSnapshot = handler("presence:snapshot");
        const oldReady = handler("realtime:ready");
        state().disconnectSocket();
        state().connectSocket();
        oldSnapshot(["stale"]);
        oldReady({ roomsReady: true });
        expect(state().onlineUsers).toEqual([]);
        expect(state().realtimeReady).toBe(false);
    });

    it("ignores an auth check that completes after logout", async () => {
        connectAs();
        let finish;
        api.get.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
        const pending = state().checkAuth();
        api.post.mockResolvedValueOnce({ data: {} });
        await state().logout();
        finish({ data: { _id: "me" } });
        await pending;
        expect(state().authUser).toBeNull();
        expect(state().socket).toBeNull();
    });

    it("clears chat data and rejects an in-flight sidebar response after logout", async () => {
        connectAs();
        useChatStore.getState().setSelectedUser({ _id: "old-conversation" });
        useChatStore.setState({ users: [{ _id: "old-conversation" }], messages: [{ _id: "old-message" }] });
        let finish;
        api.get.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
        const pending = useChatStore.getState().getUsers();
        api.post.mockResolvedValueOnce({ data: {} });
        await state().logout();
        finish({ data: [{ _id: "stale-conversation" }] });
        await pending;
        expect(useChatStore.getState()).toMatchObject({ users: [], messages: [], selectedUser: null });
    });
});
