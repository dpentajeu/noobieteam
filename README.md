# Noobieteam: The Next Gen Productivity Platform

<img width="3420" height="1970" alt="image" src="https://github.com/user-attachments/assets/5f328eab-e0ec-4c14-bb51-f3f4744e50d3" />

**Noobieteam** is a powerful, open-source Next Gen Productivity Platform designed for modern teams. It is an all-in-one Kanban application that seamlessly manages tasks, securely stores credentials, builds technical documentation, tests APIs, and integrates AI assistance—all within a single, highly collaborative workspace.

Forget jumping between Jira for tasks, 1Password for secrets, GitBook for docs, and Postman for API. Noobieteam brings it all together with an "Instagram-style" minimalist UI.

---

## 🚀 Key Features

### 📋 High-Fidelity Kanban Board
- **Intuitive Organization:** Drag-and-drop cards, custom columns, and real-time state updates.
- **Jira-Style Backlog:** High-density vertical list view designed for rapid task prioritization and seamless transition into the active Sprint/To Do columns.
- **Real-Time Card Locking:** Socket.IO broadcasts a lock the moment someone opens a card, so a second editor gets a read-only view naming the holder instead of a silent overwrite. Locks expire after 10 minutes and are released on disconnect.
- **In-Card Collaboration:** Rich text editing (Quill), file attachments, due dates, urgency tags, and a real-time `@mention` commenting system.
- **Bulk Operations:** Multi-select archive, move, and reorder across columns.
- **Workspace Activity Log:** Every board write is recorded per workspace and browsable in-app.
- **Dynamic Theming:** 5 board themes (`light`, `dark`, `darkblue`, `green`, `ocean`) with strict high-contrast readability.
- **Shared Emoji Meme Effect:** Click an emoji to send a "Facebook Live" style spam reaction across your team's screens.

### ✅ My Tasks (Cross-Workspace)
- A dedicated `/my-tasks` view aggregating everything assigned to you across **every** workspace you belong to, in Kanban or list form — no board-hopping to find your own work.

