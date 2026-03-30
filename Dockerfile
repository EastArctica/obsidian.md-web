FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build:selfhosted

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV VITE_OBSIDIAN_TARGET=selfhosted
ENV OBSIDIAN_VAULT_ROOT=/data/vaults
ENV PORT=4173

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/vite.config.js ./vite.config.js
COPY --from=build /app/server ./server

RUN mkdir -p /data/vaults

EXPOSE 4173

CMD ["npm", "run", "preview:selfhosted"]
