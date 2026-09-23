/**
 * Rebuild public/gershonai-extension.zip from the overrides in extension-src/.
 *
 * WHY A PATCH AND NOT A SOURCE TREE. The extension ships as a zip committed to
 * the repo, and the icons inside it are PNGs. The tooling that writes to this
 * repository sends file contents as text, so a binary file cannot be replaced
 * through it — which means the zip has to stay, and the icons have to keep
 * coming out of it. So this reads the committed zip, replaces the entries that
 * extension-src/ provides, adds any that are new, and writes it back. Files
 * nobody overrides pass through byte for byte.
 *
 * Entries are written STORED (no compression). A zip of a hundred kilobytes of
 * JavaScript does not need deflate, and stored entries keep this script short
 * enough to read in one sitting, which matters more for something that runs on
 * every deploy.
 *
 * It fails soft: if anything goes wrong the committed zip ships unchanged — an
 * older extension that still collects through the untokened fallback — rather
 * than taking the deploy down with it.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { inflateRawSync } from "node:zlib";

const ZIP_PATH = "public/gershonai-extension.zip";
const SRC_DIR = "extension-src";

/* ---------- read ---------- */

/** Every entry of a zip, as { name, data }, via the central directory. */
function readZip(buf) {
  // End of central directory: signature 0x06054b50, scanned from the back
  // because the comment field is variable length.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory entry");
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    // The local header repeats the name/extra lengths, and they can differ
    // from the central directory's, so read the payload offset from there.
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressedSize);

    entries.push({
      name,
      data: method === 0 ? Buffer.from(raw) : inflateRawSync(raw),
    });

    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/* ---------- write ---------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function writeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const data = e.data;
    const crc = crc32(data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date — 1 Jan 2000, so builds are reproducible
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

/* ---------- patch ---------- */

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

try {
  const original = readZip(readFileSync(ZIP_PATH));
  const byName = new Map(original.map((e) => [e.name, e]));

  let replaced = 0;
  let added = 0;
  for (const file of walk(SRC_DIR)) {
    const name = relative(SRC_DIR, file).split(sep).join("/");
    const data = readFileSync(file);
    if (byName.has(name)) replaced++;
    else added++;
    byName.set(name, { name, data });
  }

  // Keep the original ordering, then anything new, so diffs stay legible.
  const ordered = [
    ...original.map((e) => byName.get(e.name)),
    ...[...byName.values()].filter((e) => !original.some((o) => o.name === e.name)),
  ];

  writeFileSync(ZIP_PATH, writeZip(ordered));
  console.log(
    `extension: ${ordered.length} files (${replaced} replaced, ${added} added) -> ${ZIP_PATH}`,
  );
} catch (err) {
  console.warn(
    "extension: could not patch the zip, shipping the committed one as-is — " +
      (err && err.message ? err.message : String(err)),
  );
}
