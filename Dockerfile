FROM oven/bun:1.3.11-alpine

WORKDIR /usr/src/app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . ./

RUN bun run build

ARG PORT
ENV PORT=$PORT
ENV NODE_ENV=production
EXPOSE $PORT

CMD ["sh", "-c", "bun --bun dist/main"]