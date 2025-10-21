import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  // Informações básicas da API
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Users Service API',
      version: '1.0.0',
      description: 'API para gerenciamento de usuários',
    },
    servers: [
      {
        url: 'http://localhost:3002', // URL base do seu serviço
      },
    ],
  },
  // Caminho para os arquivos que contêm as anotações da API
  apis: ['./src/app.js'], // Aponte para seu arquivo de rotas
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;