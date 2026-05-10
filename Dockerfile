FROM node:24-alpine AS webbuilder

COPY . /ai-diving
RUN apk update \
    && apk add git make \
    && cd /ai-diving/admin \
    && npm install --force \
    && npm run build


FROM rust:1.95.0 AS builder

# Accept GIT_COMMIT_ID as build argument
ARG GIT_COMMIT_ID

COPY --from=webbuilder /ai-diving /ai-diving

# Write the GIT_COMMIT_ID to configs/commit_id.txt
RUN echo "$GIT_COMMIT_ID" | cut -c1-7 > /ai-diving/configs/commit_id.txt

RUN apt update \
    && apt install -y cmake ca-certificates nasm curl --no-install-recommends

RUN cd /ai-diving \
    && cat configs/commit_id.txt \
    && make release \
    && ls -lh target/release

FROM ubuntu:24.04

COPY --from=builder /etc/ssl /etc/ssl
COPY --from=builder /ai-diving/target/release/ai-diving /usr/local/bin/ai-diving
COPY --from=builder /ai-diving/entrypoint.sh /entrypoint.sh

CMD ["ai-diving"]

ENTRYPOINT ["/entrypoint.sh"]
