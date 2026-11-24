# Chat Backend

Chat backend built with Node.js, TypeScript, Express, PostgreSQL (Prisma) and Firebase Firestore.

Users and chats are stored in PostgreSQL. Messages, read receipts and last seen are stored in Firestore.

## Run it

Requires Docker.

```bash
docker compose up --build
```

This starts three containers:

- `app` – the API on http://localhost:3000 (runs migrations on startup)
- `postgres` – PostgreSQL 16
- `firestore` – Firestore emulator

Create some test users:

```bash
docker compose exec app npm run seed
```

Example requests:

```bash
curl -X POST localhost:3000/chat/create -H 'content-type: application/json' \
  -d '{"userAId":"<alice-id>","userBId":"<bob-id>"}'

curl -X POST localhost:3000/chat/<chat-id>/message/send -H 'content-type: application/json' \
  -d '{"senderId":"<alice-id>","text":"Hi Bob"}'

curl "localhost:3000/chat/<chat-id>/messages?limit=50"
```

Stop everything with `docker compose down` (add `-v` to also delete the data).

## Testing

```bash
docker compose exec app npm test
```

- `tests/api.test.ts` – all endpoints, using in-memory repositories
- `tests/prismaChatRepository.test.ts` – Prisma queries against the Postgres container (uses a separate `chat_test` database)
- `tests/firestoreMessageStore.test.ts` – message store against the Firestore emulator

## Project structure

```
├── Dockerfile
├── docker-compose.yml
├── docker/postgres-init.sql
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── server.ts
│   ├── app.ts
│   ├── config.ts
│   ├── db/              prisma and firestore clients
│   ├── routes/
│   ├── controllers/
│   ├── validators/      zod request schemas
│   ├── services/
│   ├── repositories/    postgres (prisma) and firestore data access
│   └── scripts/seed.ts
└── tests/
```

## Data model

### PostgreSQL

**users**

| Column | Type | |
|---|---|---|
| id | uuid | primary key |
| name | text | |
| created_at | timestamptz | |

**chats**

| Column | Type | |
|---|---|---|
| id | uuid | primary key |
| type | enum (`direct`, `group`) | |
| name | text | group chats only |
| direct_key | text | unique, `"<userId1>:<userId2>"` (sorted) for 1:1 chats |
| created_by | uuid | → users.id |
| created_at | timestamptz | |

**chat_members**

| Column | Type | |
|---|---|---|
| chat_id | uuid | → chats.id |
| user_id | uuid | → users.id, indexed |
| role | enum (`admin`, `member`) | |
| joined_at | timestamptz | |

Primary key is `(chat_id, user_id)`.

### Firestore

```
chats/{chatId}
  messageCount, lastMessageAt

chats/{chatId}/messages/{messageId}
  senderId, text, seq, createdAt, editedAt, deletedAt
  readBy: { <userId>: timestamp }

chats/{chatId}/lastSeen/{userId}
  messageId, seq, updatedAt
```

`chatId` is the same id as in the PostgreSQL `chats` table. Messages are ordered by `seq`, a per-chat counter.
