import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Users Service API',
      version: '1.0.0',
      description: 'API para gerenciamento de usuários em um sistema de microsserviços.',
    },
    servers: [{ url: 'http://localhost:3001' }],
    components: {
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'ID único do usuário', example: 'u_1a2b3c' },
            name: { type: 'string', description: 'Nome do usuário', example: 'John Doe' },
            email: { type: 'string', description: 'Email do usuário', example: 'john.doe@example.com' },
            createdAt: { type: 'string', format: 'date-time', description: 'Data de criação' },
            updatedAt: { type: 'string', format: 'date-time', description: 'Data da última atualização' },
          },
        },
        NewUser: {
          type: 'object',
          required: ['name', 'email'],
          properties: {
            name: { type: 'string', example: 'Jane Doe' },
            email: { type: 'string', example: 'jane.doe@example.com' },
          },
        },
        UpdateUser: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'Jane Doe Smith' },
            email: { type: 'string', example: 'jane.smith@example.com' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  },
  apis: ['./src/app.js'],
};

const swaggerSpec = swaggerJsdoc(options);
export default swaggerSpec;