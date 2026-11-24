import { randomUUID } from 'node:crypto';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FirestoreMessageStore } from '../src/repositories/messageStore';

const emulator = process.env.FIRESTORE_EMULATOR_HOST;

describe.skipIf(!emulator)('FirestoreMessageStore (emulator)', () => {
  let db: Firestore;
  let store: FirestoreMessageStore;

  beforeAll(() => {
    if (getApps().length === 0) initializeApp({ projectId: 'demo-chat-backend' });
    db = getFirestore();
    store = new FirestoreMessageStore(db);
  });

  afterAll(async () => {
    await db?.terminate();
  });

  it('assigns unique, gap-free seq numbers under concurrent sends', async () => {
    const chatId = randomUUID();
    const sent = await Promise.all(Array.from({ length: 15 }, (_, i) => store.sendMessage(chatId, 'u1', `m${i}`)));
    expect(sent.map((m) => m.seq).sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(sent[0]!.createdAt).toBeInstanceOf(Date);

    const page = await store.listMessages(chatId, { limit: 5 });
    expect(page.map((m) => m.seq)).toEqual([11, 12, 13, 14, 15]);
    const older = await store.listMessages(chatId, { limit: 5, beforeSeq: 11 });
    expect(older.map((m) => m.seq)).toEqual([6, 7, 8, 9, 10]);
  }, 30_000);

  it('read receipts keep the first read time; uuid user ids work as map keys', async () => {
    const chatId = randomUUID();
    const reader = randomUUID();
    const m = await store.sendMessage(chatId, 'sender', 'hi');
    const first = await store.markRead(chatId, m.id, reader);
    const again = await store.markRead(chatId, m.id, reader);
    expect(first!.readBy[reader]).toBeInstanceOf(Date);
    expect(again!.readBy[reader]!.getTime()).toBe(first!.readBy[reader]!.getTime());
    expect(await store.markRead(chatId, 'missing', reader)).toBeNull();
  });

  it('last seen only moves forward', async () => {
    const chatId = randomUUID();
    const m1 = await store.sendMessage(chatId, 'a', 'one');
    const m2 = await store.sendMessage(chatId, 'a', 'two');
    expect(await store.setLastSeen(chatId, 'b', m2.id)).toMatchObject({ updated: true, lastSeen: { seq: 2 } });
    expect(await store.setLastSeen(chatId, 'b', m1.id)).toMatchObject({ updated: false, lastSeen: { messageId: m2.id } });
    expect(await store.setLastSeen(chatId, 'b', 'missing')).toBeNull();
    expect(await store.listLastSeen(chatId)).toHaveLength(1);
  });

  it('edit and soft delete', async () => {
    const chatId = randomUUID();
    const m = await store.sendMessage(chatId, 'a', 'helo');
    const edited = await store.editMessage(chatId, m.id, 'hello');
    expect(edited).toMatchObject({ text: 'hello', seq: 1 });
    expect(edited!.editedAt).toBeInstanceOf(Date);
    const deleted = await store.deleteMessage(chatId, m.id);
    expect(deleted).toMatchObject({ text: '' });
    expect(deleted!.deletedAt).toBeInstanceOf(Date);
    expect(await store.editMessage(chatId, 'missing', 'x')).toBeNull();
  });
});
