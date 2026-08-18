FROM node:20-alpine

WORKDIR /usr/src/app

# Install server dependencies first so this layer is cached across
# client/README-only changes
COPY server/package.json server/package-lock.json ./server/
RUN npm ci --omit=dev --prefix server

# Bundle client + server source
COPY client ./client
COPY server ./server

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "server/src/app.js"]
