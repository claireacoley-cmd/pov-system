# POV System — Setup & Deployment

## One-time setup

### 1. Create the data repo on GitHub

Create a **private** repo called `pov-system-data` on your GitHub account.

Then create these folders by adding a placeholder file in each:
- `beliefs/`
- `proof/`
- `craft/`
- `inbox/`
- `content/`

Easiest way: create `beliefs/.gitkeep`, `proof/.gitkeep`, etc. via GitHub UI.

### 2. Seed data (optional)

The `seed/` folder contains 6 beliefs, 10 proof items, 5 craft items.
Copy them into the data repo manually or push via git.

### 3. Create a GitHub Personal Access Token

Go to GitHub → Settings → Developer Settings → Personal Access Tokens → Fine-grained tokens.

Scopes needed: **Contents** (read + write) on the `pov-system-data` repo.

Save the token — you'll need it for Netlify.

### 4. Deploy to Netlify

1. Push this repo (`pov-system`) to a GitHub repo (can be public — no secrets in code)
2. Go to [netlify.com](https://netlify.com) → New site → Import from GitHub → select `pov-system`
3. Build settings: Build command = (leave empty), Publish directory = `.`
4. Click Deploy

### 5. Set Netlify environment variables

In Netlify dashboard → Site settings → Environment variables:

| Key | Value |
|-----|-------|
| `GITHUB_OWNER` | Your GitHub username (e.g. `clairecoley`) |
| `GITHUB_REPO` | `pov-system-data` |
| `GITHUB_BRANCH` | `main` |
| `GITHUB_TOKEN` | Your fine-grained PAT from step 3 |

After adding vars, redeploy (Deploys → Trigger deploy).

---

## Mac auto-sync (optional but recommended)

To keep `.md` files available to Claude on your Mac, set up an auto-pull.

### Clone the data repo

```bash
cd ~/HQ/data
git clone https://github.com/clairecoley/pov-system-data.git
```

### Create the sync script

Create `/Users/clairecoley/HQ/sync-pov-data.sh`:
```bash
#!/bin/bash
cd /Users/clairecoley/HQ/data/pov-system-data
git pull origin main >> /tmp/pov-sync.log 2>&1
```

Make it executable: `chmod +x ~/HQ/sync-pov-data.sh`

### Set up launchd to run every 30 min

Create `~/Library/LaunchAgents/com.clairecoley.pov-sync.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.clairecoley.pov-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/clairecoley/HQ/sync-pov-data.sh</string>
  </array>
  <key>StartInterval</key>
  <integer>1800</integer>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
```

Load it:
```bash
launchctl load ~/Library/LaunchAgents/com.clairecoley.pov-sync.plist
```

---

## Architecture summary

```
Browser → Netlify (pov-system repo)
              ↓
     Netlify Functions (items.js, inbox.js, content.js)
              ↓
     GitHub API (pov-system-data repo)
              ↓
     .md files in beliefs/ proof/ craft/ inbox/ content/
              ↓
     Mac launchd pulls every 30min → Claude can read files
```

---

## File locations once deployed

Your data lives in GitHub at: `github.com/clairecoley/pov-system-data`

On your Mac (after sync): `~/HQ/data/pov-system-data/`

Each item is a `.md` file with YAML frontmatter — Claude can read these directly.
