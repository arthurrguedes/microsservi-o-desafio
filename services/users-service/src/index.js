import express from 'express';
import morgan from 'morgan';
import { nanoid } from 'nanoid';
import { createChannel } from './amqp.js';
import { ROUTING_KEYS } from '../../../common/events.js';
import { PrismaClient } from '@prisma/client';

const app = express();
app.use(express.json());
app.use(morgan('dev'));

let prisma;
try {
  prisma = new PrismaClient();
  console.log('[users] Prisma client initialized');
} catch (err) {
  console.error('[users] Prisma client init error:', err.message);
  process.exit(1);
}

const PORT = process.env.PORT || 3001;
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const EXCHANGE = process.env.EXCHANGE || 'app.topic';

// Conexão AMQP
let amqp = null;
(async () => {
  try {
    amqp = await createChannel(RABBITMQ_URL, EXCHANGE);
    console.log('[users] AMQP connected');
  } catch (err) {
    console.error('[users] AMQP connection failed:', err.message);
  }
})();

app.get('/health', (req, res) => res.json({ ok: true, service: 'users' }));

// Lista todos usuários
app.get('/', async (req, res) => {
  const users = await prisma.user.findMany();
  res.json(users);
});

// Cria usuário
app.post('/', async (req, res) => {
  const { name, email } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'name and email are required' });

  const id = `u_${nanoid(6)}`;
  const user = await prisma.user.create({
    data: { id, name, email }
  });

  // Publish event
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

// Consulta usuário por ID
app.get('/:id', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: 'not found' });
  res.json(user);
});

// Atualiza usuário
app.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, email } = req.body || {};

  // Verifica se o usuário existe
  const existingUser = await prisma.user.findUnique({ where: { id } });
  if (!existingUser) return res.status(404).json({ error: 'user not found' });

  // Atualiza campos enviados
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

app.listen(PORT, () => {
  console.log(`[users] listening on http://localhost:${PORT}`);
});
