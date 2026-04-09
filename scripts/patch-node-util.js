#!/usr/bin/env node
/**
 * Post-build patch: replaces `require("node:util")` module wrappers in
 * compiled edge chunks with an inline stub that includes inspect.custom,
 * fixing the openid-client class definition error in the Next.js edge runtime.
 */
const fs = require("fs");
const path = require("path");

const NEXT_SERVER = path.join(__dirname, "../.next/server");

// The stub to inline instead of require("node:util")
// Uses a module pattern to avoid leaking variables
const STUB_BODY = [
  '"use strict";',
  'var _c=typeof Symbol.for==="function"?Symbol.for("nodejs.util.inspect.custom"):Symbol("nodejs.util.inspect.custom");',
  'function _inspect(o){return String(o);}',
  '_inspect.custom=_c;_inspect.colors={};_inspect.styles={};_inspect.defaultOptions={};',
  'e.exports={',
  '  inspect:_inspect,',
  '  format:function(){return Array.prototype.slice.call(arguments).map(String).join(" ");},',
  '  inherits:function(c,s){Object.setPrototypeOf(c.prototype,s.prototype);},',
  '  promisify:function(fn){return function(){var a=Array.prototype.slice.call(arguments);return new Promise(function(res,rej){a.push(function(err,r){err?rej(err):res(r);});fn.apply(this,a);});};},',
  '  TextDecoder:typeof TextDecoder!=="undefined"?TextDecoder:undefined,',
  '  TextEncoder:typeof TextEncoder!=="undefined"?TextEncoder:undefined,',
  '  types:{isUint8Array:function(v){return v instanceof Uint8Array;},isNativeError:function(v){return v instanceof Error;}}',
  '};',
].join("");

// Match the module wrapper: e=>{"use strict";e.exports=require("node:util")}
const PATTERN = /e=>\{"use strict";e\.exports=require\("node:util"\)\}/g;
const REPLACEMENT = `e=>{${STUB_BODY}}`;

let patchCount = 0;

function patchDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      patchDir(full);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".js") &&
      !entry.name.endsWith(".map.js")
    ) {
      const content = fs.readFileSync(full, "utf8");
      if (content.includes('require("node:util")')) {
        const patched = content.replace(PATTERN, REPLACEMENT);
        if (patched !== content) {
          fs.writeFileSync(full, patched, "utf8");
          console.log(`Patched: ${path.relative(NEXT_SERVER, full)}`);
          patchCount++;
        }
      }
    }
  }
}

patchDir(NEXT_SERVER);
console.log(`Done. Patched ${patchCount} file(s).`);
