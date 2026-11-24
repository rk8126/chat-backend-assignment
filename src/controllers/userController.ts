import type { Request, Response } from 'express';
import type { ChatService } from '../services/chatService.js';
import * as v from '../validators/schemas.js';

export class UserController {
  constructor(private readonly service: ChatService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const { name } = v.createUserBody.parse(req.body);
    res.status(201).json({ user: await this.service.createUser(name) });
  };

  listChats = async (req: Request, res: Response): Promise<void> => {
    const { userId } = v.userIdParams.parse(req.params);
    const chats = await this.service.listUserChats(userId);
    res.json({
      chats: chats.map((c) => ({ ...c, memberIds: c.members.map((m) => m.userId) })),
    });
  };
}
