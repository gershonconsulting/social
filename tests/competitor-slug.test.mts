import assert from "node:assert/strict";
import * as M0 from "../src/lib/competitors/slug-core.ts";
const M = ((M0 as any).default ?? M0) as typeof M0;
const freeClientSlug = M.pickFreeSlug;

const used = new Set(["10x-genomics", "10x-genomics-2"]);
const taken = async (s: string) => used.has(s);
assert.equal(await freeClientSlug("vizgen", taken), "vizgen");
assert.equal(await freeClientSlug("10x-genomics", taken), "10x-genomics-3");
const all = async () => true;
assert.match(await freeClientSlug("x", all), /^x-[a-z0-9]{1,6}$/);
console.log("competitor-slug: all assertions passed");
