import express, { type ErrorRequestHandler, type Express } from 'express';
import { ZodError } from 'zod';
import { ChatController } from './controllers/chatController';
import { MessageController } from './controllers/messageController';
import { UserController } from './controllers/userController';
import { AppError } from './errors';
import type { ChatRepository } from './repositories/chatRepository';
import type { MessageStore } from './repositories/messageStore';
import { buildRouter } from './routes/index';
import { ChatService } from './services/chatService';

export interface AppDeps {
  chatRepository: ChatRepository;
  messageStore: MessageStore;
}

export function createApp({ chatRepository, messageStore }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const service = new ChatService(chatRepository, messageStore);
  app.use(
    buildRouter({
      user: new UserController(service),
      chat: new ChatController(service),
      message: new MessageController(service),
    }),
  );

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  app.use(errorHandler);
  return app;
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
    return;
  }
  console.error('[unhandled]', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
};
