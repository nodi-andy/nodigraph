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
# The public hosted product promises no server-side storage — a plain
# `docker run` of this image (Cloud Run included) must never turn into a
# single shared document every visitor reads and writes (see
# server/src/app.js's own PERSISTENCE_DISABLED). Override to a falsy value
# only for a private, single-user deployment where that's actually wanted.
ENV NODIGRAPH_DISABLE_PERSISTENCE=true
EXPOSE 8080

CMD ["node", "server/src/app.js"]
