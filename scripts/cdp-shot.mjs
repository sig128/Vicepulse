// Decode a saved CDP Page.captureScreenshot response into a PNG: node scripts/cdp-shot.mjs <response.json> <out.png>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [src, out] = process.argv.slice(2);
if (!src || !out) throw new Error("usage: cdp-shot.mjs <response.json> <out.png>");
const raw = JSON.parse(readFileSync(src, "utf8"));
const data = raw.data ?? raw.result?.data;
if (!data) throw new Error("no screenshot data in response");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(data, "base64"));
console.log(`${out} ${Buffer.from(data, "base64").length} bytes`);
