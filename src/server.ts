import { createApp } from './app.js';
import { loadEnv } from './config.js';
import { createFirestore } from './db/firebase.js';
import { createPrisma } from './db/prisma.js';
import { PrismaChatRepository } from './repositories/chatRepository.js';
import { FirestoreMessageStore } from './repositories/messageStore.js';

const env = loadEnv();
const prisma = createPrisma(env.DATABASE_URL);
const firestore = createFirestore(env);

await prisma.$queryRaw`SELECT 1`;

const app = createApp({
  chatRepository: new PrismaChatRepository(prisma),
  messageStore: new FirestoreMessageStore(firestore),
});

const server = app.listen(env.PORT, () => {
  console.log(`chat-backend listening on http://localhost:${env.PORT}`);
});

const shutdown = (signal: string) => {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    void Promise.allSettled([prisma.$disconnect(), firestore.terminate()]).then(() => process.exit(0));
  });
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
