# Dockerfile para o serviço: services/orders-service/Dockerfile
FROM node:20-alpine

# diretório de trabalho e a porta
WORKDIR /app
ENV PORT=3002
EXPOSE 3002

# Copia os arquivos de dependência
COPY services/orders-service/package*.json ./

# Instala as dependências (removida a flag --only=production)
# Isso é necessário para que o 'npx prisma generate' funcione.
RUN npm install

# Copia o schema do Prisma e o código fonte
COPY services/orders-service/prisma ./prisma/
COPY services/orders-service/src ./src/
COPY common/ ./common/

# Gera o Prisma Client
RUN npx prisma generate

# Comando final e único para iniciar a aplicação
# É mais explícito e seguro usar "node" diretamente
CMD ["node", "src/index.js"]