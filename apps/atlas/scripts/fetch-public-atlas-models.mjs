import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const lock = JSON.parse(await readFile(join(root, "public-models.lock.json"), "utf8"));
const destination = join(root, "standalone/public-models");
await mkdir(destination, { recursive: true });

function sourceUrl(path) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/buildingSMART/Sample-Test-Files/${lock.commit}/${encodedPath}`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function splitStepArguments(body) {
  const args = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "'") {
      if (quoted && body[index + 1] === "'") {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && char === "(") {
      depth += 1;
    } else if (!quoted && char === ")") {
      depth -= 1;
    } else if (!quoted && depth === 0 && char === ",") {
      args.push(body.slice(start, index).trim());
      start = index + 1;
    }
  }
  args.push(body.slice(start).trim());
  return args;
}

function sanitizeFileNameHeader(source) {
  return source.replace(/FILE_NAME\s*\(([\s\S]*?)\);/gi, (_statement, body) => {
    const args = splitStepArguments(body);
    if (args.length !== 7) throw new Error(`Unexpected IFC FILE_NAME field count: ${args.length}`);
    args[2] = "('')";
    args[3] = "('')";
    return `FILE_NAME(${args.join(",")});`;
  });
}

function sanitizeIfc(bytes) {
  const source = new TextDecoder().decode(bytes);
  const sanitized = sanitizeFileNameHeader(source).replace(
    /^(\s*#\d+\s*=\s*IFCPERSON)\([^;]*\);$/gm,
    "$1($,$,$,$,$,$,$,$);",
  );
  if (/IFCPERSON\s*\(\s*(?:'|")/i.test(sanitized)) {
    throw new Error("IFC person metadata was not sanitized");
  }
  if (!/FILE_NAME\s*\([^;]*,\(''\),\(''\),/i.test(sanitized.replace(/\s+/g, ""))) {
    throw new Error("IFC FILE_NAME author metadata was not sanitized");
  }
  return new TextEncoder().encode(sanitized);
}

for (const model of lock.models) {
  const response = await fetch(sourceUrl(model.path), { headers: { Accept: "application/octet-stream" } });
  if (!response.ok) throw new Error(`buildingSMART download failed for ${model.file}: ${response.status}`);
  const source = new Uint8Array(await response.arrayBuffer());
  if (source.byteLength !== model.bytes) throw new Error(`Unexpected size for ${model.file}: ${source.byteLength}`);
  if (sha256(source) !== model.sha256) throw new Error(`Checksum mismatch for ${model.file}`);
  const sanitized = sanitizeIfc(source);
  const target = join(destination, model.file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, sanitized);
  console.log(`Prepared ${model.file}: ${sanitized.byteLength} bytes`);
}
