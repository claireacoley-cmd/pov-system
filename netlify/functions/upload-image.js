// Netlify Function: upload-image
// Commits an image to static/images/ in the pov-system repo
// Returns the served path: /static/images/filename.jpg

const TOKEN  = process.env.GITHUB_TOKEN;
const OWNER  = process.env.GITHUB_OWNER;
const BRANCH = process.env.GITHUB_BRANCH || "main";
const REPO   = "pov-system"; // main repo, not data repo

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json",
  "X-GitHub-Api-Version": "2022-11-28"
};

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: "Method not allowed" };

  try {
    const { imageData, filename } = JSON.parse(event.body);

    if (!imageData || !filename) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Missing imageData or filename" }) };
    }

    // Strip the data:image/...;base64, prefix if present
    const base64 = imageData.includes(",") ? imageData.split(",")[1] : imageData;

    // Sanitise filename and make unique with timestamp
    const ext = filename.split(".").pop().toLowerCase() || "jpg";
    const slug = filename
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
    const uniqueName = `${slug}-${Date.now()}.${ext}`;
    const path = `static/images/${uniqueName}`;

    // Commit to GitHub
    const res = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`,
      {
        method: "PUT",
        headers: HEADERS,
        body: JSON.stringify({
          message: `Add image: ${uniqueName}`,
          content: base64,
          branch: BRANCH
        })
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GitHub API error: ${res.status} ${err}`);
    }

    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ url: `/${path}` })
    };

  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
