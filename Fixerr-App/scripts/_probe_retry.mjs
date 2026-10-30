import { readFile, writeFile } from "node:fs/promises";
const SITE = "https://www.urbancompany.com", API = "https://www.urbanclap.com/api/v2";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const r0 = await fetch(`${SITE}/chennai`, { headers: { "User-Agent": UA } });
const H = { "User-Agent": UA, Accept: "application/json, text/plain, */*", "Content-Type": "application/json", "X-device-os": "desktop_web", "X-device-id": `v-${Math.floor(Date.now() / 1000)}`, "X-version-name": "web_v4.273.58", "X-version-code": "4.273.58", "X-brand-key": "urbanCompany", "x-preferred-language": "english", "react-bundle-version": "890", "X-Session-ID": crypto.randomUUID(), Origin: SITE, Referer: `${SITE}/chennai`, Cookie: r0.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const rg = async (latitude, longitude) => { for (let a = 1; a <= 6; a++) { const r = await fetch(API + "/growth/locations/reverseGeoCode", { method: "POST", headers: H, body: JSON.stringify({ coordinate: { latitude, longitude } }) }).catch(() => null); if (r?.ok) return (await r.json()).success?.data; await sleep(r?.status === 429 ? 15000 * a : 3000 * a); } return { err: "Error: 429" }; };
const parse = (t) => { const [h, ...rows] = t.replace(/^\uFEFF/, "").split(/\r\n/); const cols = h.split(","); return { cols, rows: rows.map((l) => { const v = []; let cur = "", q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ",") { v.push(cur); cur = ""; } else cur += ch; } v.push(cur); return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? ""])); }) }; };
const FILE = "scripts/output/_uc-chennai-grid.csv";
const { cols, rows } = parse(await readFile(FILE, "utf8"));
const todo = rows.filter((r) => r.live === "");
console.log(todo.length, "points to retry");
let n = 0;
for (const r of todo) {
  const d = await rg(+r.lat, +r.lng); const L = d?.location;
  const comp = (t) => L?.address_components?.find((c) => c.types.includes(t))?.long_name ?? "";
  Object.assign(r, { live: d?.isUcLive ?? "", cityKey: L?.cityKey ?? "", pincode: L?.postalCode || comp("postal_code"), district: comp("administrative_area_level_2") || comp("administrative_area_level_3"), locality: L?.locality || comp("locality"), address: L?.formattedAddress ?? "", err: d?.err ?? (d?.isUcLive ? "" : d?.error?.errorMessage?.heading ?? "") });
  if (++n % 25 === 0) { console.log(n); await writeFile(FILE, "\uFEFF" + [cols.join(","), ...rows.map((x) => cols.map((c) => { const s = String(x[c] ?? ""); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(","))].join("\r\n"), "utf8"); }
  await sleep(1200);
}
await writeFile(FILE, "\uFEFF" + [cols.join(","), ...rows.map((x) => cols.map((c) => { const s = String(x[c] ?? ""); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(","))].join("\r\n"), "utf8");
const by = {}; for (const r of rows) { const k = `${r.live}|${r.cityKey}`; by[k] = (by[k] ?? 0) + 1; } console.log(by);
