import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '../src/db/prisma';
import type { PrismaClient } from '../src/generated/prisma/client';
import { PrismaChatRepository } from '../src/repositories/chatRepository';

const url = process.env.TEST_DATABASE_URL;
const migrationsDir = path.join(__dirname, '../prisma/migrations');

async function resetDatabase(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    const dirs = (await readdir(migrationsDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const dir of dirs) {
      await client.query(await readFile(path.join(migrationsDir, dir, 'migration.sql'), 'utf8'));
    }
  } finally {
    await client.end();
  }
}

describe.skipIf(!url)('PrismaChatRepository (real Postgres)', () => {
  let prisma: PrismaClient;
  let repo: PrismaChatRepository;

  beforeAll(async () => {
    await resetDatabase(url!);
    prisma = createPrisma(url!);
    repo = new PrismaChatRepository(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('find-or-create is race-safe: 20 concurrent calls yield one chat', async () => {
    const a = await repo.createUser('A');
    const b = await repo.createUser('B');
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        i % 2 ? repo.findOrCreateDirectChat(a.id, b.id) : repo.findOrCreateDirectChat(b.id, a.id),
      ),
    );
    expect(new Set(results.map((r) => r.chat.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(results[0]!.chat.members.map((m) => m.userId).sort()).toEqual([a.id, b.id].sort());
    expect(await prisma.chat.count({ where: { type: 'direct' } })).toBe(1);
  });

  it('groups, membership and listing', async () => {
    const [x, y, z] = await Promise.all([repo.createUser('X'), repo.createUser('Y'), repo.createUser('Z')]);
    const group = await repo.createGroupChat(x.id, 'G', [y.id]);
    expect(group).toMatchObject({ type: 'group', name: 'G', createdBy: x.id });
    expect(await repo.getMemberRole(group.id, x.id)).toBe('admin');
    expect(await repo.getMemberRole(group.id, z.id)).toBeNull();

    await repo.addMembers(group.id, [z.id, y.id]);
    expect((await repo.getChat(group.id))!.members).toHaveLength(3);
    expect(await repo.removeMember(group.id, y.id)).toBe(true);
    expect(await repo.removeMember(group.id, y.id)).toBe(false);

    const direct = await repo.findOrCreateDirectChat(x.id, z.id);
    const chats = await repo.listUserChats(z.id);
    expect(chats.map((c) => c.id).sort()).toEqual([group.id, direct.chat.id].sort());
    expect(await repo.listUserChats(y.id)).toEqual([]);

    const ghost = '00000000-0000-4000-8000-000000000000';
    expect(await repo.findMissingUsers([x.id, ghost])).toEqual([ghost]);
    expect(await repo.getChat(ghost)).toBeNull();
  });

  it('database CHECK constraints from the migration are in force', async () => {
    await expect(prisma.user.create({ data: { name: '   ' } })).rejects.toThrow();
    await expect(prisma.chat.create({ data: { type: 'group' } })).rejects.toThrow();
  });
});
