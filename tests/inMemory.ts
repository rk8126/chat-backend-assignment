import { randomUUID } from 'node:crypto';
import { directKey, type ChatRepository } from '../src/repositories/chatRepository.js';
import type { LastSeenResult, ListMessagesOptions, MessageStore } from '../src/repositories/messageStore.js';
import type { Chat, ChatMember, LastSeen, MemberRole, Message, User } from '../src/types.js';

export class InMemoryChatRepository implements ChatRepository {
  users = new Map<string, User>();
  chats = new Map<string, Omit<Chat, 'members'> & { directKey: string | null }>();
  members = new Map<string, ChatMember[]>();
  private tick = 0;
  private now = () => new Date(Date.UTC(2026, 0, 1) + this.tick++ * 1000);

  async createUser(name: string): Promise<User> {
    const user = { id: randomUUID(), name, createdAt: this.now() };
    this.users.set(user.id, user);
    return user;
  }

  async findMissingUsers(userIds: string[]): Promise<string[]> {
    return userIds.filter((id) => !this.users.has(id));
  }

  async findOrCreateDirectChat(a: string, b: string): Promise<{ chat: Chat; created: boolean }> {
    const key = directKey(a, b);
    const existing = [...this.chats.values()].find((c) => c.directKey === key);
    if (existing) return { chat: (await this.getChat(existing.id))!, created: false };
    const id = randomUUID();
    this.chats.set(id, { id, type: 'direct', name: null, createdBy: a, createdAt: this.now(), directKey: key });
    this.members.set(id, [
      { userId: a, role: 'member', joinedAt: this.now() },
      { userId: b, role: 'member', joinedAt: this.now() },
    ]);
    return { chat: (await this.getChat(id))!, created: true };
  }

  async createGroupChat(creatorId: string, name: string, memberIds: string[]): Promise<Chat> {
    const id = randomUUID();
    this.chats.set(id, { id, type: 'group', name, createdBy: creatorId, createdAt: this.now(), directKey: null });
    this.members.set(id, [
      { userId: creatorId, role: 'admin', joinedAt: this.now() },
      ...memberIds.map((userId): ChatMember => ({ userId, role: 'member', joinedAt: this.now() })),
    ]);
    return (await this.getChat(id))!;
  }

  async getChat(chatId: string): Promise<Chat | null> {
    const c = this.chats.get(chatId);
    if (!c) return null;
    const { directKey: _ignored, ...chat } = c;
    return { ...chat, members: [...(this.members.get(chatId) ?? [])] };
  }

  async getMemberRole(chatId: string, userId: string): Promise<MemberRole | null> {
    return this.members.get(chatId)?.find((m) => m.userId === userId)?.role ?? null;
  }

  async addMembers(chatId: string, userIds: string[]): Promise<void> {
    const list = this.members.get(chatId) ?? [];
    for (const userId of userIds) {
      if (!list.some((m) => m.userId === userId)) list.push({ userId, role: 'member', joinedAt: this.now() });
    }
    this.members.set(chatId, list);
  }

  async removeMember(chatId: string, userId: string): Promise<boolean> {
    const list = this.members.get(chatId) ?? [];
    const next = list.filter((m) => m.userId !== userId);
    this.members.set(chatId, next);
    return next.length !== list.length;
  }

  async listUserChats(userId: string): Promise<Chat[]> {
    const ids = [...this.members.entries()].filter(([, ms]) => ms.some((m) => m.userId === userId)).map(([id]) => id);
    const chats = await Promise.all(ids.map((id) => this.getChat(id)));
    return chats.filter((c): c is Chat => c !== null).sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
  }
}

export class InMemoryMessageStore implements MessageStore {
  messages = new Map<string, Message[]>();
  lastSeen = new Map<string, Map<string, LastSeen>>();
  private idCounter = 0;

  private list(chatId: string): Message[] {
    let l = this.messages.get(chatId);
    if (!l) this.messages.set(chatId, (l = []));
    return l;
  }

  private clone(m: Message): Message {
    return { ...m, readBy: { ...m.readBy } };
  }

  async sendMessage(chatId: string, senderId: string, text: string): Promise<Message> {
    const list = this.list(chatId);
    const message: Message = {
      id: `msg${String(++this.idCounter).padStart(4, '0')}`,
      chatId,
      senderId,
      text,
      seq: list.length + 1,
      createdAt: new Date(),
      editedAt: null,
      deletedAt: null,
      readBy: {},
    };
    list.push(message);
    return this.clone(message);
  }

  async listMessages(chatId: string, { limit, beforeSeq }: ListMessagesOptions): Promise<Message[]> {
    return this.list(chatId)
      .filter((m) => beforeSeq === undefined || m.seq < beforeSeq)
      .slice(-limit)
      .map((m) => this.clone(m));
  }

  async getMessage(chatId: string, messageId: string): Promise<Message | null> {
    const m = this.list(chatId).find((x) => x.id === messageId);
    return m ? this.clone(m) : null;
  }

  async markRead(chatId: string, messageId: string, userId: string): Promise<Message | null> {
    const m = this.list(chatId).find((x) => x.id === messageId);
    if (!m) return null;
    m.readBy[userId] ??= new Date();
    return this.clone(m);
  }

  async setLastSeen(chatId: string, userId: string, messageId: string): Promise<LastSeenResult | null> {
    const m = this.list(chatId).find((x) => x.id === messageId);
    if (!m) return null;
    let perChat = this.lastSeen.get(chatId);
    if (!perChat) this.lastSeen.set(chatId, (perChat = new Map()));
    const current = perChat.get(userId);
    if (current && current.seq >= m.seq) return { lastSeen: { ...current }, updated: false };
    const next = { userId, messageId, seq: m.seq, updatedAt: new Date() };
    perChat.set(userId, next);
    return { lastSeen: { ...next }, updated: true };
  }

  async listLastSeen(chatId: string): Promise<LastSeen[]> {
    return [...(this.lastSeen.get(chatId)?.values() ?? [])].map((l) => ({ ...l }));
  }

  async editMessage(chatId: string, messageId: string, text: string): Promise<Message | null> {
    const m = this.list(chatId).find((x) => x.id === messageId);
    if (!m) return null;
    m.text = text;
    m.editedAt = new Date();
    return this.clone(m);
  }

  async deleteMessage(chatId: string, messageId: string): Promise<Message | null> {
    const m = this.list(chatId).find((x) => x.id === messageId);
    if (!m) return null;
    m.text = '';
    m.deletedAt = new Date();
    return this.clone(m);
  }
}
