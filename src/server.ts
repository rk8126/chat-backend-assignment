import { createApp } from './app';
import { loadEnv } from './config';
import { createFirestore } from './db/firebase';
import { createPrisma } from './db/prisma';
import { PrismaChatRepository } from './repositories/chatRepository';
import { FirestoreMessageStore } from './repositories/messageStore';

async function main(): Promise<void> {
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
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
