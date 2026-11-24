import type { Request, Response } from 'express';
import type { ChatService } from '../services/chatService';
import * as v from '../validators/schemas';

export class MessageController {
  constructor(private readonly service: ChatService) {}

  send = async (req: Request, res: Response): Promise<void> => {
    const { chatId } = v.chatIdParams.parse(req.params);
    const { senderId, text } = v.sendMessageBody.parse(req.body);
    res.status(201).json({ message: await this.service.sendMessage(chatId, senderId, text) });
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const { chatId } = v.chatIdParams.parse(req.params);
    const { limit, before, userId } = v.listMessagesQuery.parse(req.query);
    const messages = await this.service.getMessages(chatId, limit, before, userId);
    const oldest = messages[0];
    res.json({
      messages,
      nextBefore: messages.length === limit && oldest && oldest.seq > 1 ? oldest.seq : null,
    });
  };

  markRead = async (req: Request, res: Response): Promise<void> => {
    const { chatId, messageId } = v.messageParams.parse(req.params);
    const { userId } = v.userBody.parse(req.body);
    const message = await this.service.markRead(chatId, messageId, userId);
    res.json({ messageId: message.id, readBy: message.readBy });
  };

  edit = async (req: Request, res: Response): Promise<void> => {
    const { chatId, messageId } = v.messageParams.parse(req.params);
    const { userId, text } = v.editMessageBody.parse(req.body);
    res.json({ message: await this.service.editMessage(chatId, messageId, userId, text) });
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    const { chatId, messageId } = v.messageParams.parse(req.params);
    const { userId } = v.userBody.parse(req.body ?? {});
    res.json({ message: await this.service.deleteMessage(chatId, messageId, userId) });
  };

  updateLastSeen = async (req: Request, res: Response): Promise<void> => {
    const { chatId } = v.chatIdParams.parse(req.params);
    const { userId, messageId } = v.lastSeenBody.parse(req.body);
    res.json(await this.service.updateLastSeen(chatId, userId, messageId));
  };

  getLastSeen = async (req: Request, res: Response): Promise<void> => {
    const { chatId } = v.chatIdParams.parse(req.params);
    res.json({ lastSeen: await this.service.getLastSeen(chatId) });
  };
}
