const request = require('supertest');
const { default: fetch } = require('node-fetch');
const opossum = require('opossum');

// --- Mocks ---
jest.mock('node-fetch');

const mockPrisma = {
  order: { create: jest.fn() },
};
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

jest.mock('../amqp.js', () => ({
  createChannel: jest.fn(() => Promise.resolve({
    ch: {
      publish: jest.fn(), assertQueue: jest.fn(), bindQueue: jest.fn(), consume: jest.fn()
    },
  })),
}));
// --- Fim dos Mocks ---


describe('Orders Service - Endpoints', () => {
  let app;
  let breaker;
  let exitSpy;

  beforeEach(() => {
    // Mock o process.exit para impedir que ele encerre o teste
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    // com os mocks no lugar, a aplicação carrega
    const appModule = require('../app.js');
    app = appModule.app;
    breaker = appModule.breaker;
  });

  afterEach(() => {
    // Limpamos os mocks e o cache de módulos para garantir isolamento
    jest.clearAllMocks();
    jest.resetModules();
    exitSpy.mockRestore();
  });

  describe('POST /', () => {
    it('deve criar um novo pedido e retornar status 201', async () => {
      fetch.mockReturnValue(Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'u_12345' }) }));
      const orderData = { userId: 'u_12345', items: [], total: 100.0 };
      mockPrisma.order.create.mockResolvedValue({ id: 'o_123', ...orderData });
      
      const response = await request(app).post('/').send(orderData);
      
      expect(response.statusCode).toBe(201);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Circuit Breaker (Opossum)', () => {
    it('deve acionar o fallback e não chamar o fetch quando o circuito está aberto', async () => {
      // Força a abertura do circuito manualmente
      breaker.open();

      const orderData = { userId: 'u_12345', items: [], total: 100 };
      const response = await request(app).post('/').send(orderData);

      expect(response.statusCode).toBe(503);
      expect(response.body.error).toContain('indisponível');
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});