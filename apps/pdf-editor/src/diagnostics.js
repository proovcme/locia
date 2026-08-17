export const PUBLIC_UPLOAD_LIMIT_BYTES = 24 * 1024 * 1024;
export const DESKTOP_DOWNLOAD_URL = "https://github.com/proovcme/locia/releases/download/pdf-editor-v0.0.1/Locia-PDF-Editor-0.0.1-Windows-x64.exe";

function formatMegabytes(bytes) {
  const value = bytes / (1024 * 1024);
  return `${Number.isInteger(value) ? value : value.toFixed(1)} МБ`;
}

export function validateUploadFiles(files) {
  const totalBytes = files.reduce((sum, file) => sum + Number(file?.size || 0), 0);
  if (totalBytes <= PUBLIC_UPLOAD_LIMIT_BYTES) return { ok: true, totalBytes };

  return {
    ok: false,
    code: "UPLOAD_LIMIT",
    stage: files.length === 1 ? "Проверка файла" : "Проверка комплекта",
    message: `Размер ${files.length === 1 ? "файла" : "комплекта"} — ${formatMegabytes(totalBytes)}, лимит публичного редактора — 24 МБ.`,
    hint: "Сожмите или разделите комплект либо используйте настольную версию для Windows.",
    totalBytes,
  };
}

export function describeHttpFailure(status, payload = {}, requestId = "") {
  if (status === 413) {
    return {
      code: "HTTP_413",
      stage: "Загрузка файла",
      message: "Файл или комплект превышает лимит публичного редактора — 24 МБ.",
      hint: "Сожмите или разделите комплект либо используйте настольную версию для Windows.",
      requestId,
      status,
    };
  }

  return {
    code: `HTTP_${status}`,
    stage: "Обработка запроса",
    message: payload.error || payload.detail || `Сервер вернул HTTP ${status}.`,
    hint: "Повторите попытку. Если ошибка сохранится, скопируйте журнал обработки.",
    requestId,
    status,
  };
}

export function displayFileName(path) {
  return String(path || "document.pdf").split(/[\\/]/).pop() || "document.pdf";
}

export function toDiagnosticError(description) {
  return Object.assign(new Error(description.message), description);
}

export function buildDiagnosticReport(progress) {
  const lines = [
    "PDF-редактор locia.work — журнал обработки",
    `Всего: ${progress?.total || 0}; успешно: ${progress?.completed || 0}; ошибок: ${progress?.failed || 0}`,
  ];
  for (const item of progress?.results || []) {
    lines.push("");
    lines.push(`${item.ok ? "УСПЕХ" : "ОШИБКА"}: ${displayFileName(item.input)}`);
    if (item.stage) lines.push(`Этап: ${item.stage}`);
    if (item.code) lines.push(`Код: ${item.code}`);
    if (item.error) lines.push(`Сообщение: ${item.error}`);
    if (item.hint) lines.push(`Что делать: ${item.hint}`);
    if (item.requestId) lines.push(`ID запроса: ${item.requestId}`);
    if (Number.isFinite(item.durationMs)) lines.push(`Время: ${(item.durationMs / 1000).toFixed(1)} с`);
  }
  return lines.join("\n");
}
