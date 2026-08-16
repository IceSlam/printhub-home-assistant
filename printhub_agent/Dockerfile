FROM node:20-bookworm-slim

ARG BUILD_VERSION
ARG BUILD_ARCH

LABEL \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="app" \
  io.hass.arch="${BUILD_ARCH}"

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
      ca-certificates \
      cups-client \
      poppler-utils \
      tini \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "start"]
