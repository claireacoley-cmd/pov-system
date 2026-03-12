// Netlify Function: items
// Handles CRUD for beliefs, proof, craft markdown files
// Environment vars: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH

const OWNER  = process.env.GITHUB_OWNER;
const REPO   = process.env.GITHUB_REPO;
const BRANCH = process.env.GITHUB_BRANCH || "main";
const TOKEN  = process.env.GITHUB_TOKEN;

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json",
  "X-GitHub-Api-Version": "2022-11-28"
};

const FOLDERS = { belief: "beliefs", proof: "proof", craft: "craft", teaching: "teaching" };

// ── FRONTMATTER ──────────────────────────────────────────────

function toFrontmatter(obj) {
  const lines = ["---"];
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
      } else {
        lines.push(`${k}:`);
        v.forEach(item => lines.push(`  - ${JSON.stringify(item)}`));
      }
    } else if (v === null || v === undefined) {
      lines.push(`${k}: null`);
    } else if (typeof v === "string" && (v.includes(":") || v.includes("#") || v.includes('"'))) {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta = {};
  const yamlLines = match[1].split("\n");
  let i = 0;

  while (i < yamlLines.length) {
    const line = yamlLines[i];
    const keyMatch = line.match(/^(\w+):\s*(.*)/);
    if (!keyMatch) { i++; continue; }

    const key = keyMatch[1];
    const val = keyMatch[2].trim();

    if (val === "" || val === "[]") {
      // Check if next lines are array items
      if (val === "[]") {
        meta[key] = [];
        i++;
        continue;
      }
      const arr = [];
      i++;
      while (i < yamlLines.length && yamlLines[i].startsWith("  - ")) {
        let item = yamlLines[i].slice(4).trim();
        if (item.startsWith('"') && item.endsWith('"')) item = item.slice(1, -1);
        arr.push(item);
        i++;
      }
      meta[key] = arr;
      continue;
    } else if (val === "null") {
      meta[key] = null;
    } else if (val === "true") {
      meta[key] = true;
    } else if (val === "false") {
      meta[key] = false;
    } else if (!isNaN(val) && val !== "") {
      meta[key] = Number(val);
    } else if (val.startsWith('"') && val.endsWith('"')) {
      meta[key] = val.slice(1, -1);
    } else {
      meta[key] = val;
    }
    i++;
  }

  return { meta, body: match[2].trim() };
}

function itemToMarkdown(item) {
  const primaryFunc = item.functions?.[0] || "proof";
  const folder = FOLDERS[primaryFunc] || "proof";
  const filename = item.id + ".md";
  const path = `${folder}/${filename}`;

  const meta = {
    type: primaryFunc,
    id: item.id,
    title: item.title,
    functions: item.functions || [primaryFunc],
    domains: item.domains || [],
    created: item.created || new Date().toISOString().slice(0, 10),
    keywords: item.keywords || []
  };

  if (item.status)         meta.status = item.status;
  if (item.linkedIds)      meta.linked_ids = item.linkedIds;
  if (item.supportsBelief) meta.supports_beliefs = item.supportsBelief;
  if (item.relatedBelief)  meta.related_beliefs = item.relatedBelief;
  if (item.sourceType)     meta.source_type = item.sourceType;
  if (item.source)         meta.source = item.source;
  if (item.whySaved)       meta.why_saved = item.whySaved;
  if (item.principle)      meta.principle = item.principle;
  if (item.image)          meta.image = item.image;

  const body = `${toFrontmatter(meta)}\n\n${item.body || ""}`;
  return { path, body };
}

function markdownToItem(path, content) {
  const { meta, body } = parseFrontmatter(content);
  return {
    id: meta.id || path.split("/").pop().replace(".md", ""),
    functions: meta.functions || [meta.type || "proof"],
    title: meta.title || "",
    body,
    status: meta.status || null,
    domains: meta.domains || [],
    keywords: meta.keywords || [],
    linkedIds: meta.linked_ids || [],
    supportsBelief: meta.supports_beliefs || [],
    relatedBelief: meta.related_beliefs || [],
    sourceType: meta.source_type || null,
    source: meta.source || null,
    whySaved: meta.why_saved || null,
    principle: meta.principle || null,
    image: meta.image || null,
    created: meta.created || null
  };
}

// ── GITHUB API ────────────────────────────────────────────────

async function ghGet(path) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`;
  const res = await fetch(url, { headers: HEADERS });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${path}: ${res.status}`);
  return res.json();
}

async function ghPut(path, content, sha, message) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  const body = {
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch: BRANCH
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, { method: "PUT", headers: HEADERS, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub PUT ${path}: ${res.status} ${err}`);
  }
  return res.json();
}

async function ghDelete(path, sha, message) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: HEADERS,
    body: JSON.stringify({ message, sha, branch: BRANCH })
  });
  if (!res.ok) throw new Error(`GitHub DELETE ${path}: ${res.status}`);
  return res.json();
}

async function listFolder(folder) {
  const data = await ghGet(folder);
  if (!data || !Array.isArray(data)) return [];

  const items = [];
  for (const file of data.filter(f => f.name.endsWith(".md"))) {
    const fileData = await ghGet(file.path);
    if (fileData && fileData.content) {
      const content = Buffer.from(fileData.content, "base64").toString("utf8");
      items.push(markdownToItem(file.path, content));
    }
  }
  return items;
}

// ── HANDLER ───────────────────────────────────────────────────

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors };
  }

  try {
    const method = event.httpMethod;
    const params = event.queryStringParameters || {};

    // ── GET: list all items ──
    if (method === "GET") {
      const [beliefs, proof, craft, teaching] = await Promise.all([
        listFolder("beliefs"),
        listFolder("proof"),
        listFolder("craft"),
        listFolder("teaching")
      ]);
      return {
        statusCode: 200,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify([...beliefs, ...proof, ...craft, ...teaching])
      };
    }

    // ── POST: create item ──
    if (method === "POST") {
      const item = JSON.parse(event.body);
      const { path, body } = itemToMarkdown(item);
      await ghPut(path, body, null, `Add: ${item.title}`);
      return {
        statusCode: 201,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true, id: item.id })
      };
    }

    // ── PUT: update item ──
    if (method === "PUT") {
      const item = JSON.parse(event.body);
      const { path, body } = itemToMarkdown(item);
      const existing = await ghGet(path);
      const sha = existing?.sha;
      await ghPut(path, body, sha, `Update: ${item.title}`);
      return {
        statusCode: 200,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true })
      };
    }

    // ── DELETE: delete item ──
    if (method === "DELETE") {
      const { id, type } = params;
      const folder = FOLDERS[type] || "proof";
      const path = `${folder}/${id}.md`;
      const existing = await ghGet(path);
      if (!existing) return { statusCode: 404, headers: cors, body: "Not found" };
      await ghDelete(path, existing.sha, `Delete: ${id}`);
      return {
        statusCode: 200,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true })
      };
    }

    return { statusCode: 405, headers: cors, body: "Method not allowed" };

  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
