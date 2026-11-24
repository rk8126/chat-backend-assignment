export type ChatType = 'direct' | 'group';
export type MemberRole = 'admin' | 'member';

export interface User {
  id: string;
  name: string;
  createdAt: Date;
}

export interface ChatMember {
  userId: string;
  role: MemberRole;
  joinedAt: Date;
}

export interface Chat {
  id: string;
  type: ChatType;
  name: string | null;
  createdBy: string | null;
  createdAt: Date;
  members: ChatMember[];
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  seq: number;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  readBy: Record<string, Date>;
}

export interface LastSeen {
  userId: string;
  messageId: string;
  seq: number;
  updatedAt: Date;
}
