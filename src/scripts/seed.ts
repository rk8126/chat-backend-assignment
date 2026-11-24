import { loadEnv } from '../config.js';
import { createPrisma } from '../db/prisma.js';
import { PrismaChatRepository } from '../repositories/chatRepository.js';

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
