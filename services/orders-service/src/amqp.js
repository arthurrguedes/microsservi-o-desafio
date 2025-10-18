import amqplib from 'amqplib';

export async function createChannel(url, exchange) {
  const conn = await amqplib.connect(url);

  conn.on('error', (err) => {
    console.error('[AMQP] erro de conexão', err.message);
  });

  conn.on('close', () => {
    console.error('[AMQP] conexão encerrada, reconectando');
    setTimeout(() => createChannel(url, exchange), 1000);
  });

  const ch = await conn.createChannel();
  await ch.assertExchange(exchange, 'topic', { durable: true });
  return { conn, ch };
}
