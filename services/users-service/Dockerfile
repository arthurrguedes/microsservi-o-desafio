# Dockerfile para o serviço: services/users-service/Dockerfile
FROM node:20-alpine

# diretório de trabalho e a porta
WORKDIR /app
ENV PORT=3001
EXPOSE 3001

# Copia os arquivos de dependência (package.json e package-lock.json)
COPY services/users-service/package*.json ./

# Instala todas as dependências - 'only' production foi removida para garantir que a CLI do Prisma seja instalada corretamente
RUN npm install

# Copia o schema do Prisma, o código-fonte e a pasta common
COPY services/users-service/prisma ./prisma/
COPY services/users-service/src ./src/
COPY common/ ./common/

# Gera o Prisma Client
RUN npx prisma generate

# Comando final e único para iniciar a aplicação
CMD ["node", "src/index.js"]