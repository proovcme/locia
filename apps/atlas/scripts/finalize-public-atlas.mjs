import { cp, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "dist-public-atlas");
const modelLock = JSON.parse(await readFile(join(root, "public-models.lock.json"), "utf8"));

await rename(join(dist, "public-atlas.html"), join(dist, "index.html"));
await mkdir(join(dist, "fragments"), { recursive: true });
await mkdir(join(dist, "web-ifc"), { recursive: true });
await mkdir(join(dist, "models/buildingsmart"), { recursive: true });

await cp(
  join(root, "node_modules/@thatopen/fragments/dist/Worker/worker.mjs"),
  join(dist, "fragments/worker.mjs"),
);
for (const name of await readdir(join(root, "node_modules/web-ifc"))) {
  if (name.endsWith(".wasm")) {
    await cp(join(root, "node_modules/web-ifc", name), join(dist, "web-ifc", name));
  }
}
await cp(join(root, "standalone/favicon.svg"), join(dist, "favicon.svg"));
for (const model of modelLock.models) {
  const target = join(dist, "models/buildingsmart", model.file);
  await mkdir(dirname(target), { recursive: true });
  await cp(
    join(root, "standalone/public-models", model.file),
    target,
  );
}
await cp(
  join(root, "public-atlas-attribution.txt"),
  join(dist, "models/buildingsmart/ATTRIBUTION.txt"),
);
await writeFile(
  join(dist, "models/buildingsmart/catalog.json"),
  JSON.stringify(
    {
      repository: modelLock.repository,
      commit: modelLock.commit,
      license: modelLock.license,
      models: modelLock.models.map(({ id, label, group, file, default: isDefault }) => ({
        id,
        label,
        group,
        url: `models/buildingsmart/${file}`,
        default: Boolean(isDefault),
      })),
    },
    null,
    2,
  ),
);

const files = [];
async function walk(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = join(prefix, entry.name);
    if (entry.isDirectory()) await walk(join(directory, entry.name), relative);
    else files.push(relative);
  }
}
await walk(dist);

const allowedIfc = new Set(modelLock.models.map((model) => join("models/buildingsmart", model.file)));
const forbiddenExtensions = /\.(?:bat|cmd|ifczip|map|md|ps1|zip)$/i;
const forbiddenNames = /(?:readme|install|standalone)/i;
for (const file of files) {
  if (forbiddenExtensions.test(file) || forbiddenNames.test(file)) {
    throw new Error(`Forbidden public Atlas artifact: ${file}`);
  }
  if (/\.ifc$/i.test(file) && !allowedIfc.has(file)) {
    throw new Error(`Unapproved public IFC artifact: ${file}`);
  }
}

const textFiles = files.filter((file) => /\.(?:css|html|js|json|mjs|svg)$/i.test(file));
const content = (
  await Promise.all(textFiles.map((file) => readFile(join(dist, file), "utf8")))
).join("\n");
for (const marker of [
  "ЛОЦИЯ АТЛАС",
  "Лоция Атлас",
  "/tasks/new",
  "ifc-sample/",
  "/Users/",
  "C:\\Users\\",
  "@example.local",
  "IFCPERSON('",
  "IFCPERSON(\"",
]) {
  if (content.includes(marker)) throw new Error(`Private marker leaked into public Atlas: ${marker}`);
}
for (const marker of ["АТЛАС", "models/buildingsmart/catalog.json", "buildingSMART · CC BY 4.0"]) {
  if (!content.includes(marker)) throw new Error(`Public Atlas marker is missing: ${marker}`);
}

for (const model of modelLock.models) {
  const ifc = await readFile(join(dist, "models/buildingsmart", model.file), "utf8");
  if (/IFCPERSON\s*\(\s*(?:'|")/i.test(ifc) || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(ifc)) {
    throw new Error(`Personal marker leaked into public IFC: ${model.file}`);
  }
}

console.log(`Public Atlas bundle audit passed: ${files.length} files`);
