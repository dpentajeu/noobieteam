# Noobieteam: The Next Gen Productivity Platform

<img width="1903" height="927" alt="image" src="https://github.com/user-attachments/assets/5ed56ba5-5055-4fe3-874b-523184440d17" />

**Noobieteam** is a powerful, open-source Next Gen Productivity Platform designed for modern teams. It is an all-in-one Kanban application that seamlessly manages tasks, securely stores credentials, builds technical documentation, and integrates AI assistance—all within a single, highly collaborative workspace.

Forget jumping between Jira for tasks, 1Password for secrets, GitBook for docs, and Postman for API. Noobieteam brings it all together with an "Instagram-style" minimalist UI.

---

## 🚀 Key Features

### 📋 High-Fidelity Kanban Board
- **Intuitive Organization:** Drag-and-drop cards, custom columns, and real-time state updates.
- **Jira-Style Backlog:** High-density vertical list view designed for rapid task prioritization and seamless transition into the active Sprint/To Do columns.
- **In-Card Collaboration:** Rich text editing (WYSIWYG), file attachments, due dates, urgency tags, and a real-time `@mention` commenting system.
- **Dynamic Theming:** Boards automatically adapt to 5 premium color themes (Light, Dark, Dark Blue, Green, Ocean Blue) with strict high-contrast readability.
- **Shared Emoji Meme Effect:** Click an emoji to send a "Facebook Live" style spam reaction across your team's screens.

### 🔐 Project Vault (Zero-Knowledge Secrets)
- **Secure Storage:** Store environment variables, API keys, and server passwords directly within your workspace.
- **AES-256-GCM Encryption:** Credentials are encrypted locally via an in-house Zero-Knowledge architecture ensuring only authenticated users can decipher secrets.
- **Master PIN Infrastructure:** A stabilized Vault PIN system seamlessly secures local accounts and forces Master PIN creation for users authenticating via Google OAuth.

### 📚 Documentation Module (NoobieDocs)
- **GitBook meets Postman:** A centralized, folder-based hub for team knowledge.
- **WYSIWYG Editor:** Build comprehensive guides with embedded code snippets using robust Quill integration.
- **API Spec Builder:** Design and test API endpoints natively within the platform, complete with Environment Variables support.
- **Dynamic Public Pages:** Convert any internal folder into a polished, read-only public documentation site featuring a built-in 'Live API Test' panel.

### 🤖 The "NoobieHelper" AI Assistant
- **Natural Language Control:** A floating, model-agnostic AI chat window powered by the Vercel AI SDK supporting OpenAI, Gemini, Qwen, and Kimi.
- **Function Calling:** Tell the AI to "Create a task for the database migration due tomorrow," and watch it update the board instantly via dynamic state injection.
- **Emoji Quoter:** Trigger motivational (or funny) AI-generated quotes that appear as a stunning text reveal animation in your footer.

### 🌍 Global Features
- **Multi-Language (i18n) Support:** Instantly switch the application interface between English, Simplified/Traditional Chinese, Japanese, Indonesian, Bahasa Malaysia, and Russian via a sleek dropdown selector.
- **Mobile Responsive:** Seamlessly transforms into vertically stacked columns and full-screen overlay menus for mobile (`< 768px`) accessibility.
- **Embedded YouTube Jukebox:** A floating, minimizable YouTube player embedded directly in the UI for uninterrupted focus music while you navigate.

---

## 🛠 Technical Specifications

Noobieteam is built on a robust, real-time technology stack optimized for high performance and AI integration:
- **Frontend:** React 18, Vite, Tailwind CSS, Zustand (State Management), Lucide React (Icons), Quill (WYSIWYG).
- **Backend:** Node.js, Express, Mongoose.
- **Database:** MongoDB (Persistent). Supports `mongodb-memory-server` fallback for local development without a daemon.
- **Authentication:** JWT, PBKDF2 Password Hashing, Google OAuth 2.0.
- **Encryption:** Node Native `crypto` (AES-256-GCM).

---

## ⚙️ Installation & On-Premise Setup

Noobieteam is designed for easy on-premise deployment. Follow these exact steps to get your workspace running locally.

### Prerequisites
- Node.js (v18 or higher)
- MongoDB running locally (or use the built-in memory server fallback)
- Git

### 1. Clone the Repository
```bash
git clone https://github.com/yourusername/noobieteam.git
cd noobieteam
```

