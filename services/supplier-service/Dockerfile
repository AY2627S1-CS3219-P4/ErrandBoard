FROM node:22-alpine AS build

WORKDIR /app

COPY services/supplier-service/package*.json ./
RUN npm ci

COPY services/supplier-service/tsconfig.json ./
COPY services/supplier-service/src ./src

RUN npm run build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY services/supplier-service/package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY data/csv/supplier-seed-data.csv ./seed/supplier-seed-data.csv

EXPOSE 3002

CMD ["node", "dist/index.js"]
