import { z } from 'zod';

const uuid = z.string().uuid();
const messageId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/, 'Invalid messageId');
const text = z.string().trim().min(1, 'text must not be empty').max(4000);

export const chatIdParams = z.object({ chatId: uuid });
export const messageParams = z.object({ chatId: uuid, messageId });
export const userIdParams = z.object({ userId: uuid });
export const memberParams = z.object({ chatId: uuid, userId: uuid });

export const createUserBody = z.object({ name: z.string().trim().min(1).max(100) });
export const createChatBody = z.object({ userAId: uuid, userBId: uuid });
export const createGroupBody = z.object({
  creatorId: uuid,
  name: z.string().trim().min(1).max(100),
  memberIds: z.array(uuid).min(1).max(256),
});
export const addMembersBody = z.object({ actorId: uuid, userIds: z.array(uuid).min(1).max(256) });
export const actorBody = z.object({ actorId: uuid });

export const sendMessageBody = z.object({ senderId: uuid, text });
export const listMessagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.number().int().positive().optional(),
  userId: uuid.optional(),
});
export const userBody = z.object({ userId: uuid });
export const lastSeenBody = z.object({ userId: uuid, messageId });
export const editMessageBody = z.object({ userId: uuid, text });
