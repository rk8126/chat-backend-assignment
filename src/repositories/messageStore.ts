import {
  FieldPath,
  FieldValue,
  Timestamp,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase-admin/firestore';
import type { LastSeen, Message } from '../types.js';

export interface ListMessagesOptions {
  limit: number;
  beforeSeq?: number;
}

export interface LastSeenResult {
  lastSeen: LastSeen;
  updated: boolean;
}

export interface MessageStore {
  sendMessage(chatId: string, senderId: string, text: string): Promise<Message>;
  listMessages(chatId: string, options: ListMessagesOptions): Promise<Message[]>;
  getMessage(chatId: string, messageId: string): Promise<Message | null>;
  markRead(chatId: string, messageId: string, userId: string): Promise<Message | null>;
  setLastSeen(chatId: string, userId: string, messageId: string): Promise<LastSeenResult | null>;
  listLastSeen(chatId: string): Promise<LastSeen[]>;
  editMessage(chatId: string, messageId: string, text: string): Promise<Message | null>;
  deleteMessage(chatId: string, messageId: string): Promise<Message | null>;
}

interface MessageDoc {
  senderId: string;
  text: string;
  seq: number;
  createdAt: Timestamp;
  editedAt: Timestamp | null;
  deletedAt: Timestamp | null;
  readBy: Record<string, Timestamp>;
}

interface LastSeenDoc {
  messageId: string;
  seq: number;
  updatedAt: Timestamp;
}

const toDate = (t: Timestamp | null | undefined): Date | null => (t ? t.toDate() : null);

function toMessage(chatId: string, snap: DocumentSnapshot): Message {
  const d = snap.data() as MessageDoc;
  const readBy: Record<string, Date> = {};
  for (const [userId, at] of Object.entries(d.readBy ?? {})) readBy[userId] = at.toDate();
  return {
    id: snap.id,
    chatId,
    senderId: d.senderId,
    text: d.text,
    seq: d.seq,
    createdAt: d.createdAt.toDate(),
    editedAt: toDate(d.editedAt),
    deletedAt: toDate(d.deletedAt),
    readBy,
  };
}

const toLastSeen = (userId: string, d: LastSeenDoc): LastSeen => ({
  userId,
  messageId: d.messageId,
  seq: d.seq,
  updatedAt: d.updatedAt.toDate(),
});

export class FirestoreMessageStore implements MessageStore {
  constructor(private readonly db: Firestore) {}

  private chatRef(chatId: string) {
    return this.db.collection('chats').doc(chatId);
  }

  private messageRef(chatId: string, messageId: string) {
    return this.chatRef(chatId).collection('messages').doc(messageId);
  }

  async sendMessage(chatId: string, senderId: string, text: string): Promise<Message> {
    const chatRef = this.chatRef(chatId);
    const messageRef = chatRef.collection('messages').doc();

    // per-chat counter, so ordering doesn't depend on timestamps
    await this.db.runTransaction(async (tx) => {
      const chatSnap = await tx.get(chatRef);
      const seq = ((chatSnap.get('messageCount') as number | undefined) ?? 0) + 1;
      tx.set(chatRef, { messageCount: seq, lastMessageAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(messageRef, {
        senderId,
        text,
        seq,
        createdAt: FieldValue.serverTimestamp(),
        editedAt: null,
        deletedAt: null,
        readBy: {},
      });
    }, { maxAttempts: 10 });

    return toMessage(chatId, await messageRef.get());
  }

  async listMessages(chatId: string, { limit, beforeSeq }: ListMessagesOptions): Promise<Message[]> {
    let query = this.chatRef(chatId).collection('messages').orderBy('seq', 'desc');
    if (beforeSeq !== undefined) query = query.where('seq', '<', beforeSeq);
    const snap = await query.limit(limit).get();
    return snap.docs.map((doc) => toMessage(chatId, doc)).reverse();
  }

  async getMessage(chatId: string, messageId: string): Promise<Message | null> {
    const snap = await this.messageRef(chatId, messageId).get();
    return snap.exists ? toMessage(chatId, snap) : null;
  }

  async markRead(chatId: string, messageId: string, userId: string): Promise<Message | null> {
    const ref = this.messageRef(chatId, messageId);
    const exists = await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const readBy = (snap.get('readBy') as Record<string, Timestamp> | undefined) ?? {};
      if (!readBy[userId]) {
        tx.update(ref, new FieldPath('readBy', userId), FieldValue.serverTimestamp());
      }
      return true;
    });
    return exists ? this.getMessage(chatId, messageId) : null;
  }

  async setLastSeen(chatId: string, userId: string, messageId: string): Promise<LastSeenResult | null> {
    const messageRef = this.messageRef(chatId, messageId);
    const lastSeenRef = this.chatRef(chatId).collection('lastSeen').doc(userId);

    const outcome = await this.db.runTransaction(async (tx) => {
      const [messageSnap, currentSnap] = await Promise.all([tx.get(messageRef), tx.get(lastSeenRef)]);
      if (!messageSnap.exists) return null;
      const seq = messageSnap.get('seq') as number;
      const current = currentSnap.exists ? (currentSnap.data() as LastSeenDoc) : null;
      if (current && current.seq >= seq) return { updated: false };
      tx.set(lastSeenRef, { messageId, seq, updatedAt: FieldValue.serverTimestamp() });
      return { updated: true };
    });
    if (!outcome) return null;

    const snap = await lastSeenRef.get();
    return { lastSeen: toLastSeen(userId, snap.data() as LastSeenDoc), updated: outcome.updated };
  }

  async listLastSeen(chatId: string): Promise<LastSeen[]> {
    const snap = await this.chatRef(chatId).collection('lastSeen').get();
    return snap.docs.map((doc) => toLastSeen(doc.id, doc.data() as LastSeenDoc));
  }

  async editMessage(chatId: string, messageId: string, text: string): Promise<Message | null> {
    const ref = this.messageRef(chatId, messageId);
    if (!(await ref.get()).exists) return null;
    await ref.update({ text, editedAt: FieldValue.serverTimestamp() });
    return this.getMessage(chatId, messageId);
  }

  async deleteMessage(chatId: string, messageId: string): Promise<Message | null> {
    const ref = this.messageRef(chatId, messageId);
    if (!(await ref.get()).exists) return null;
    await ref.update({ text: '', deletedAt: FieldValue.serverTimestamp() });
    return this.getMessage(chatId, messageId);
  }
}
