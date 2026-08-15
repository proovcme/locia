const filesByPath = new Map();
const folders = new Map();

function safeName(value, fallback = "file") {
  const name = String(value || "").split(/[\\/]/).pop().replace(/[\u0000-\u001f<>:"|?*]+/g, "_").trim();
  return name || fallback;
}

function extensionAccept(filters = []) {
  const extensions = filters.flatMap((filter) => filter.extensions || []);
  return extensions.length ? extensions.map((extension) => `.${extension}`).join(",") : "";
}

function chooseFiles({ multiple = false, directory = false, filters = [] } = {}) {
  return new Promise((resolve) => {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.multiple = Boolean(multiple || directory);
    picker.accept = directory ? ".pdf,application/pdf" : extensionAccept(filters);
    if (directory) picker.setAttribute("webkitdirectory", "");
    picker.hidden = true;
    document.body.append(picker);

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      picker.remove();
      resolve(value);
    };
    picker.addEventListener("change", () => finish(Array.from(picker.files || [])), { once: true });
    window.addEventListener("focus", () => setTimeout(() => finish([]), 300), { once: true });
    picker.click();
  });
}

function registerFile(file, prefix = "upload") {
  const path = `${prefix}://${crypto.randomUUID()}/${safeName(file.name)}`;
  filesByPath.set(path, file);
  return path;
}

export async function open(options = {}) {
  const chosen = await chooseFiles(options);
  if (!chosen.length) return null;
  if (options.directory) {
    const folderPath = `folder://${crypto.randomUUID()}`;
    const paths = chosen
      .filter((file) => file.name.toLowerCase().endsWith(".pdf"))
      .map((file, index) => {
        const path = `${folderPath}/${String(index).padStart(3, "0")}-${safeName(file.name)}`;
        filesByPath.set(path, file);
        return path;
      });
    folders.set(folderPath, paths);
    return folderPath;
  }
  const paths = chosen.map((file) => registerFile(file));
  return options.multiple ? paths : paths[0];
}

export async function save({ defaultPath = "result.pdf" } = {}) {
  const suggested = safeName(defaultPath, "result.pdf");
  const entered = window.prompt("Имя скачиваемого файла", suggested);
  if (entered === null) return null;
  return `download://${crypto.randomUUID()}/${safeName(entered, suggested)}`;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeName(name, "result.bin");
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function collectFilePaths(value, found = new Set()) {
  if (typeof value === "string") {
    if (filesByPath.has(value)) found.add(value);
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFilePaths(item, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectFilePaths(item, found);
  }
  return found;
}

async function runEngine(args) {
  const flag = args?.[0];
  const request = JSON.parse(args?.[1] || "{}");
  const paths = [...collectFilePaths(request)];
  const form = new FormData();
  form.append("payload", JSON.stringify({ args: [flag, request] }));
  form.append("virtual_paths", JSON.stringify(paths));
  for (const path of paths) form.append("files", filesByPath.get(path), safeName(filesByPath.get(path).name));

  const response = await fetch(new URL("api/run", document.baseURI), {
    method: "POST",
    body: form,
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const result = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
  if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);

  for (const artifact of result.downloads || []) {
    downloadBlob(new Blob([decodeBase64(artifact.data)], { type: artifact.mime || "application/octet-stream" }), artifact.name);
  }
  const cleanResult = { ...result };
  delete cleanResult.downloads;
  return { code: 0, stdout: JSON.stringify(cleanResult), stderr: "" };
}

export async function invoke(command, parameters = {}) {
  if (command === "list_pdf_files") return folders.get(parameters.folder) || [];
  if (command === "read_text_file") {
    const file = filesByPath.get(parameters.path);
    if (!file) throw new Error("Файл профиля недоступен");
    return file.text();
  }
  if (command === "write_text_file") {
    downloadBlob(new Blob([parameters.contents], { type: "application/json;charset=utf-8" }), safeName(parameters.path, "pdf-profile.json"));
    return null;
  }
  if (command === "run_engine") return runEngine(parameters.args || []);
  throw new Error(`Неизвестная web-команда: ${command}`);
}
