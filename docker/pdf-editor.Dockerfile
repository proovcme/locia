FROM node:22-alpine AS frontend
WORKDIR /build
COPY apps/pdf-editor/package.json apps/pdf-editor/package-lock.json ./
RUN npm ci
COPY apps/pdf-editor/index.html apps/pdf-editor/vite.config.js ./
COPY apps/pdf-editor/src ./src
COPY apps/pdf-editor/profiles ./profiles
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PDF_EDITOR_STATIC_ROOT=/app/dist
WORKDIR /app
COPY apps/pdf-editor/requirements.txt ./requirements.txt
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir -r requirements.txt \
    && useradd --create-home --uid 10001 pdfeditor
COPY apps/pdf-editor/engine ./engine
COPY apps/pdf-editor/server ./server
COPY --from=frontend /build/dist ./dist
USER 10001:10001
EXPOSE 8000
CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
