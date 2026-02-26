FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY server.js ./

# OPENCLAW_HOST and OPENCLAW_PORT must be set in .env or docker-compose
# They point to the OpenClaw server that processes AI queries
EXPOSE 3333

CMD ["node", "server.js"]
