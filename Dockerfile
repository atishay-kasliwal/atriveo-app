# Portable AC resume compiler — Node + Tectonic, no Mac drive or Mongo.
# Use the musl Tectonic binary so bookworm (glibc 2.36) can run CI builds.
FROM --platform=linux/amd64 node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    fontconfig \
    libfontconfig1 \
    libgraphite2-3 \
    libharfbuzz0b \
    libicu72 \
    libssl3 \
  && curl -fsSL -o /tmp/tectonic.tgz \
    "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.16.9/tectonic-0.16.9-x86_64-unknown-linux-musl.tar.gz" \
  && tar -xzf /tmp/tectonic.tgz -C /usr/local/bin \
  && chmod +x /usr/local/bin/tectonic \
  && rm /tmp/tectonic.tgz \
  && apt-get purge -y curl \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/* \
  && tectonic --version

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY data ./data
COPY scripts ./scripts

ENV CI=1
ENV NODE_ENV=production
ENV AC_PDF_OUT=/tmp/ac-ci-out
ENV ARTIFACTS_ROOT=/tmp/artifacts

CMD ["node", "scripts/ac-ci-verify.mjs"]