### 🔐 Project Vault (Zero-Knowledge Secrets)
- **Secure Storage:** Store environment variables, API keys, and server passwords directly within your workspace.
- **AES-256-GCM Encryption:** Secrets are sealed with a key derived via PBKDF2-SHA256 (100,000 iterations) from the user's master PIN. The server stores ciphertext, IV, and auth tag — never the plaintext.
- **Master PIN Infrastructure:** A stabilized Vault PIN system secures local accounts and forces Master PIN creation for users authenticating via Google OAuth. Superadmins can reset a forgotten PIN (which invalidates that user's existing ciphertext).

### 📚 Documentation Module (NoobieDocs)
- **GitBook meets Postman:** A centralized, folder-based hub for team knowledge with a nested folder tree, drag-to-reorder, and bulk move/delete.
- **Notion-Style Editor:** Tiptap-powered block editor (`NotionEditor`) with tables, images, and slash-style blocks for long-form docs; Quill handles in-card rich text.
- **HTML Sanitization:** All author HTML passes through DOMPurify before render, on internal and public pages alike.

### 🔌 API Workspace (NoobieAPI)
- **Spec Builder:** Design requests (method, URL, headers, query params, body, auth) and store them alongside the docs tree.
- **Environment Variables:** Per-workspace environments with `{{variable}}` substitution across URL, headers, and body.
- **Server-Side Test Proxy:** Requests are issued from the server (`POST /api/workspaces/:wsId/proxy`) so CORS-less third-party APIs are testable. The proxy is hardened: workspace-membership gated, http/https only, DNS-resolution SSRF guard against private/loopback/link-local targets, manually re-validated redirects, caller-listed headers only (no session leakage), plus timeout and response byte caps. See `PROXY_ALLOWED_HOSTS` to allow specific local hosts in development.

### 🌐 Public Share Surfaces
- **Public Docs Site:** Publish any folder as a read-only GitBook-style site at `/docs/:workspaceId/:folderSlug`.
- **Public API Reference:** Publish an API collection at `/apis/:workspaceId/:folderSlug`, complete with a built-in 'Live API Test' panel.
- **Password Protection:** Optionally gate a published folder behind a bcrypt-hashed password (`POST /api/public/docs/:wsId/unlock`).
- **Credential Redaction:** The public payload strips auth tokens, environment values, and recorded example secrets — published pages render `{{apiKey}}` as a placeholder rather than resolving it.

### 🤖 The "NoobieHelper" AI Assistant
- **Server-Proxied, Model-Agnostic:** A floating AI chat window. The browser calls `POST /api/ai/generate`; the API key never leaves the server. Native Gemini support plus any OpenAI-compatible endpoint (OpenAI, Qwen/DashScope, Kimi/Moonshot, OpenRouter, local vLLM/Ollama).
- **Function Calling:** Tell the AI to "Create a task for the database migration due tomorrow," and watch it update the board instantly via dynamic state injection. Tool schemas: [`AI_TOOLS_SCHEMA.md`](AI_TOOLS_SCHEMA.md).
- **Emoji Quoter:** Trigger motivational (or funny) AI-generated quotes that appear as a stunning text reveal animation in your footer.

### 👑 Account Governance (Superadmin)
- A `SUPERADMIN` role stored on the user record governs accounts: ban/unban, change role, delete, and reset Vault PINs.
- Superadmins get **no** implicit access to workspace content — add them as a workspace member if they need in.
- The app refuses to demote, ban, or delete the last superadmin, so you can never lock yourself out.

### 🌍 Global Features
- **Multi-Language (i18n):** English, Simplified/Traditional Chinese, Japanese, Indonesian, Bahasa Malaysia, and Russian, switchable from a dropdown.
- **Mobile Responsive:** Vertically stacked columns and full-screen overlay menus below `768px`.
- **Embedded YouTube Jukebox:** A floating, minimizable player for uninterrupted focus music while you navigate.

---

## 🛠 Technical Specifications

- **Frontend:** React 18 + Babel Standalone, loaded from CDN — **no bundler and no build step**. `client/` is served as static files directly by Express. Tailwind CSS (CDN, typography plugin), Lucide icons, react-beautiful-dnd, Quill (cards), Tiptap (docs), DOMPurify, Socket.IO client.
- **Backend:** Node.js (v18+), Express 4, Mongoose 9, Socket.IO 4, Multer (uploads), express-validator.
- **Database:** MongoDB. Falls back to `mongodb-memory-server` automatically when the connection fails, so a fresh clone boots without a daemon.
- **Authentication:** JWT Bearer tokens (7d default), bcrypt password hashing, Google OAuth 2.0 ID-token verification. All `/api/*` routes are gated except auth, signup, `/api/config`, `/api/public/*`, and the Socket.IO handshake. Sockets are authenticated at connect time and banned users are rejected there too.
- **Encryption:** Node native `crypto` — AES-256-GCM with PBKDF2-SHA256 key derivation.
- **Media:** Local disk only (`uploads/`), served back at `/media/`.

### Repository layout

```
client/           Static frontend (no build step)
  index.html      CDN script tags + app bootstrap
  src/            App.jsx, components/, context/, locales/, utils/
server/
  index.js        Express app, Socket.IO, static mounts, route wiring
  config.js       Single source of truth for env-derived config
  db.js           Mongoose models + connection (with in-memory fallback)
  crypto.js       AES-256-GCM vault primitives
  routes/         auth, users, admin, workspaces, tasks, docs, envs,
                  vault, public, emojis, ai, upload, proxy
  middleware/     auth, workspaceAuth, ssrfGuard, validate, errorHandler
  scripts/        seedSuperadmin.js, migration.js
  storage/        Local media storage driver
uploads/          Runtime user media (gitignored, never committed)
```

---

## ⚙️ Installation & On-Premise Setup

### Prerequisites
- Node.js v18 or higher
- MongoDB (local, Atlas, or rely on the in-memory fallback)
- Git

### 1. Clone the Repository
```bash
git clone https://github.com/yourusername/noobieteam.git
cd noobieteam
```

### 2. Install Dependencies
Only the project root has a `package.json` — the frontend has no dependencies to install.
```bash
npm install
```

### 3. Environment Configuration (`.env`)
Copy the template file to create your active environment configuration. **`.env` is gitignored — never commit real credentials.**
```bash
cp .env.template .env
```

Every variable is optional for local development; the app boots with defaults. In production, `JWT_SECRET` is mandatory.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8000` | HTTP port the server listens on. |
| `NODE_ENV` | *(unset)* | `production` makes `JWT_SECRET` mandatory and disables the dev fallback secret. |
| `JWT_SECRET` | dev fallback (non-prod only) | Signing key for JWTs. **Required in production** — the server refuses to start without it. |
| `JWT_EXPIRES_IN` | `7d` | Token lifetime. |
| `GOOGLE_CLIENT_ID` | *(unset)* | Enables "Sign in with Google". No client secret needed — the server verifies the browser's ID token. |
| `MONGODB_URI` | `mongodb://localhost:27017/noobieteam` | Connection string. On failure, an in-memory MongoDB starts instead. |
| `MOCK_DB` | *(unset)* | `true` skips the DB connection entirely (UI smoke tests only). |
| `GEMINI_API_KEY` | *(unset)* | Gemini key. Presence of any AI key flips `configured: true` in `/api/config`. |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` | A URL on `generativelanguage.googleapis.com` selects the native Gemini path. |
| `GEMINI_MODEL_ID` | `gemini-3-flash-preview` | Model id. |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL_ID` | *(unset)* / `https://api.openai.com/v1` | Fallbacks used when the `GEMINI_*` pair is unset. Point the base URL at any OpenAI-compatible provider. |
| `MAX_UPLOAD_BYTES` | `26214400` (25 MB) | Per-file upload cap; exceeding it returns `413`. |
| `PROXY_ALLOWED_HOSTS` | *(empty)* | Comma-separated `host` or `host:port` entries the API-test proxy may reach despite resolving to a private address. |

> **Super admin is not an env var.** The `SUPERADMIN` role lives on the user record in MongoDB. Sign up normally, then promote once:
> ```bash
> node server/scripts/seedSuperadmin.js you@example.com
> ```

### 4. Start the Application
```bash
npm start        # node server/index.js
npm run devStart # nodemon, restarts on server/ changes
```

Express serves both the API and the frontend, so there is nothing else to run. The app is live at `http://localhost:8000` (or whatever `PORT` you set). Frontend edits need only a browser refresh — Babel compiles JSX in the page.

---

## 📦 Media & Uploads

Uploaded avatars, backgrounds, card attachments, and doc images are written to this server's own disk under `uploads/`, one folder per category, and served back as static files:

| Category | On disk | URL |
|---|---|---|
| `profile_picture` | `uploads/profile_picture/` | `/media/profile_picture/<file>` |
| `background` | `uploads/background/` | `/media/background/<file>` |
| `task_media` | `uploads/task_media/` | `/media/task_media/<file>` |
| `doc_media` | `uploads/doc_media/` | `/media/doc_media/<file>` |

There is no cloud provider, no credentials, and no separate media host to configure. Stored keys are category-relative (`task_media/<file>`) with no URL prefix, so the serving path can change without migrating data.

Operational notes:
- `uploads/` sits outside `client/` on purpose — a deploy that replaces the source tree cannot destroy it. Back it up alongside the database, and mount it as a persistent/shared volume if you run more than one instance or deploy in a container (a container's local filesystem is wiped on redeploy).
- Uploads are served **without authentication** under `/media/`. Anyone with the URL can read the file; the random filename is not a secret.
- Every media mount sets `X-Content-Type-Options: nosniff` and a `default-src 'none'; sandbox` CSP, so an uploaded `.html` or `.svg` cannot execute script in this origin.

---

## 🔒 Security Notes

- **Set a strong `JWT_SECRET`.** Without one, non-production runs use a publicly known fallback secret; production refuses to boot.
- **Set `NODE_ENV=production` when you deploy.** It is what makes the missing-secret check fatal instead of a silent fallback.
- **Keep `PROXY_ALLOWED_HOSTS` empty on shared or internet-facing deployments.** Every host you list becomes reachable, from inside your network, by any workspace member — see the section above.
- **Never commit `.env`.** It is gitignored; rotate any credential that reaches a commit or a screenshot.
- **Vault PIN resets are destructive by design.** The key is derived from the PIN, so a reset makes existing ciphertext undecryptable.

---

## 🤝 Contributing
Noobieteam is fully open-source. We welcome pull requests for bug fixes, new AI tool integrations, and UI/UX refinements.

## 📄 License
MIT License
