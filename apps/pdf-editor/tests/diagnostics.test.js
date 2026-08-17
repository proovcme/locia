import assert from "node:assert/strict";
import test from "node:test";

const diagnostics = await import("../src/diagnostics.js").catch(() => ({}));

test("publishes a stable Windows desktop installer URL", () => {
  assert.equal(
    diagnostics.DESKTOP_DOWNLOAD_URL,
    "https://github.com/proovcme/locia/releases/download/pdf-editor-v0.0.1/Locia-PDF-Editor-0.0.1-Windows-x64.exe",
  );
});

test("rejects a PDF larger than the public upload limit before the request starts", () => {
  const validateUploadFiles = diagnostics.validateUploadFiles || (() => ({ ok: true }));
  const result = validateUploadFiles([{ name: "large.pdf", size: 68 * 1024 * 1024 }]);

  assert.equal(result.ok, false);
  assert.equal(result.code, "UPLOAD_LIMIT");
  assert.equal(result.stage, "Проверка файла");
  assert.match(result.message, /68 МБ/);
  assert.match(result.message, /24 МБ/);
  assert.match(result.hint, /настольную версию/i);
});

test("turns an empty HTTP 413 response into an actionable upload error", () => {
  const describeHttpFailure = diagnostics.describeHttpFailure || ((status) => ({ code: `HTTP_${status}`, message: `HTTP ${status}` }));
  const result = describeHttpFailure(413, {}, "request-413");

  assert.equal(result.code, "HTTP_413");
  assert.equal(result.stage, "Загрузка файла");
  assert.equal(result.requestId, "request-413");
  assert.doesNotMatch(result.message, /^HTTP 413$/);
  assert.match(result.message, /24 МБ/);
  assert.match(result.hint, /настольную версию/i);
});

test("shows the server detail instead of replacing it with a generic HTTP code", () => {
  const result = diagnostics.describeHttpFailure(422, { detail: "В выбранном диапазоне нет страниц" }, "request-422");

  assert.equal(result.message, "В выбранном диапазоне нет страниц");
  assert.equal(result.status, 422);
});

test("builds a copyable report with the file, stage, code, message and request id", () => {
  const buildDiagnosticReport = diagnostics.buildDiagnosticReport || (() => "Ошибок: 1");
  const report = buildDiagnosticReport({
    total: 1,
    completed: 0,
    failed: 1,
    results: [{
      input: "upload://private-id/project-set.pdf",
      ok: false,
      code: "HTTP_413",
      stage: "Загрузка файла",
      error: "Размер превышает лимит 24 МБ.",
      hint: "Разделите комплект.",
      requestId: "request-413",
      durationMs: 3210,
    }],
  });

  assert.match(report, /project-set\.pdf/);
  assert.match(report, /Загрузка файла/);
  assert.match(report, /HTTP_413/);
  assert.match(report, /Размер превышает лимит 24 МБ/);
  assert.match(report, /Разделите комплект/);
  assert.match(report, /request-413/);
  assert.doesNotMatch(report, /private-id/);
});

test("preserves structured diagnostics when an operation throws", () => {
  const toDiagnosticError = diagnostics.toDiagnosticError || ((description) => new Error(description.message));
  const error = toDiagnosticError({
    code: "HTTP_422",
    stage: "PDF-движок",
    message: "В выбранном диапазоне нет страниц",
    hint: "Проверьте диапазон страниц.",
    requestId: "request-422",
    status: 422,
  });

  assert.equal(error.message, "В выбранном диапазоне нет страниц");
  assert.equal(error.code, "HTTP_422");
  assert.equal(error.stage, "PDF-движок");
  assert.equal(error.hint, "Проверьте диапазон страниц.");
  assert.equal(error.requestId, "request-422");
  assert.equal(error.status, 422);
});
