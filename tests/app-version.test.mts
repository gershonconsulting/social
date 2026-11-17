// APP_VERSION (home-page + dashboard footer) must equal package.json version.
import { readFileSync } from "node:fs";
import * as ev from "../src/lib/extension-version";
const APP_VERSION = (ev as any).APP_VERSION ?? (ev as any).default?.APP_VERSION;
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
if (APP_VERSION !== pkg.version) {
  console.error(`FAIL: APP_VERSION ${APP_VERSION} != package.json ${pkg.version}`);
  process.exit(1);
}
console.log(`ok: APP_VERSION ${APP_VERSION} == package.json`);
