# poller/Dockerfile
# Node 22+ required: @supabase/supabase-js resolved to a version whose
# package.json declares engines.node >= 22 (found during Task 2 review).
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

CMD ["npx", "tsx", "src/index.ts"]
