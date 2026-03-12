// Netlify Function: inbox
// Handles CRUD for thinking inbox markdown files

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

function toFrontmatter(obj) {
  const lines = ["---"];
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      if (v.length === 0) { lines.push(`${k}: []`); }
      else { lines.push(`${k}:`); v.forEach(i => lines.push(`  - ${JSON.stringify(i)}`)); }
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
      if (val === "[]") { meta[key] = []; i++; continue; }
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
    } else if (val === "null") { meta[key] = null; }
    else if (val === "true") { meta[key] = true; }
    else if (val === "false") { meta[key] = false; }
    else if (val.startsWith('"') && val.endsWith('"')) { meta[key] = val.slice(1, -1); }
    else { meta[key] = val; }
    i++;
  }
  return { meta, body: match[2].trim() };
}

function inboxToMarkdown(item) {
  const path = `inbox/${item.id}.md`;

  // Store conversation as base64 to avoid any markdown/comment escaping issues
  const convB64 = Buffer.from(JSON.stringify(item.conversation || []), "utf8").toString("base64");

  const meta = {
    type: "inbox",
    id: item.id,
    title: item.title,
    status: item.status || "new",
    source: item.source || "manual",
    created: item.created || new Date().toISOString().slice(0, 10),
    outputs: item.outputs || [],
    content_ideas: item.contentIdeas || [],
    conversation_b64: convB64
  };

  if (item.agreedOutput) meta.agreed_output = item.agreedOutput;

  const body = [
    toFrontmatter(meta),
    "",
    "## Raw Dump",
    "",
    item.raw || ""
  ].join("\n");

  return { path, body };
}

function markdownToInbox(path, content) {
  const { meta, body } = parseFrontmatter(content);

  // Extract raw dump
  const rawMatch = body.match(/## Raw Dump\n\n([\s\S]*?)(?=\n## |$)/);
  const raw = rawMatch ? rawMatch[1].trim() : body.replace(/^## Raw Dump\n\n/, "").trim();

  // Decode conversation — supports new base64 format and old HTML comment format
  let conversation = [];
  if (meta.conversation_b64) {
    try {
      conversation = JSON.parse(Buffer.from(meta.conversation_b64, "base64").toString("utf8"));
    } catch (e) { conversation = []; }
  } else {
    // Legacy: HTML comment format
    const convMatch = content.match(/<!-- conversation-json: ([\s\S]*?) -->/);
    if (convMatch) {
      try { conversation = JSON.parse(convMatch[1]); } catch (e) { conversation = []; }
    }
  }

  return {
    id: meta.id || path.split("/").pop().replace(".md", ""),
    title: meta.title || "",
    status: meta.status || "new",
    source: meta.source || "manual",
    created: meta.created || null,
    outputs: meta.outputs || [],
    contentIdeas: meta.content_ideas || [],
    agreedOutput: meta.agreed_output || null,
    raw,
    conversation
  };
}

async function ghGet(path) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`;
  const res = await fetch(url, { headers: HEADERS });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${path}: ${res.status}`);
  return res.json();
}

async function ghPut(path, content, sha, message) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  const body = { message, content: Buffer.from(content, "utf8").toString("base64"), branch: BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(url, { method: "PUT", headers: HEADERS, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`GitHub PUT ${path}: ${res.status}`);
  return res.json();
}

async function ghDelete(path, sha, message) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: HEADERS,
    body: JSON.stringify({ message, sha, branch: BRANCH })
  });
  if (!res.ok) throw new Error(`GitHub DELETE: ${res.status}`);
}

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };

  try {
    const method = event.httpMethod;
    const params = event.queryStringParameters || {};

    if (method === "GET") {
      const data = await ghGet("inbox");
      if (!data || !Array.isArray(data)) return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: "[]" };
      const items = [];
      for (const file of data.filter(f => f.name.endsWith(".md"))) {
        const fd = await ghGet(file.path);
        if (fd?.content) {
          const content = Buffer.from(fd.content, "base64").toString("utf8");
          items.push(markdownToInbox(file.path, content));
        }
      }
      return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify(items) };
    }

    if (method === "POST") {
      const item = JSON.parse(event.body);
      const { path, body } = inboxToMarkdown(item);
      await ghPut(path, body, null, `Inbox: ${item.title}`);
      return { statusCode: 201, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, id: item.id }) };
    }

    if (method === "PUT") {
      const item = JSON.parse(event.body);
      const { path, body } = inboxToMarkdown(item);
      const existing = await ghGet(path);
      await ghPut(path, body, existing?.sha, `Update inbox: ${item.title}`);
      return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
    }

    if (method === "DELETE") {
      const { id } = params;
      const path = `inbox/${id}.md`;
      const existing = await ghGet(path);
      if (!existing) return { statusCode: 404, headers: cors, body: "Not found" };
      await ghDelete(path, existing.sha, `Archive inbox: ${id}`);
      return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers: cors, body: "Method not allowed" };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: err.message }) };
  }
};
