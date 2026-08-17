from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import secrets
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any

import pymupdf
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles


ROOT = Path(__file__).resolve().parents[1]
STATIC_ROOT = Path(os.environ.get("PDF_EDITOR_STATIC_ROOT", ROOT / "dist"))
WORKER = ROOT / "server" / "worker.py"
MAX_TOTAL_BYTES = 24 * 1024 * 1024
MAX_FILES = 20
MAX_PAGES_PER_PDF = 160
MAX_PREVIEW_BYTES = 8 * 1024 * 1024
ALLOWED_FLAGS = {"--inspect-json", "--inspect-rule-json", "--inspect-page-json", "--job-json"}
ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".ttf", ".otf", ".ttc"}
PDF_MAGIC = b"%PDF-"
worker_slot = asyncio.Semaphore(1)
logger = logging.getLogger("locia.pdf_editor")

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def request_diagnostics(request: Request, call_next):
    raw_request_id = request.headers.get("X-Client-Request-Id", "")
    request_id = raw_request_id if re.fullmatch(r"[A-Za-z0-9._-]{8,80}", raw_request_id) else f"pdf-{secrets.token_hex(8)}"
    started_at = time.monotonic()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("pdf_request_failed request_id=%s status=500 path=%s", request_id, request.url.path)
        raise
    response.headers["X-Request-Id"] = request_id
    if request.url.path.endswith("/api/run"):
        log = logger.warning if response.status_code >= 400 else logger.info
        log(
            "pdf_request_finished request_id=%s status=%d bytes=%s duration_ms=%d",
            request_id,
            response.status_code,
            request.headers.get("content-length", "unknown"),
            round((time.monotonic() - started_at) * 1000),
        )
    return response


def clean_name(value: str, fallback: str) -> str:
    name = Path(str(value).replace("\\", "/")).name
    name = re.sub(r"[^0-9A-Za-zА-Яа-яЁё._ -]+", "_", name).strip(" .")
    return name[:120] or fallback


def file_extension(virtual_path: str) -> str:
    return Path(virtual_path.split("?", 1)[0]).suffix.lower()


def validate_magic(extension: str, data: bytes) -> None:
    if extension == ".pdf" and not data.startswith(PDF_MAGIC):
        raise HTTPException(400, "Файл с расширением PDF не является PDF-документом")
    if extension == ".png" and not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise HTTPException(400, "Некорректный PNG-файл")
    if extension in {".jpg", ".jpeg"} and not data.startswith(b"\xff\xd8\xff"):
        raise HTTPException(400, "Некорректный JPEG-файл")
    if extension in {".ttf", ".otf", ".ttc"} and data[:4] not in {b"\x00\x01\x00\x00", b"OTTO", b"ttcf"}:
        raise HTTPException(400, "Некорректный файл шрифта")


def validate_pdf(path: Path) -> None:
    try:
        document = pymupdf.open(path)
        try:
            if document.needs_pass:
                raise HTTPException(400, "Защищённые паролем PDF в демо не поддерживаются")
            if len(document) > MAX_PAGES_PER_PDF:
                raise HTTPException(413, f"В демо допускается не более {MAX_PAGES_PER_PDF} страниц в одном PDF")
            if len(document) < 1:
                raise HTTPException(400, "PDF не содержит страниц")
        finally:
            document.close()
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(400, f"Не удалось открыть PDF: {error}") from error


def rewrite_paths(value: Any, mapping: dict[str, str]) -> Any:
    if isinstance(value, str):
        return mapping.get(value, value)
    if isinstance(value, list):
        return [rewrite_paths(item, mapping) for item in value]
    if isinstance(value, dict):
        return {key: rewrite_paths(item, mapping) for key, item in value.items()}
    return value


def required_source_paths(flag: str, request: dict[str, Any]) -> list[str]:
    paths = [str(request.get("input_pdf", ""))]
    if flag == "--job-json":
        for operation in request.get("page_operations", []):
            if operation.get("source_pdf"):
                paths.append(str(operation["source_pdf"]))
        for rule in request.get("rules", []):
            action = rule.get("action", {})
            if action.get("image_path"):
                paths.append(str(action["image_path"]))
            if action.get("style", {}).get("font_file"):
                paths.append(str(action["style"]["font_file"]))
    return [path for path in paths if path]


