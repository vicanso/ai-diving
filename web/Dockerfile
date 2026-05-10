FROM node:24-alpine AS webbuilder

COPY . /ai-diving-web
RUN apk update \
    && apk add git make \
    && cd /ai-diving-web \
    && npm install --force \
    && npm run build


FROM vicanso/static

COPY --from=webbuilder /ai-diving-web/dist /static

EXPOSE 3000

CMD ["static-serve"]

ENTRYPOINT ["/entrypoint.sh"]
