FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p data

ENV NODE_ENV=production
ENV HEALTH_PORT=4090
EXPOSE 4090

# Render sets PORT; loadConfig prefers it over HEALTH_PORT
CMD ["npx", "tsx", "src/cli.ts", "run"]