def run_worker(request_path: Path, response_path: Path) -> None:
    subprocess.run(
        [sys.executable, str(WORKER), str(request_path), str(response_path)],
        cwd=request_path.parent,
        check=False,
        timeout=50,
        env={"PATH": os.environ.get("PATH", ""), "PYTHONPATH": str(ROOT / "engine"), "PYTHONUNBUFFERED": "1"},
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def collect_result_artifacts(result: dict[str, Any], output_name: str, workdir: Path) -> list[dict[str, str]]:
    output_path = Path(str(result.get("output_pdf", "")))
    extracted = [Path(path) for path in result.get("extracted_files", []) if Path(path).is_file()]
    downloads: list[dict[str, str]] = []
    if output_path.is_file() and not extracted:
        downloads.append({
            "name": output_name,
            "mime": "application/pdf",
            "data": base64.b64encode(output_path.read_bytes()).decode("ascii"),
        })
    elif output_path.is_file():
        archive = workdir / f"{Path(output_name).stem}-result.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
            bundle.write(output_path, output_name)
            for path in extracted:
                bundle.write(path, clean_name(path.name, "extract.pdf"))
            report_path = Path(str(result.get("report_path", "")))
            if report_path.is_file():
                bundle.write(report_path, "report.json")
        downloads.append({
            "name": archive.name,
            "mime": "application/zip",
            "data": base64.b64encode(archive.read_bytes()).decode("ascii"),
        })
    return downloads


def collect_previews(result: dict[str, Any]) -> list[dict[str, Any]]:
    preview_dir = Path(str(result.get("preview_dir", "")))
    if not preview_dir.is_dir():
        return []
    pages: list[dict[str, Any]] = []
    total = 0
    for index, path in enumerate(sorted(preview_dir.glob("page-*.png"))[:12], start=1):
        data = path.read_bytes()
        if total + len(data) > MAX_PREVIEW_BYTES:
            break
        total += len(data)
        pages.append({"page": index, "src": f"data:image/png;base64,{base64.b64encode(data).decode('ascii')}"})
    return pages


def scrub_temporary_paths(value: Any, workdir: Path) -> Any:
    marker = str(workdir)
    if isinstance(value, str):
        return value.replace(marker, "[temporary]")
    if isinstance(value, list):
        return [scrub_temporary_paths(item, workdir) for item in value]
    if isinstance(value, dict):
        return {key: scrub_temporary_paths(item, workdir) for key, item in value.items()}
    return value


@app.get("/api/health")
@app.get("/pdf-editor/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/run")
@app.post("/pdf-editor/api/run")
async def run(
    payload: str = Form(...),
    virtual_paths: str = Form(...),
    files: list[UploadFile] = File(default=[]),
) -> JSONResponse:
    try:
        envelope = json.loads(payload)
        paths = json.loads(virtual_paths)
    except json.JSONDecodeError as error:
        raise HTTPException(400, "Некорректный запрос") from error
    args = envelope.get("args", [])
    if not isinstance(args, list) or len(args) != 2 or args[0] not in ALLOWED_FLAGS or not isinstance(args[1], dict):
        raise HTTPException(400, "Неподдерживаемая команда")
    if not isinstance(paths, list) or len(paths) != len(files) or len(files) > MAX_FILES:
        raise HTTPException(400, "Некорректный список файлов")

    try:
        await asyncio.wait_for(worker_slot.acquire(), timeout=2)
    except TimeoutError as error:
        raise HTTPException(429, "PDF-движок занят; повторите через несколько секунд") from error

    try:
        with tempfile.TemporaryDirectory(prefix="locia-pdf-") as temporary:
            workdir = Path(temporary)
            mapping: dict[str, str] = {}
            total_bytes = 0
            for index, (virtual_path, upload) in enumerate(zip(paths, files, strict=True)):
                if not isinstance(virtual_path, str) or virtual_path in mapping:
                    raise HTTPException(400, "Некорректный идентификатор файла")
                extension = file_extension(virtual_path)
                if extension not in ALLOWED_EXTENSIONS:
                    raise HTTPException(400, f"Тип файла {extension or '(без расширения)'} не поддерживается")
                data = await upload.read(MAX_TOTAL_BYTES + 1)
                total_bytes += len(data)
                if total_bytes > MAX_TOTAL_BYTES:
                    raise HTTPException(413, "Общий размер файлов превышает 24 МБ")
                validate_magic(extension, data)
                target = workdir / f"upload-{index:02d}{extension}"
                target.write_bytes(data)
                if extension == ".pdf":
                    validate_pdf(target)
                mapping[virtual_path] = str(target)

            flag, raw_request = args
            missing = [path for path in required_source_paths(flag, raw_request) if path not in mapping]
            if missing:
                raise HTTPException(400, "Один из исходных файлов не был передан")
            request = rewrite_paths(raw_request, mapping)
            output_name = "result.pdf"
            if flag == "--job-json":
                output_name = clean_name(str(raw_request.get("output_pdf", "result.pdf")), "result.pdf")
                if not output_name.lower().endswith(".pdf"):
                    output_name += ".pdf"
                request["output_pdf"] = str(workdir / "result.pdf")
                request["make_previews"] = bool(request.get("make_previews", True))

            request_path = workdir / "request.json"
            response_path = workdir / "response.json"
            request_path.write_text(json.dumps({"flag": flag, "request": request}, ensure_ascii=False), encoding="utf-8")
            try:
                await asyncio.to_thread(run_worker, request_path, response_path)
            except subprocess.TimeoutExpired as error:
                raise HTTPException(408, "Обработка PDF превысила лимит времени") from error
            if not response_path.is_file():
                raise HTTPException(500, "PDF-движок не вернул результат")
            result = json.loads(response_path.read_text(encoding="utf-8"))
            if not result.get("ok"):
                raise HTTPException(422, clean_name(str(result.get("error", "Ошибка обработки")), "Ошибка обработки PDF"))

            downloads = collect_result_artifacts(result, output_name, workdir) if flag == "--job-json" else []
            result["preview_pages"] = collect_previews(result) if flag == "--job-json" else []
            result["downloads"] = downloads
            result["input_pdf"] = clean_name(str(raw_request.get("input_pdf", "document.pdf")), "document.pdf")
            if flag == "--job-json":
                result["output_pdf"] = output_name
                result["report_path"] = "report.json"
                result["extracted_files"] = [clean_name(path, "extract.pdf") for path in result.get("extracted_files", [])]
                result["preview_dir"] = None
            return JSONResponse(scrub_temporary_paths(result, workdir), headers={"Cache-Control": "no-store"})
    finally:
        worker_slot.release()


app.mount("/pdf-editor", StaticFiles(directory=STATIC_ROOT, html=True), name="static-prefixed")
app.mount("/", StaticFiles(directory=STATIC_ROOT, html=True), name="static")
