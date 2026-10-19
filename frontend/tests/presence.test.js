import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../src/store/useAuthStore.js";

/**
 * Delta presence reducer tests (Phase 2 WS4).
 *
 * The store's socket is mocked exactly like chat-store.test.js mocks it:
 * a fake instance whose registered handlers we capture from on.mock.calls and
 * invoke directly.
 */
const { api, socket, socketFactory, ioMock, toast } = vi.hoisted(() => {
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
        socketFactory: ioMock,
        ioMock,
        toast: { error: vi.fn(), success: vi.fn() },
    };
});

vi.mock("socket.io-client", () => ({ io: ioMock }));
vi.mock("../src/lib/axios.js", () => ({ axiosInstance: api }));
vi.mock("react-hot-toast", () => ({ default: toast, ...toast }));

const handler = (event) =>
    socket.on.mock.calls.find(([name]) => name === event)?.[1];

const state = () => useAuthStore.getState();

const connectAs = (id = "me") => {
    useAuthStore.setState({ authUser: { _id: id }, socket: null, onlineUsers: [] });
    state().connectSocket();
};

beforeEach(() => {
    vi.clearAllMocks();
    socket.on.mockClear();
    useAuthStore.setState({
        authUser: null,
        socket: null,
        onlineUsers: [],
    });
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
        handler("presence:leave")({ userId: "never-seen" });
        expect(state().onlineUsers).toEqual(["u1"]);
    });

    it("clears onlineUsers and fully tears down the socket on logout", async () => {
        connectAs();
        handler("presence:snapshot")(["u1", "u2"]);
        expect(state().onlineUsers).toEqual(["u1", "u2"]);

        api.post.mockResolvedValue({ data: {} });
        await state().logout();

        expect(state().onlineUsers).toEqual([]);
        expect(state().socket).toBeNull();
        expect(socket.removeAllListeners).toHaveBeenCalled();
        expect(socket.disconnect).toHaveBeenCalled();
    });

    it("does not spawn a second socket when the existing one is disconnected", () => {
        connectAs();
        socket.connected = false; // e.g. a dropped connection awaiting reconnect
        state().connectSocket();
        expect(ioMock).toHaveBeenCalledTimes(1);
    });
});
