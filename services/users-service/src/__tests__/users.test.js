const request = require('supertest');

// Mocks 
const mockPrisma = {
  user: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
};
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

jest.mock('../amqp.js', () => ({
  createChannel: jest.fn(() => Promise.resolve({
    ch: {
      publish: jest.fn(),
    },
  })),
}));
// fim dos Mocks


describe('Users Service - Endpoints', () => {
  let app;
  let exitSpy;

  // Bloco que roda antes de cada teste
  beforeEach(() => {
    // Mock do process.exit para impedir que ele encerre o teste
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    // Carrega a aplicação
    app = require('../app.js').default;
  });

  // Bloco que roda depois de cada teste
  afterEach(() => {
    jest.clearAllMocks();
    exitSpy.mockRestore(); // restauração da função original do process.exit
  });


  describe('GET /', () => {
    it('deve retornar uma lista de usuários e status 200', async () => {
      const mockUsers = [{ id: 'u_123', name: 'Test User', email: 'test@test.com' }];
      mockPrisma.user.findMany.mockResolvedValue(mockUsers);
      
      const response = await request(app).get('/');

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual(mockUsers);
    });
  });

  describe('POST /', () => {
    it('deve criar um usuário e retornar status 201', async () => {
      const userData = { name: 'New User', email: 'new@test.com' };
      const createdUser = { id: 'u_abc', ...userData };
      mockPrisma.user.create.mockResolvedValue(createdUser);

      const response = await request(app)
        .post('/')
        .send(userData);

      expect(response.statusCode).toBe(201);
      expect(response.body).toEqual(createdUser);
    });
  });
});