import { badRequest, conflict, forbidden, notFound } from '../errors';
import type { ChatRepository } from '../repositories/chatRepository';
import type { LastSeenResult, MessageStore } from '../repositories/messageStore';
import type { Chat, LastSeen, MemberRole, Message, User } from '../types';

export class ChatService {
  constructor(
    private readonly chats: ChatRepository,
    private readonly messages: MessageStore,
  ) {}

  createUser(name: string): Promise<User> {
    return this.chats.createUser(name);
  }

  async listUserChats(userId: string): Promise<Chat[]> {
    await this.assertUsersExist([userId]);
    return this.chats.listUserChats(userId);
  }

  getChatDetails(chatId: string): Promise<Chat> {
    return this.getChat(chatId);
  }

  async createOrGetDirectChat(userAId: string, userBId: string): Promise<{ chat: Chat; created: boolean }> {
    if (userAId === userBId) throw badRequest('userAId and userBId must be different users');
    await this.assertUsersExist([userAId, userBId]);
    return this.chats.findOrCreateDirectChat(userAId, userBId);
  }

  async createGroupChat(creatorId: string, name: string, memberIds: string[]): Promise<Chat> {
    const others = [...new Set(memberIds)].filter((id) => id !== creatorId);
    if (others.length === 0) throw badRequest('A group needs at least one member besides the creator');
    await this.assertUsersExist([creatorId, ...others]);
    return this.chats.createGroupChat(creatorId, name, others);
  }

  async addGroupMembers(chatId: string, actorId: string, userIds: string[]): Promise<Chat> {
    const chat = await this.getGroupChat(chatId);
    await this.assertRole(chat.id, actorId, 'admin');
    const unique = [...new Set(userIds)];
    await this.assertUsersExist(unique);
    await this.chats.addMembers(chat.id, unique);
    return (await this.chats.getChat(chat.id))!;
  }

  async removeGroupMember(chatId: string, actorId: string, userId: string): Promise<Chat> {
    const chat = await this.getGroupChat(chatId);
    const actorRole = await this.assertMember(chat.id, actorId);
    if (actorId !== userId && actorRole !== 'admin') throw forbidden('Only a group admin can remove other members');

    const targetRole = await this.chats.getMemberRole(chat.id, userId);
    if (!targetRole) throw notFound('Member', { userId });
    if (targetRole === 'admin' && chat.members.filter((m) => m.role === 'admin').length === 1) {
      throw conflict('The last admin cannot leave or be removed from the group');
    }
    await this.chats.removeMember(chat.id, userId);
    return (await this.chats.getChat(chat.id))!;
  }

  async sendMessage(chatId: string, senderId: string, text: string): Promise<Message> {
    await this.getChatForMember(chatId, senderId);
    return this.messages.sendMessage(chatId, senderId, text);
  }

  async getMessages(chatId: string, limit: number, beforeSeq?: number, userId?: string): Promise<Message[]> {
    if (userId) await this.getChatForMember(chatId, userId);
    else await this.getChat(chatId);
    return this.messages.listMessages(chatId, beforeSeq === undefined ? { limit } : { limit, beforeSeq });
  }

  async markRead(chatId: string, messageId: string, userId: string): Promise<Message> {
    await this.getChatForMember(chatId, userId);
    const message = await this.messages.getMessage(chatId, messageId);
    if (!message) throw notFound('Message', { messageId });
    if (message.senderId === userId) return message;
    const updated = await this.messages.markRead(chatId, messageId, userId);
    if (!updated) throw notFound('Message', { messageId });
    return updated;
  }

  async updateLastSeen(chatId: string, userId: string, messageId: string): Promise<LastSeenResult> {
    await this.getChatForMember(chatId, userId);
    const result = await this.messages.setLastSeen(chatId, userId, messageId);
    if (!result) throw notFound('Message', { messageId });
    return result;
  }

  async getLastSeen(chatId: string): Promise<LastSeen[]> {
    await this.getChat(chatId);
    return this.messages.listLastSeen(chatId);
  }

  async editMessage(chatId: string, messageId: string, userId: string, text: string): Promise<Message> {
    const message = await this.getOwnMessage(chatId, messageId, userId);
    if (message.deletedAt) throw conflict('A deleted message cannot be edited');
    return (await this.messages.editMessage(chatId, messageId, text))!;
  }

  async deleteMessage(chatId: string, messageId: string, userId: string): Promise<Message> {
    const message = await this.getOwnMessage(chatId, messageId, userId);
    if (message.deletedAt) return message;
    return (await this.messages.deleteMessage(chatId, messageId))!;
  }

  private async assertUsersExist(userIds: string[]): Promise<void> {
    const missing = await this.chats.findMissingUsers(userIds);
    if (missing.length > 0) throw notFound(missing.length === 1 ? 'User' : 'Users', { userIds: missing });
  }

  private async getChat(chatId: string): Promise<Chat> {
    const chat = await this.chats.getChat(chatId);
    if (!chat) throw notFound('Chat', { chatId });
    return chat;
  }

  private async getGroupChat(chatId: string): Promise<Chat> {
    const chat = await this.getChat(chatId);
    if (chat.type !== 'group') throw badRequest('Members can only be managed on group chats');
    return chat;
  }

  private async assertMember(chatId: string, userId: string): Promise<MemberRole> {
    const role = await this.chats.getMemberRole(chatId, userId);
    if (!role) throw forbidden('User is not a member of this chat');
    return role;
  }

  private async assertRole(chatId: string, userId: string, required: MemberRole): Promise<void> {
    const role = await this.assertMember(chatId, userId);
    if (required === 'admin' && role !== 'admin') throw forbidden('Only a group admin can do this');
  }

  private async getChatForMember(chatId: string, userId: string): Promise<Chat> {
    const chat = await this.getChat(chatId);
    await this.assertMember(chatId, userId);
    return chat;
  }

  private async getOwnMessage(chatId: string, messageId: string, userId: string): Promise<Message> {
    await this.getChatForMember(chatId, userId);
    const message = await this.messages.getMessage(chatId, messageId);
    if (!message) throw notFound('Message', { messageId });
    if (message.senderId !== userId) throw forbidden('Only the sender can change this message');
    return message;
  }
}
