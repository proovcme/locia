FROM php:8.4-fpm-alpine

RUN apk add --no-cache curl libzip libzip-dev oniguruma-dev \
    && docker-php-ext-install pdo_mysql mbstring zip opcache \
    && apk del libzip-dev oniguruma-dev

WORKDIR /app
COPY --chown=www-data:www-data apps/lemma/ /app/
RUN mkdir -p /app/storage/logs /app/storage/throttle /app/storage/uploads /app/storage/revit-models /app/storage/revit-uploads \
    && chown -R www-data:www-data /app/storage \
    && chmod +x /app/deploy/work/entrypoint.sh

USER www-data
EXPOSE 9000

ENTRYPOINT ["/app/deploy/work/entrypoint.sh"]
