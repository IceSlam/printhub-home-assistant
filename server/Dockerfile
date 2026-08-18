FROM node:20-bookworm-slim AS webapp-build
WORKDIR /build/webapp
COPY webapp/package*.json ./
RUN npm install
COPY webapp ./
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates poppler-utils \
  && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY --from=webapp-build /build/public ./public
EXPOSE 8080
CMD ["npm", "start"]
