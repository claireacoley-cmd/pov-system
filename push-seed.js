// One-shot script to push seed data to live POV System API
// Run: node push-seed.js

const fs = require("fs");
const path = require("path");

// Change this to your live Netlify URL
const BASE_URL = "https://melodious-sunburst-8e3e37.netlify.app/api/items";

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  const meta = {};
  const yamlLines = match[1].split("\n");
  let i = 0;
  while (i < yamlLines.length) {
    const line = yamlLines[i];
    const keyMatch = line.match(/^(\w+):\s*(.*)/);
    if (!keyMatch) { i++; continue; }
    const key = keyMatch[1]; const val = keyMatch[2].trim();
    if (val === "" || val === "[]") {
      if (val === "[]") { meta[key] = []; i++; continue; }
      const arr = []; i++;
      while (i < yamlLines.length && yamlLines[i].startsWith("  - ")) {
        let item = yamlLines[i].slice(4).trim();
        if (item.startsWith('"') && item.endsWith('"')) item = item.slice(1, -1);
        arr.push(item); i++;
      }
      meta[key] = arr; continue;
    } else if (val === "null") { meta[key] = null; }
    else if (val.startsWith('"') && val.endsWith('"')) { meta[key] = val.slice(1, -1); }
    else { meta[key] = val; }
    i++;
  }
  return { meta, body: match[2].trim() };
}

function mdToItem(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const parsed = parseFrontmatter(content);
  if (!parsed) return null;
  const { meta, body } = parsed;

  const item = {
    id:        meta.id,
    functions: meta.functions || [meta.type],
    title:     meta.title,
    body:      body || meta.title,
    domains:   meta.domains || ["Strategy"],
    keywords:  meta.keywords || [],
    created:   meta.created || new Date().toISOString().slice(0,10)
  };

  if (meta.status)         item.status       = meta.status;
  if (meta.linked_ids)     item.linkedIds    = meta.linked_ids;
  if (meta.supports_beliefs) item.supportsBelief = meta.supports_beliefs;
  if (meta.related_belief) item.relatedBelief = meta.related_belief;
  if (meta.source)         item.source       = meta.source;
  if (meta.source_type)    item.sourceType   = meta.source_type;
  if (meta.why_saved)      item.whySaved     = meta.why_saved;
  if (meta.principle)      item.principle    = meta.principle;
  if (item.functions.includes("belief")) item.linkedIds = item.linkedIds || [];

  return item;
}

async function push(item) {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item)
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status}: ${txt}`);
  }
  return res.json();
}

async function main() {
  const seedDir = path.join(__dirname, "seed");
  const folders = ["beliefs", "proof", "craft"];
  const allItems = [];

  for (const folder of folders) {
    const dir = path.join(seedDir, folder);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".md"));
    for (const f of files) {
      const item = mdToItem(path.join(dir, f));
      if (item) allItems.push(item);
    }
  }

  console.log(`Pushing ${allItems.length} items...`);
  let ok = 0, fail = 0;
  for (const item of allItems) {
    try {
      await push(item);
      console.log(`  ✓ ${item.id} — ${item.title}`);
      ok++;
    } catch(e) {
      console.log(`  ✗ ${item.id} — ${e.message}`);
      fail++;
    }
  }
  console.log(`\nDone: ${ok} saved, ${fail} failed`);
}

main().catch(console.error);
