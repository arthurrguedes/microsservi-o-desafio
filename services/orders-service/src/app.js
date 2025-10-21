import express from 'express';
import morgan from 'morgan';
import fetch from 'node-fetch';
import { nanoid } from 'nanoid';
import { createChannel } from './amqp.js';
import { ROUTING_KEYS } from '@common/events.js';
import { PrismaClient } from '@prisma/client';
import retry from 'async-retry';
import opossum from 'opossum';
import swaggerSpec from './swaggerConfig.js';

const app = express();
app.use(express.json());
app.use(morgan('dev'));

let prisma;
try {
  prisma = new PrismaClient();
  console.log('[orders] Prisma client initialized');
} catch (err) {
  console.error('[orders] Prisma client init error:', err.message);
  process.exit(1);
}

// Função que o Circuit Breaker vai proteger.
// Ela tenta buscar um usuário e lança um erro em caso de falha.
async function fetchUser(userId) {
  const resp = await fetchWithTimeout(`${USERS_BASE_URL}/${userId}`, HTTP_TIMEOUT_MS);
  if (!resp.ok) {
    throw new Error(`Users service returned status ${resp.status}`);
  }
  return await resp.json();
}

// Opções de configuração para o breaker
const options = {
  timeout: 3000,                      // Se a chamada demorar mais de 3s, é considerada falha
  errorThresholdPercentage: 50,       // Se 50% das últimas chamadas falharem, o circuito abre
  resetTimeout: 30000                 // Tenta fechar o circuito a cada 30 segundos
};

const breaker = new opossum(fetchUser, options);

// (Opcional, mas recomendado) Adicione logs para os eventos do breaker
breaker.on('open', () => console.log(`[orders] CIRCUIT BREAKER ABERTO para o users-service.`));
breaker.on('close', () => console.log(`[orders] CIRCUIT BREAKER FECHADO. Serviço normalizado.`));
breaker.on('fallback', () => console.warn(`[orders] Fallback acionado. Usando cache...`));

// Define uma função de fallback. Se o circuito estiver aberto, ele executa isso.
breaker.fallback(async (userId) => {
  console.warn(`[orders] Circuito para users-service está aberto. Verificando cache para o usuário ${userId}`);
  if (userCache.has(userId)) {
    return userCache.get(userId);
  }
  // Lança um erro específico que podemos tratar na rota
  throw new Error('CircuitBreakerOpen');
});

const PORT = process.env.PORT || 3002;
const USERS_BASE_URL = process.env.USERS_BASE_URL || 'http://localhost:3001';
const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 2000);
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const EXCHANGE = process.env.EXCHANGE || 'app.topic';
const QUEUE = process.env.QUEUE || 'orders.q';
const ROUTING_KEY_USER_CREATED = process.env.ROUTING_KEY_USER_CREATED || ROUTING_KEYS.USER_CREATED;

// cache de usuários (preenchido por eventos)
const userCache = new Map();

let amqp = null;
(async () => {
  try {
    // Envolvemos toda a lógica de conexão e setup no retry
    await retry(async (bail) => {
      console.log('[orders] Attempting to connect to AMQP...');
      amqp = await createChannel(RABBITMQ_URL, EXCHANGE);

      // Bind de fila para consumir eventos user.created
      await amqp.ch.assertQueue(QUEUE, { durable: true });
      await amqp.ch.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY_USER_CREATED);

      console.log('[orders] AMQP connected successfully! Waiting for messages.');
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
    }, {
      retries: 5,
      factor: 2,
      minTimeout: 1000,
      onRetry: (err) => {
        console.error('[orders] AMQP connection failed, retrying...', err.message);
      }
    });
  } catch (err) {
    console.error('[orders] Could not connect to AMQP after multiple retries:', err.message);
    process.exit(1);
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

  // Validação no Users Service, agora protegida pelo Circuit Breaker
  try {
    // Usamos .fire() para executar a função protegida que definimos anteriormente (fetchUser).
    // O breaker vai gerenciar internamente timeouts, falhas e o estado do circuito.
    await breaker.fire(userId);

  } catch (err) {
    // Se o breaker falhar (por timeout, erro 5xx, ou por o circuito já estar aberto),
    // ele vai acionar o fallback. Se o fallback também falhar (usuário não está no cache),
    // o erro cairá aqui.
    console.error('[orders] Falha na validação do usuário (via circuit breaker):', err.message);
    if (!userCache.has(userId)) {
      return res.status(503).json({ error: 'users-service indisponível e usuário não encontrado no cache' });
    }
    console.log('[orders] Usuário encontrado no cache, continuando o processo.');
  }

  // Se a chamada ao breaker foi bem-sucedida ou se o usuário foi encontrado no cache,
  // a execução continua normalmente a partir daqui.
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

export { app, breaker }; // Exporta a aplicação