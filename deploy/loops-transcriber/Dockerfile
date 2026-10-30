# The Loops transcriber: whisper.cpp + ffmpeg + the small Node process that feeds it (scripts/loops-transcriber.mjs).
# Built on the server (arm64) by scripts/ship-loops-transcriber.sh from a clean checkout of main; the build context holds only
# package files, this Dockerfile and the scripts the process imports.
#
# Build jobs default to 1: the production VM has 2 OCPU shared with Mongo and the workers, and nobody is waiting for this build.

FROM debian:bookworm-slim AS whisper
ARG WHISPER_REF=v1.9.5
ARG JOBS=1
# ggml-small.en.bin (English only, about 465 MB), pinned by checksum.
ARG MODEL_SHA256=c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "${WHISPER_REF}" https://github.com/ggml-org/whisper.cpp /src
WORKDIR /src
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF \
  && cmake --build build -j"${JOBS}" --target whisper-cli
RUN curl -fL --retry 3 -o /ggml-small.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin \
  && echo "${MODEL_SHA256}  /ggml-small.en.bin" | sha256sum -c -

FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgomp1 && rm -rf /var/lib/apt/lists/*
COPY --from=whisper /src/build/bin/whisper-cli /opt/whisper/whisper-cli
COPY --from=whisper /ggml-small.en.bin /opt/whisper/ggml-small.en.bin
WORKDIR /app
COPY package.json package-lock.json ./
# mongodb and dotenv are devDependencies in this repo (the dashboard image installs them the same way), so no --omit=dev.
RUN npm ci --ignore-scripts
COPY scripts ./scripts
ENV NODE_ENV=production \
    LOOPS_TRANSCRIBER=whisper-cpp \
    LOOPS_WHISPER_BIN=/opt/whisper/whisper-cli \
    LOOPS_WHISPER_MODEL=/opt/whisper/ggml-small.en.bin \
    TMPDIR=/tmp
USER 1001:1001
CMD ["node", "scripts/loops-transcriber.mjs"]
