import express from 'express';
import morgan from 'morgan';
import fetch from 'node-fetch';
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

const PORT = process.env.PORT || 3002;
const USERS_BASE_URL = process.env.USERS_BASE_URL || 'http://localhost:3001';
const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 2000);
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const EXCHANGE = process.env.EXCHANGE || 'app.topic';
const QUEUE = process.env.QUEUE || 'orders.q';
const ROUTING_KEY_USER_CREATED = process.env.ROUTING_KEY_USER_CREATED || ROUTING_KEYS.USER_CREATED;

// In-memory cache de usuários (preenchido por eventos)
const userCache = new Map();

let amqp = null;
(async () => {
  try {
    amqp = await createChannel(RABBITMQ_URL, EXCHANGE);
    console.log('[orders] AMQP connected');

    // Bind de fila para consumir eventos user.created
    await amqp.ch.assertQueue(QUEUE, { durable: true });
    await amqp.ch.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY_USER_CREATED);

    amqp.ch.consume(QUEUE, msg => {
      if (!msg) return;
      try {
        const user = JSON.parse(msg.content.toString());
        userCache.set(user.id, user);
        console.log('[orders] consumed event user.created -> cached', user.id);
        amqp.ch.ack(msg);
      } catch (err) {
        console.error('[orders] consume error:', err.message);
        amqp.ch.nack(msg, false, false);
      }
    });
  } catch (err) {
    console.error('[orders] AMQP connection failed:', err.message);
  }
})();

app.get('/health', (req, res) => res.json({ ok: true, service: 'orders' }));

app.get('/', async (req, res) => {
  const orders = await prisma.order.findMany();
  // converte items de string JSON para objeto
  res.json(orders.map(o => ({ ...o, items: JSON.parse(o.items) })));
});

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// Criar order
app.post('/', async (req, res) => {
  const { userId, items, total } = req.body || {};
  if (!userId || !Array.isArray(items) || typeof total !== 'number') {
    return res.status(400).json({ error: 'userId, items[], total<number> são obrigatórios' });
  }

  // Validação no Users Service
  try {
    const resp = await fetchWithTimeout(`${USERS_BASE_URL}/${userId}`, HTTP_TIMEOUT_MS);
    if (!resp.ok) return res.status(400).json({ error: 'usuário inválido' });
  } catch (err) {
    console.warn('[orders] users-service timeout/failure, tentando cache...', err.message);
    if (!userCache.has(userId)) {
      return res.status(503).json({ error: 'users-service indisponível e usuário não encontrado no cache' });
    }
  }

  const id = `o_${nanoid(6)}`;
  const order = await prisma.order.create({
    data: {
      id,
      userId,
      items: JSON.stringify(items),
      total,
      status: 'created',
    }
  });

  // Publicar evento order.created
  try {
    if (amqp?.ch) {
      amqp.ch.publish(EXCHANGE, ROUTING_KEYS.ORDER_CREATED, Buffer.from(JSON.stringify(order)), { persistent: true });
      console.log('[orders] published event:', ROUTING_KEYS.ORDER_CREATED, order.id);
    }
  } catch (err) {
    console.error('[orders] publish error:', err.message);
  }

  res.status(201).json({ ...order, items });
});

// Cancelar order
app.put('/:id/cancel', async (req, res) => {
  const { id } = req.params;
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return res.status(404).json({ error: 'order not found' });
  if (order.status === 'cancelled') return res.status(400).json({ error: 'order already cancelled' });

  const updatedOrder = await prisma.order.update({
    where: { id },
    data: { status: 'cancelled', cancelledAt: new Date() }
  });

  // Publicar evento order.cancelled
  try {
    if (amqp?.ch) {
      amqp.ch.publish(EXCHANGE, ROUTING_KEYS.ORDER_CANCELLED, Buffer.from(JSON.stringify(updatedOrder)), { persistent: true });
      console.log('[orders] published event:', ROUTING_KEYS.ORDER_CANCELLED, updatedOrder.id);
    }
  } catch (err) {
    console.error('[orders] publish error:', err.message);
  }

  res.json({ ...updatedOrder, items: JSON.parse(updatedOrder.items) });
});

app.listen(PORT, () => {
  console.log(`[orders] listening on http://localhost:${PORT}`);
  console.log(`[orders] users base url: ${USERS_BASE_URL}`);
});
