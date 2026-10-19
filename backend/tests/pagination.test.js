import { describe, it, expect, beforeAll, vi } from "vitest";
import Message from "../src/models/message.model.js";
import {
    signup,
    createConversation,
    getMessages,
} from "./helpers.js";

vi.mock("@google/generative-ai", () => ({
    GoogleGenerativeAI: class {
        getGenerativeModel() {
            return {
                generateContent: async () => ({
                    response: { text: () => '["ok", "ok", "ok"]' },
                }),
            };
        }
    },
}));

const TOTAL = 120;
const BASE_TIME = Date.parse("2026-01-01T00:00:00.000Z");

describe("message pagination", () => {
    let alice, bob, convAB;

    beforeAll(async () => {
        alice = await signup("Alice");
        bob = await signup("Bob");
        convAB = await createConversation(alice, bob.email);

        const docs = [];
        for (let i = 0; i < TOTAL; i++) {
            docs.push({
                conversationId: convAB._id,
                senderId: i % 2 === 0 ? alice.user._id : bob.user._id,
                text: `msg-${i}`,
            });
        }
        const inserted = await Message.insertMany(docs);

        // Deterministic, 1s-apart timestamps so cursor boundaries are exact.
        await Message.collection.bulkWrite(
            inserted.map((m, i) => ({
                updateOne: {
                    filter: { _id: m._id },
                    update: {
                        $set: { createdAt: new Date(BASE_TIME + i * 1000) },
                    },
                },
            }))
        );

    });

    it("returns only the first page by default", async () => {
        const res = await getMessages(alice, convAB._id);
        expect(res.status).toBe(200);
        expect(res.body.messages).toHaveLength(30);
        expect(res.body.hasMore).toBe(true);
    });

    it("honors ?limit= and keeps ascending order", async () => {
        const res = await getMessages(alice, convAB._id, { limit: 10 });
        expect(res.body.messages).toHaveLength(10);
        expect(res.body.hasMore).toBe(true);

        const times = res.body.messages.map((m) =>
            Date.parse(m.createdAt)
        );
        for (let i = 1; i < times.length; i++) {
            expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
        }
    });

    it("rejects an out-of-range limit", async () => {
        const res = await getMessages(alice, convAB._id, { limit: 200 });
        expect(res.status).toBe(400);
    });

    it("rejects a malformed before cursor", async () => {
        const res = await getMessages(alice, convAB._id, {
            before: "yesterday-ish",
        });
        expect(res.status).toBe(400);
    });

    it("pages backwards through the whole history without gaps or dupes", async () => {
        const seen = [];
        let cursor;
        let guard = 0;

        for (;;) {
            const query = { limit: 30, ...cursor };

            const res = await getMessages(alice, convAB._id, query);
            expect(res.status).toBe(200);

            seen.push(...res.body.messages);
            if (!res.body.hasMore) break;

            cursor = res.body.nextCursor;
            expect(cursor).toEqual({
                before: res.body.messages[0].createdAt,
                beforeId: res.body.messages[0]._id,
            });
            if (++guard > 20) throw new Error("pagination did not terminate");
        }

        expect(seen).toHaveLength(TOTAL);
        const ids = new Set(seen.map((m) => m._id));
        expect(ids.size).toBe(TOTAL);

        // Pages walk backwards (newest first, ascending within each page), so
        // re-sort by server-side createdAt: the full sweep must cover exactly
        // msg-0 (oldest) through msg-119 (newest) with no gaps or dupes.
        const ordered = [...seen].sort(
            (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
        );
        expect(ordered[0].text).toBe("msg-0");
        expect(ordered[ordered.length - 1].text).toBe(`msg-${TOTAL - 1}`);
    });

    it("retains timestamp-only cursors for existing API clients", async () => {
        const res = await getMessages(alice, convAB._id, {
            before: new Date(BASE_TIME + 10 * 1000).toISOString(),
        });
        expect(res.status).toBe(200);
        expect(res.body.messages).toHaveLength(10);
        expect(res.body.nextCursor).toBeNull();
    });

    it.each([
        { beforeId: "not-an-id", before: new Date(BASE_TIME).toISOString() },
        { beforeId: "0123456789abcdef01234567" },
    ])("rejects an invalid composite cursor: %j", async (query) => {
        expect((await getMessages(alice, convAB._id, query)).status).toBe(400);
    });

    it("pages through timestamp ties without skipping or repeating messages", async () => {
        const carol = await signup("Pagination Carol");
        const tied = await createConversation(alice, carol.email);
        const docs = Array.from({ length: 73 }, (_, i) => ({
            conversationId: tied._id,
            senderId: alice.user._id,
            text: `tied-${i}`,
            // A 65-message tie spans multiple page boundaries, with rows on each side.
            createdAt: new Date(BASE_TIME + (i < 5 ? -1000 : i >= 70 ? 1000 : 0)),
        }));
        await Message.insertMany(docs);

        let cursor;
        const seen = [];
        for (let page = 0; page < 4; page++) {
            const res = await getMessages(alice, tied._id, { limit: 30, ...cursor });
            expect(res.status).toBe(200);
            seen.push(...res.body.messages);
            if (!res.body.hasMore) {
                expect(res.body.nextCursor).toBeNull();
                break;
            }
            cursor = res.body.nextCursor;
            expect(cursor).toBeTruthy();
        }
        expect(seen).toHaveLength(docs.length);
        expect(new Set(seen.map((m) => m._id)).size).toBe(docs.length);
        const chronological = [...seen].sort((a, b) =>
            Date.parse(a.createdAt) - Date.parse(b.createdAt) || a._id.localeCompare(b._id)
        );
        const expected = await Message.find({ conversationId: tied._id })
            .sort({ createdAt: 1, _id: 1 }).lean();
        expect(chronological.map((m) => m._id)).toEqual(expected.map((m) => String(m._id)));
    });
});
