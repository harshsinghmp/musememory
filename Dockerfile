FROM oven/bun:1.3.14-alpine AS base
WORKDIR /app

COPY package.json ./
RUN bun install --frozen-lockfile || bun install

COPY . .

# Run test suite and static type check in build phase
RUN bun test
RUN bunx tsc --noEmit

# Global link for CLI
RUN bun link

ENTRYPOINT ["musememory"]
CMD ["mcp"]
