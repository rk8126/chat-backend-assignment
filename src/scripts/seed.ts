import { loadEnv } from '../config';
import { createPrisma } from '../db/prisma';
import { PrismaChatRepository } from '../repositories/chatRepository';

async function seed(): Promise<void> {
  const prisma = createPrisma(loadEnv().DATABASE_URL);
  const repo = new PrismaChatRepository(prisma);
  try {
    for (const name of ['Alice', 'Bob', 'Charlie']) {
      const user = await repo.createUser(name);
      console.log(`${user.name.padEnd(8)} ${user.id}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

seed().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
