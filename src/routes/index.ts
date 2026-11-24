import { Router } from 'express';
import type { ChatController } from '../controllers/chatController.js';
import type { MessageController } from '../controllers/messageController.js';
import type { UserController } from '../controllers/userController.js';

export interface Controllers {
  user: UserController;
  chat: ChatController;
  message: MessageController;
}

export function buildRouter({ user, chat, message }: Controllers): Router {
  const router = Router();

  router.post('/users', user.create);
  router.get('/user/:userId/chats', user.listChats);

  router.post('/chat/create', chat.createOrGetDirect);
  router.post('/chat/group/create', chat.createGroup);
  router.get('/chat/:chatId', chat.getDetails);
  router.post('/chat/:chatId/members', chat.addMembers);
  router.delete('/chat/:chatId/members/:userId', chat.removeMember);

  router.post('/chat/:chatId/message/send', message.send);
  router.get('/chat/:chatId/messages', message.list);
  router.post('/chat/:chatId/message/:messageId/read', message.markRead);
  router.patch('/chat/:chatId/message/:messageId', message.edit);
  router.delete('/chat/:chatId/message/:messageId', message.remove);
  router.post('/chat/:chatId/lastseen', message.updateLastSeen);
  router.get('/chat/:chatId/lastseen', message.getLastSeen);

  return router;
}
