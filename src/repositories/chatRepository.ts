import { Prisma, type PrismaClient } from '../generated/prisma/client';
import type { Chat, MemberRole, User } from '../types';

export interface ChatRepository {
  createUser(name: string): Promise<User>;
  findMissingUsers(userIds: string[]): Promise<string[]>;
  findOrCreateDirectChat(userAId: string, userBId: string): Promise<{ chat: Chat; created: boolean }>;
  createGroupChat(creatorId: string, name: string, memberIds: string[]): Promise<Chat>;
  getChat(chatId: string): Promise<Chat | null>;
  getMemberRole(chatId: string, userId: string): Promise<MemberRole | null>;
  addMembers(chatId: string, userIds: string[]): Promise<void>;
  removeMember(chatId: string, userId: string): Promise<boolean>;
  listUserChats(userId: string): Promise<Chat[]>;
}

export const directKey = (a: string, b: string): string => [a, b].sort().join(':');

const withMembers = {
  members: { orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }] },
} satisfies Prisma.ChatInclude;

type ChatWithMembers = Prisma.ChatGetPayload<{ include: typeof withMembers }>;

const toChat = (c: ChatWithMembers): Chat => ({
  id: c.id,
  type: c.type,
  name: c.name,
  createdBy: c.createdBy,
  createdAt: c.createdAt,
  members: c.members.map((m) => ({ userId: m.userId, role: m.role, joinedAt: m.joinedAt })),
});

const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

export class PrismaChatRepository implements ChatRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createUser(name: string): Promise<User> {
    const user = await this.prisma.user.create({ data: { name } });
    return { id: user.id, name: user.name, createdAt: user.createdAt };
  }

  async findMissingUsers(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true } });
    const found = new Set(rows.map((r) => r.id));
    return userIds.filter((id) => !found.has(id));
  }

  async findOrCreateDirectChat(userAId: string, userBId: string): Promise<{ chat: Chat; created: boolean }> {
    const key = directKey(userAId, userBId);
    const existing = await this.findDirectChat(key);
    if (existing) return { chat: existing, created: false };

    try {
      const chat = await this.prisma.chat.create({
        data: {
          type: 'direct',
          directKey: key,
          createdBy: userAId,
          members: { create: [{ userId: userAId }, { userId: userBId }] },
        },
        include: withMembers,
      });
      return { chat: toChat(chat), created: true };
    } catch (err) {
      // another request created the same chat first
      if (!isUniqueViolation(err)) throw err;
      const winner = await this.findDirectChat(key);
      if (!winner) throw err;
      return { chat: winner, created: false };
    }
  }

  async createGroupChat(creatorId: string, name: string, memberIds: string[]): Promise<Chat> {
    const others = [...new Set(memberIds)].filter((id) => id !== creatorId);
    const chat = await this.prisma.chat.create({
      data: {
        type: 'group',
        name,
        createdBy: creatorId,
        members: {
          create: [
            { userId: creatorId, role: 'admin' },
            ...others.map((userId) => ({ userId, role: 'member' as const })),
          ],
        },
      },
      include: withMembers,
    });
    return toChat(chat);
  }

  async getChat(chatId: string): Promise<Chat | null> {
    const chat = await this.prisma.chat.findUnique({ where: { id: chatId }, include: withMembers });
    return chat ? toChat(chat) : null;
  }

  async getMemberRole(chatId: string, userId: string): Promise<MemberRole | null> {
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
      select: { role: true },
    });
    return member?.role ?? null;
  }

  async addMembers(chatId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    await this.prisma.chatMember.createMany({
      data: userIds.map((userId) => ({ chatId, userId })),
      skipDuplicates: true,
    });
  }

  async removeMember(chatId: string, userId: string): Promise<boolean> {
    const { count } = await this.prisma.chatMember.deleteMany({ where: { chatId, userId } });
    return count > 0;
  }

  async listUserChats(userId: string): Promise<Chat[]> {
    const chats = await this.prisma.chat.findMany({
      where: { members: { some: { userId } } },
      include: withMembers,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    return chats.map(toChat);
  }

  private async findDirectChat(key: string): Promise<Chat | null> {
    const chat = await this.prisma.chat.findUnique({ where: { directKey: key }, include: withMembers });
    return chat ? toChat(chat) : null;
  }
}
