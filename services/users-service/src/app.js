import express from 'express';
import morgan from 'morgan';
import { nanoid } from 'nanoid';
import { createChannel } from './amqp.js';
import { ROUTING_KEYS } from '@common/events.js';
import { PrismaClient } from '@prisma/client';
import retry from 'async-retry';
import swaggerSpec from './swaggerConfig.js';

// Criação e configuração da instância do Express
const app = express();
app.use(express.json());
app.use(morgan('dev'));

// Inicialização de dependências (Prisma e AMQP)
let prisma;
try {
  prisma = new PrismaClient();
  console.log('[users] Prisma client initialized');
} catch (err) {
  console.error('[users] Prisma client init error:', err.message);
  process.exit(1);
}

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const EXCHANGE = process.env.EXCHANGE || 'app.topic';

let amqp = null;
(async () => {
  try {
    // Usando o retry para envolver a lógica de conexão
    await retry(async (bail) => {
      console.log('[users] Attempting to connect to AMQP...');
      amqp = await createChannel(RABBITMQ_URL, EXCHANGE);
      console.log('[users] AMQP connected successfully!');
    }, {
      retries: 5,           // Tenta no máximo 5 vezes
      factor: 2,            // A cada tentativa, o tempo de espera dobra
      minTimeout: 1000,     // Começa esperando 1 segundo
      onRetry: (err) => {   // Loga o erro em cada nova tentativa
        console.error('[users] AMQP connection failed, retrying...', err.message);
      }
    });
  } catch (err) {
    // Se todas as 5 tentativas falharem, o erro final é lançado
    console.error('[users] Could not connect to AMQP after multiple retries:', err.message);
    process.exit(1); // Desiste e encerra a aplicação
  }
})();

// rotas
app.get('/health', (req, res) => res.json({ ok: true, service: 'users' }));

app.get('/', async (req, res) => {
  const users = await prisma.user.findMany();
  res.json(users);
});

app.post('/', async (req, res) => {
  const { name, email } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'name and email are required' });

  const id = `u_${nanoid(6)}`;
  const user = await prisma.user.create({
    data: { id, name, email }
  });

  try {
    if (amqp?.ch) {
      const payload = Buffer.from(JSON.stringify(user));
      amqp.ch.publish(EXCHANGE, ROUTING_KEYS.USER_CREATED, payload, { persistent: true });
      console.log('[users] published event:', ROUTING_KEYS.USER_CREATED, user.id);
    }
  } catch (err) {
    console.error('[users] publish error:', err.message);
  }

  res.status(201).json(user);
});

app.get('/:id', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: 'not found' });
  res.json(user);
});

app.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, email } = req.body || {};

  const existingUser = await prisma.user.findUnique({ where: { id } });
  if (!existingUser) return res.status(404).json({ error: 'user not found' });

  const updatedUser = await prisma.user.update({
    where: { id },
    data: {
      name: name ?? existingUser.name,
      email: email ?? existingUser.email,
      updatedAt: new Date()
    }
  });

  try {
    if (amqp?.ch) {
      const payload = Buffer.from(JSON.stringify(updatedUser));
      amqp.ch.publish(EXCHANGE, ROUTING_KEYS.USER_UPDATED, payload, { persistent: true });
      console.log('[users] published event:', ROUTING_KEYS.USER_UPDATED, updatedUser.id);
    }
  } catch (err) {
    console.error('[users] publish error:', err.message);
  }

  res.json(updatedUser);
});

// Exporta a instância do app
export default app;