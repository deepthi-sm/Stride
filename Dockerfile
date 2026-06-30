# Multi-stage build: build the client, then run the server serving its dist.

# --- Stage 1: build the client ---
FROM node:20-slim AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# --- Stage 2: server runtime ---
FROM node:20-slim AS server
ENV NODE_ENV=production
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --omit=dev
COPY server/ ./
# Prompt files the agent reads at runtime (prompts/parse.md, etc.).
COPY prompts/ /app/prompts/
# Bring in the built client so Express can serve /client/dist.
COPY --from=client-build /app/client/dist /app/client/dist

ENV PORT=8080
EXPOSE 8080
CMD ["node", "index.js"]
