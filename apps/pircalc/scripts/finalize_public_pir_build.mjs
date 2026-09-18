import { rename } from "node:fs/promises";

await rename("dist-public/public-pir.html", "dist-public/index.html");
