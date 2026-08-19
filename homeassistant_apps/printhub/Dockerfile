# Bootstrap the Debian trust store without disabling TLS verification.
# The slim image may not contain a usable system CA bundle, while APT is forced to HTTPS.
# Copy the CA bundle from the full official Node Bookworm image first, then continue on slim.
FROM node:20-bookworm AS printhub-ca-bootstrap

# Build the architecture-native CUPS raster filter from source. This restores
# the original XP-365B PPD pipeline (application/vnd.cups-raster) on amd64,
# aarch64 and armv7 without shipping an opaque vendor ELF binary.
FROM node:20-bookworm-slim AS cups-filter-build
COPY --from=printhub-ca-bootstrap /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY src/native/rastertosnailtspl-xprinter.c /tmp/rastertosnailtspl-xprinter.c
RUN set -eux; \
    if [ -f /etc/apt/sources.list ]; then \
      sed -ri -e 's|http://deb.debian.org|https://deb.debian.org|g' -e 's|http://security.debian.org|https://security.debian.org|g' /etc/apt/sources.list; \
    fi; \
    if [ -d /etc/apt/sources.list.d ]; then \
      find /etc/apt/sources.list.d -type f -print0 | xargs -0 -r sed -ri -e 's|http://deb.debian.org|https://deb.debian.org|g' -e 's|http://security.debian.org|https://security.debian.org|g'; \
    fi; \
    apt-get update; \
    apt-get install -y --no-install-recommends build-essential libcups2-dev ca-certificates; \
    cc -O2 -pipe -Wall -Wextra -Werror -std=c11 /tmp/rastertosnailtspl-xprinter.c -lcups -o /usr/local/bin/rastertosnailtspl-xprinter; \
    strip /usr/local/bin/rastertosnailtspl-xprinter

FROM node:20-bookworm-slim

COPY --from=printhub-ca-bootstrap /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

ARG BUILD_VERSION
ARG BUILD_ARCH

LABEL \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="app" \
  io.hass.arch="${BUILD_ARCH}"

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LC_ALL=C \
    LANG=C

WORKDIR /app

# Home Assistant hosts/networks may block plain HTTP/80 while HTTPS/443 is available.
# Debian slim images currently ship APT sources that can still reference http://deb.debian.org.
# Force all Debian repositories to HTTPS and make transient repository failures retryable.
RUN set -eux; \
    if [ -f /etc/apt/sources.list ]; then \
      sed -ri \
        -e 's|http://deb.debian.org|https://deb.debian.org|g' \
        -e 's|http://security.debian.org|https://security.debian.org|g' \
        /etc/apt/sources.list; \
    fi; \
    if [ -d /etc/apt/sources.list.d ]; then \
      find /etc/apt/sources.list.d -type f -print0 \
        | xargs -0 -r sed -ri \
          -e 's|http://deb.debian.org|https://deb.debian.org|g' \
          -e 's|http://security.debian.org|https://security.debian.org|g'; \
    fi; \
    printf '%s\n' \
      'Acquire::Retries "6";' \
      'Acquire::ForceIPv4 "true";' \
      'Acquire::http::Timeout "30";' \
      'Acquire::https::Timeout "45";' \
      'Acquire::http::Pipeline-Depth "0";' \
      > /etc/apt/apt.conf.d/80-printhub-network; \
    test -s /etc/ssl/certs/ca-certificates.crt; \
    rm -rf /var/lib/apt/lists/*; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      cups \
      cups-client \
      cups-bsd \
      cups-filters \
      cups-filters-core-drivers \
      ghostscript \
      poppler-utils \
      python3 \
      jq \
      dbus \
      avahi-utils \
      libnss-mdns \
      usbutils \
      tini \
      curl; \
    update-ca-certificates; \
    rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY web ./web
COPY rootfs/ /
COPY --from=cups-filter-build /usr/local/bin/rastertosnailtspl-xprinter /usr/lib/cups/filter/rastertosnailtspl-xprinter
COPY run.sh /run.sh

RUN chmod 0755 \
      /run.sh \
      /usr/lib/cups/filter/rastertosnailtspl-xprinter \
      /usr/lib/cups/filter/printhub-pdf-pass \
      /usr/lib/cups/backend/printhubproxy \
 && mkdir -p /run/cups /var/spool/cups /var/cache/cups /data/cups/config /data/cups/log

EXPOSE 631/tcp 8099/tcp 35994/tcp

HEALTHCHECK --interval=30s --timeout=8s --start-period=30s --retries=3 \
  CMD lpstat -r 2>/dev/null | grep -q "scheduler is running" \
      && curl -fsS http://127.0.0.1:8099/api/health >/dev/null \
      || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/run.sh"]
