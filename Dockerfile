FROM node:20-alpine

WORKDIR /usr/src/app

# Install server dependencies first so this layer is cached across
# client/README-only changes
COPY server/package.json server/package-lock.json ./server/
RUN npm ci --omit=dev --prefix server

# Bundle client + server source
COPY client ./client
COPY server ./server

# Stamped into the image so a running deployment can say which build it is
# (see server/src/app.js's /api/version, printed in the browser console).
# The commit has to be handed in: .git is left out of the build context
# (see .dockerignore). The Cloud Build trigger passes it with
# --build-arg=COMMIT_SHA=$COMMIT_SHA; without that the build time alone
# still tells one deployment from the next.
ARG COMMIT_SHA=unknown
RUN printf '{"commit":"%s","builtAt":"%s"}\n' "$COMMIT_SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > build-info.json

ENV NODE_ENV=production
# The public hosted product promises no server-side storage — a plain
# `docker run` of this image (Cloud Run included) must never turn into a
# single shared document every visitor reads and writes (see
# server/src/app.js's own PERSISTENCE_DISABLED). Override to a falsy value
# only for a private, single-user deployment where that's actually wanted.
ENV NODIGRAPH_DISABLE_PERSISTENCE=true
EXPOSE 8080

CMD ["node", "server/src/app.js"]
