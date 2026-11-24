import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { InMemoryChatRepository, InMemoryMessageStore } from './inMemory.js';

let app: Express;

beforeEach(() => {
  app = createApp({ chatRepository: new InMemoryChatRepository(), messageStore: new InMemoryMessageStore() });
});

async function user(name: string): Promise<string> {
  const res = await request(app).post('/users').send({ name }).expect(201);
  return res.body.user.id as string;
}

async function directChat(a: string, b: string): Promise<string> {
  const res = await request(app).post('/chat/create').send({ userAId: a, userBId: b });
  return res.body.chatId as string;
}

async function send(chatId: string, senderId: string, text: string): Promise<{ id: string; seq: number }> {
  const res = await request(app).post(`/chat/${chatId}/message/send`).send({ senderId, text }).expect(201);
  return res.body.message;
}

describe('POST /chat/create', () => {
  it('creates a chat once and returns the same chatId for either user order', async () => {
    const [a, b] = [await user('A'), await user('B')];
    const first = await request(app).post('/chat/create').send({ userAId: a, userBId: b }).expect(201);
    expect(first.body).toMatchObject({ created: true });
    const again = await request(app).post('/chat/create').send({ userAId: b, userBId: a }).expect(200);
    expect(again.body).toEqual({ chatId: first.body.chatId, created: false });
  });

  it('rejects chatting with yourself, unknown users and bad ids', async () => {
    const a = await user('A');
    await request(app).post('/chat/create').send({ userAId: a, userBId: a }).expect(400);
    const missing = randomUUID();
    const res = await request(app).post('/chat/create').send({ userAId: a, userBId: missing }).expect(404);
    expect(res.body.error.details.userIds).toEqual([missing]);
    const bad = await request(app).post('/chat/create').send({ userAId: 'x', userBId: a }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('messages', () => {
  it('sends, then lists oldest → newest with a seq cursor for older pages', async () => {
    const [a, b] = [await user('A'), await user('B')];
    const chatId = await directChat(a, b);
    for (let i = 1; i <= 5; i++) await send(chatId, i % 2 ? a : b, `m${i}`);

    const page = await request(app).get(`/chat/${chatId}/messages?limit=2`).expect(200);
    expect(page.body.messages.map((m: { text: string }) => m.text)).toEqual(['m4', 'm5']);
    expect(page.body.nextBefore).toBe(4);

    const older = await request(app).get(`/chat/${chatId}/messages?limit=2&before=4`).expect(200);
    expect(older.body.messages.map((m: { text: string }) => m.text)).toEqual(['m2', 'm3']);

    const all = await request(app).get(`/chat/${chatId}/messages`).expect(200);
    expect(all.body.messages.map((m: { seq: number }) => m.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(all.body.nextBefore).toBeNull();
  });

  it('only lets members send, trims text and rejects empty text', async () => {
    const [a, b, c] = [await user('A'), await user('B'), await user('C')];
    const chatId = await directChat(a, b);
    await request(app).post(`/chat/${chatId}/message/send`).send({ senderId: c, text: 'hi' }).expect(403);
    await request(app).post(`/chat/${chatId}/message/send`).send({ senderId: a, text: '   ' }).expect(400);
    const m = await request(app).post(`/chat/${chatId}/message/send`).send({ senderId: a, text: '  hi  ' }).expect(201);
    expect(m.body.message.text).toBe('hi');
    await request(app).post(`/chat/${randomUUID()}/message/send`).send({ senderId: a, text: 'x' }).expect(404);
  });

  it('enforces membership on GET when userId is passed', async () => {
    const [a, b, c] = [await user('A'), await user('B'), await user('C')];
    const chatId = await directChat(a, b);
    await request(app).get(`/chat/${chatId}/messages?userId=${c}`).expect(403);
    await request(app).get(`/chat/${chatId}/messages?userId=${a}`).expect(200);
    await request(app).get(`/chat/${chatId}/messages?limit=500`).expect(400);
  });
});

describe('read receipts & last seen', () => {
  it('marks read idempotently and keeps the first read time', async () => {
    const [a, b] = [await user('A'), await user('B')];
    const chatId = await directChat(a, b);
    const m = await send(chatId, a, 'hello');

    const first = await request(app).post(`/chat/${chatId}/message/${m.id}/read`).send({ userId: b }).expect(200);
    expect(Object.keys(first.body.readBy)).toEqual([b]);
    const second = await request(app).post(`/chat/${chatId}/message/${m.id}/read`).send({ userId: b }).expect(200);
    expect(second.body.readBy[b]).toBe(first.body.readBy[b]);

    const own = await request(app).post(`/chat/${chatId}/message/${m.id}/read`).send({ userId: a }).expect(200);
    expect(own.body.readBy[a]).toBeUndefined();

    await request(app).post(`/chat/${chatId}/message/nope/read`).send({ userId: b }).expect(404);
  });

  it('moves last seen forward only', async () => {
    const [a, b] = [await user('A'), await user('B')];
    const chatId = await directChat(a, b);
    const m1 = await send(chatId, a, 'one');
    const m2 = await send(chatId, a, 'two');

    const r2 = await request(app).post(`/chat/${chatId}/lastseen`).send({ userId: b, messageId: m2.id }).expect(200);
    expect(r2.body).toMatchObject({ updated: true, lastSeen: { userId: b, messageId: m2.id, seq: 2 } });

    const r1 = await request(app).post(`/chat/${chatId}/lastseen`).send({ userId: b, messageId: m1.id }).expect(200);
    expect(r1.body).toMatchObject({ updated: false, lastSeen: { messageId: m2.id } });

    const list = await request(app).get(`/chat/${chatId}/lastseen`).expect(200);
    expect(list.body.lastSeen).toHaveLength(1);

    await request(app).post(`/chat/${chatId}/lastseen`).send({ userId: b, messageId: 'missing' }).expect(404);
  });
});

describe('GET /user/:userId/chats', () => {
  it('lists the chats a user belongs to with member ids', async () => {
    const [a, b, c] = [await user('A'), await user('B'), await user('C')];
    const ab = await directChat(a, b);
    const ac = await directChat(a, c);
    await directChat(b, c);

    const res = await request(app).get(`/user/${a}/chats`).expect(200);
    expect(res.body.chats.map((ch: { id: string }) => ch.id).sort()).toEqual([ab, ac].sort());
    const abChat = res.body.chats.find((ch: { id: string }) => ch.id === ab);
    expect(abChat.memberIds.sort()).toEqual([a, b].sort());

    await request(app).get(`/user/${randomUUID()}/chats`).expect(404);
  });
});

describe('bonus: group chats', () => {
  it('creates a group, lets admins add/remove members, members leave, last admin stays', async () => {
    const [admin, b, c, d] = [await user('Admin'), await user('B'), await user('C'), await user('D')];
    const created = await request(app)
      .post('/chat/group/create')
      .send({ creatorId: admin, name: 'Team', memberIds: [b, c, b] })
      .expect(201);
    const chatId = created.body.chatId as string;
    expect(created.body.chat.members).toHaveLength(3);

    await request(app).post(`/chat/${chatId}/members`).send({ actorId: b, userIds: [d] }).expect(403);
    const added = await request(app).post(`/chat/${chatId}/members`).send({ actorId: admin, userIds: [d] }).expect(200);
    expect(added.body.chat.members).toHaveLength(4);

    await request(app).delete(`/chat/${chatId}/members/${c}`).send({ actorId: b }).expect(403);
    await request(app).delete(`/chat/${chatId}/members/${b}`).send({ actorId: b }).expect(200);
    await request(app).delete(`/chat/${chatId}/members/${c}`).send({ actorId: admin }).expect(200);
    await request(app).delete(`/chat/${chatId}/members/${admin}`).send({ actorId: admin }).expect(409);

    await send(chatId, d, 'hi team');
    await request(app).post(`/chat/${chatId}/message/send`).send({ senderId: b, text: 'x' }).expect(403);
  });

  it('refuses member management on 1:1 chats and groups without other members', async () => {
    const [a, b] = [await user('A'), await user('B')];
    const chatId = await directChat(a, b);
    await request(app).post(`/chat/${chatId}/members`).send({ actorId: a, userIds: [b] }).expect(400);
    await request(app).post('/chat/group/create').send({ creatorId: a, name: 'Solo', memberIds: [a] }).expect(400);
  });
});

describe('bonus: edit & delete', () => {
  it('lets only the sender edit or delete; deleted messages cannot be edited', async () => {
    const [a, b] = [await user('A'), await user('B')];
    const chatId = await directChat(a, b);
    const m = await send(chatId, a, 'helo');

    await request(app).patch(`/chat/${chatId}/message/${m.id}`).send({ userId: b, text: 'x' }).expect(403);
    const edited = await request(app).patch(`/chat/${chatId}/message/${m.id}`).send({ userId: a, text: 'hello' }).expect(200);
    expect(edited.body.message).toMatchObject({ text: 'hello', seq: 1 });
    expect(edited.body.message.editedAt).not.toBeNull();

    const deleted = await request(app).delete(`/chat/${chatId}/message/${m.id}`).send({ userId: a }).expect(200);
    expect(deleted.body.message).toMatchObject({ text: '' });
    expect(deleted.body.message.deletedAt).not.toBeNull();

    await request(app).patch(`/chat/${chatId}/message/${m.id}`).send({ userId: a, text: 'again' }).expect(409);
  });
});

describe('errors', () => {
  it('returns JSON errors for bad JSON and unknown routes', async () => {
    const bad = await request(app).post('/chat/create').set('content-type', 'application/json').send('{bad').expect(400);
    expect(bad.body.error.code).toBe('INVALID_JSON');
    await request(app).get('/nope').expect(404);
  });
});
