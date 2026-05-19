/**
 * Google Sheets API client for the Cloudflare Pages edge runtime.
 *
 * Uses a Google service account (RS256-signed JWT → access_token →
 * Sheets API) so no OAuth user consent is needed. The service account's
 * JSON key is stored as a single env var GOOGLE_SHEETS_SVC_JSON.
 *
 * The PB source spreadsheet (https://docs.google.com/spreadsheets/d/1YpDcoQHF…)
 * needs to be shared with the service account's `client_email` as Editor
 * for writes to land.
 *
 * Why we sign the JWT here instead of using google-auth-library: the
 * latter pulls in Node-only deps that don't run in Workers. Web Crypto
 * is the supported path on the edge.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

interface ServiceAccountJSON {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function readSvcAccount(): ServiceAccountJSON | null {
  const raw = process.env.GOOGLE_SHEETS_SVC_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ServiceAccountJSON;
  } catch {
    return null;
  }
}

function base64UrlEncode(input: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof input === "string") bytes = new TextEncoder().encode(input);
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else bytes = input;
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(cleaned);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function getAccessToken(svc: ServiceAccountJSON): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: svc.client_email,
    scope: SCOPE,
    aud: svc.token_uri || TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const unsigned =
    base64UrlEncode(JSON.stringify(header)) + "." + base64UrlEncode(JSON.stringify(claim));

  const keyBuf = pemToArrayBuffer(svc.private_key);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBuf,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );
  const jwt = unsigned + "." + base64UrlEncode(sig);

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });
  const r = await fetch(svc.token_uri || TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Google token exchange ${r.status}: ${t.slice(0, 300)}`);
  }
  const j = (await r.json()) as { access_token?: string };
  if (!j.access_token) throw new Error("Google token response missing access_token");
  return j.access_token;
}

export interface SheetTab {
  name: string;
  range: string; // e.g. "LinkedIn!A:D" — for clear+rewrite
  rows: string[][];
}

/**
 * Replace the contents of one or more tabs in a spreadsheet.
 * Clears the range first, then writes the fresh rows starting at A1.
 */
export async function syncSpreadsheet(
  spreadsheetId: string,
  tabs: SheetTab[]
): Promise<{ ok: boolean; error?: string; perTab?: Array<{ name: string; rowsWritten: number }> }> {
  const svc = readSvcAccount();
  if (!svc) return { ok: false, error: "GOOGLE_SHEETS_SVC_JSON env var not set" };

  let token: string;
  try {
    token = await getAccessToken(svc);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "auth failed" };
  }
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const perTab: Array<{ name: string; rowsWritten: number }> = [];
  for (const tab of tabs) {
    try {
      // Clear
      const clearUrl = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(tab.range)}:clear`;
      const cr = await fetch(clearUrl, { method: "POST", headers, body: "{}" });
      if (!cr.ok) {
        const t = await cr.text().catch(() => "");
        return { ok: false, error: `clear ${tab.name} HTTP ${cr.status}: ${t.slice(0, 200)}` };
      }
      // Write — values starting at A1 of the tab
      const writeUrl = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(tab.name + "!A1")}?valueInputOption=RAW`;
      const wr = await fetch(writeUrl, {
        method: "PUT",
        headers,
        body: JSON.stringify({ values: tab.rows }),
      });
      if (!wr.ok) {
        const t = await wr.text().catch(() => "");
        return { ok: false, error: `write ${tab.name} HTTP ${wr.status}: ${t.slice(0, 200)}` };
      }
      perTab.push({ name: tab.name, rowsWritten: tab.rows.length });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : `tab ${tab.name} failed` };
    }
  }
  return { ok: true, perTab };
}

/**
 * Append a single row to a tab.
 */
export async function appendRow(
  spreadsheetId: string,
  tabName: string,
  row: string[]
): Promise<{ ok: boolean; error?: string }> {
  const svc = readSvcAccount();
  if (!svc) return { ok: false, error: "GOOGLE_SHEETS_SVC_JSON env var not set" };
  let token: string;
  try {
    token = await getAccessToken(svc);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "auth failed" };
  }
  const url = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(tabName + "!A:Z")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [row] }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return { ok: false, error: `append ${tabName} HTTP ${r.status}: ${t.slice(0, 200)}` };
  }
  return { ok: true };
}

export const PB_SPREADSHEET_ID = "1YpDcoQHF-g-TakXG8EHdMymXfVBvXRP1gLF1FqX-V9c";
