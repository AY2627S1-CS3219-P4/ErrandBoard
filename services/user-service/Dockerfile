FROM node:22-alpine AS build

WORKDIR /app

COPY services/user-service/package*.json ./
RUN npm ci

COPY services/user-service/tsconfig.json ./
COPY services/user-service/src ./src

RUN npm run build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY services/user-service/package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY data/csv/user-seed-data.csv ./seed/user-seed-data.csv

EXPOSE 3001

CMD ["node", "dist/index.js"]