### 2. Install Dependencies
Execute the following command in the project root to install all required backend and frontend packages:
```bash
npm install
```

### 3. Environment Configuration (`.env`)
Copy the template file to create your active environment configuration. **This file is strictly excluded from version control for security.**
```bash
cp .env.template .env
```

**Required `.env` Variables (Sanitized for Open Source):**
```env
# Application Port
PORT=3000

# Secret for signing JSON Web Tokens
JWT_SECRET=YOUR_JWT_SECRET_HERE

# Optional: MongoDB Connection String (Will fallback to memory server if empty or connection fails)
MONGODB_URI=mongodb://localhost:27017/noobieteam

# Google OAuth 2.0 Credentials (Required for "Sign in with Google")
# Obtain these from the Google Cloud Console (APIs & Services -> Credentials).
GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID_HERE
GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET_HERE

# Super Admin Role
# Not an env var. SUPERADMIN is stored on the user record in the database.
# Sign up normally, then promote that account once:
#   node server/scripts/seedSuperadmin.js you@example.com
# Superadmins govern accounts (ban, role, delete, PIN reset). They get no access
# to workspace content — add them as a workspace member if they need in.

# --- AI Assistant (Multi-Model Support) ---
DEFAULT_AI_PROVIDER=gemini # Options: openai, gemini, qwen, kimi

# Gemini Configuration (Required if DEFAULT_AI_PROVIDER=gemini)
GEMINI_API_KEY=YOUR_GEMINI_API_KEY_HERE
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
GEMINI_MODEL_ID=gemini-3-flash-preview

# OpenAI Configuration
OPENAI_API_KEY=YOUR_OPENAI_API_KEY_HERE
OPENAI_BASE_URL=https://api.openai.com/v1

# Qwen Configuration
QWEN_API_KEY=YOUR_QWEN_API_KEY_HERE
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# Kimi Configuration
KIMI_API_KEY=YOUR_KIMI_API_KEY_HERE
KIMI_BASE_URL=https://api.moonshot.cn/v1

# --- Media Storage ---
# Where uploaded avatars, backgrounds and attachments are stored.
#   local -> this server's own disk (no cloud account needed)
#   oss   -> Alibaba Cloud OSS bucket
# If unset, defaults to "oss" when OSS_BUCKET is set, otherwise "local".
STORAGE_DRIVER=local

# Local driver only
LOCAL_STORAGE_DIR=storage           # relative paths resolve from the repo root
LOCAL_STORAGE_BASE_URL=             # set only if a CDN/proxy fronts the upload dir
MAX_UPLOAD_BYTES=26214400           # 25MB

# OSS driver only (required when STORAGE_DRIVER=oss)
OSS_ENDPOINT=oss-ap-southeast-1.aliyuncs.com
OSS_ACCESS_KEY_ID=YOUR_OSS_ACCESS_KEY_ID_HERE
OSS_ACCESS_KEY_SECRET=YOUR_OSS_ACCESS_KEY_SECRET_HERE
OSS_BUCKET=YOUR_OSS_BUCKET_HERE
OSS_DOMAIN=https://YOUR_BUCKET.oss-ap-southeast-1.aliyuncs.com
```

#### Choosing a storage backend

| | `local` | `oss` |
|---|---|---|
| Setup | none — works out of the box | needs an Alibaba Cloud bucket + keys |
| Files live in | `LOCAL_STORAGE_DIR` on the app server | the OSS bucket |
| Served by | this server, at `/uploads/...` | the bucket domain |
| Best for | air-gapped / on-premise installs, dev | multi-instance or CDN-backed deploys |

Switching drivers changes where **new** uploads go; files already stored under the old
driver are not migrated. On `local`, back up `LOCAL_STORAGE_DIR` alongside the database,
and mount it on shared or persistent disk if you run more than one app instance or deploy
in a container (a container's local filesystem is wiped on redeploy).

Uploaded files are served without authentication under `/uploads/`, matching how a
public OSS bucket behaves. Anyone with the URL can read them; the filename is random,
not secret.

### 4. Start the Application
Start both the backend server and the frontend client concurrently:

```bash
npm start
```
The application will be live at `http://localhost:3000`.

---

## 🤝 Contributing
Noobieteam is fully open-source. We welcome pull requests for bug fixes, new AI tool integrations, and UI/UX refinements.

## 📄 License
MIT License
