import type { Request, Response } from 'express';
import type { ChatService } from '../services/chatService.js';
import * as v from '../validators/schemas.js';

export class ChatController {
  constructor(private readonly service: ChatService) {}

  createOrGetDirect = async (req: Request, res: Response): Promise<void> => {
    const { userAId, userBId } = v.createChatBody.parse(req.body);
    const { chat, created } = await this.service.createOrGetDirectChat(userAId, userBId);
    res.status(created ? 201 : 200).json({ chatId: chat.id, created });
  };

  createGroup = async (req: Request, res: Response): Promise<void> => {
    const { creatorId, name, memberIds } = v.createGroupBody.parse(req.body);
    const chat = await this.service.createGroupChat(creatorId, name, memberIds);
    res.status(201).json({ chatId: chat.id, chat });
  };

  getDetails = async (req: Request, res: Response): Promise<void> => {
    const { chatId } = v.chatIdParams.parse(req.params);
    res.json({ chat: await this.service.getChatDetails(chatId) });
  };

  addMembers = async (req: Request, res: Response): Promise<void> => {
    const { chatId } = v.chatIdParams.parse(req.params);
    const { actorId, userIds } = v.addMembersBody.parse(req.body);
    res.json({ chat: await this.service.addGroupMembers(chatId, actorId, userIds) });
  };

  removeMember = async (req: Request, res: Response): Promise<void> => {
    const { chatId, userId } = v.memberParams.parse(req.params);
    const { actorId } = v.actorBody.parse(req.body ?? {});
    res.json({ chat: await this.service.removeGroupMember(chatId, actorId, userId) });
  };
}
