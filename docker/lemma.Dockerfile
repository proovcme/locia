FROM php:8.4-cli-alpine

RUN apk add --no-cache sqlite-libs sqlite-dev \
    && docker-php-ext-install pdo_sqlite \
    && apk del sqlite-dev

WORKDIR /app
COPY --chown=www-data:www-data apps/lemma/ /app/
RUN mkdir -p /data /app/storage/logs /app/storage/throttle /app/storage/uploads \
    && chown -R www-data:www-data /data /app/storage

USER www-data
EXPOSE 8080

CMD ["/bin/sh", "/app/deploy/demo/run-demo.sh"]
