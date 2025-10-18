import amqplib from 'amqplib';

export async function createChannel(url, exchange) {
  let conn;
  let ch;

  async function connect() {
    try {
      conn = await amqplib.connect(url);

      // Tratamento de eventos da conexão
      conn.on('error', (err) => {
        console.error('[AMQP] erro de conexão:', err.message);
      });

      conn.on('close', () => {
        console.error('[AMQP] conexão encerrada, reconectando');
        setTimeout(connect, 1000); // tenta reconectar
      });

      ch = await conn.createChannel();
      await ch.assertExchange(exchange, 'topic', { durable: true });

      console.log(`[AMQP] Conectado ao exchange "${exchange}"`);
    } catch (err) {
      console.error('[AMQP] falha de conexão, reconectando', err.message);
      setTimeout(connect, 1000);
    }
  }

  await connect();
  return { conn, ch };
}
