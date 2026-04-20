# Noobieteam: The Next Gen Productivity Platform

![Noobieteam Header](https://via.placeholder.com/1200x400?text=Noobieteam+Next+Gen+Productivity+Platform)

**Noobieteam** is a powerful, open-source Next Gen Productivity Platform designed for modern teams. It is an all-in-one Kanban application that seamlessly manages tasks, securely stores credentials, builds technical documentation, and integrates AI assistance—all within a single, highly collaborative workspace.

Forget jumping between Jira for tasks, 1Password for secrets, GitBook for docs, and Spotify for focus. Noobieteam brings it all together with an "Instagram-style" minimalist UI.

---

## 🚀 Key Features

### 📋 High-Fidelity Kanban Board
- **Intuitive Organization:** Drag-and-drop cards, custom columns, and real-time state updates.
- **In-Card Collaboration:** Rich text editing (WYSIWYG), file attachments, due dates, urgency tags, and an @mention commenting system.
- **Dynamic Theming:** Boards automatically adapt to 5 premium color themes (Light, Dark, Dark Blue, Green, Ocean Blue) with strict high-contrast readability.
- **Shared Emoji Meme Effect:** Click an emoji to send a "Facebook Live" style spam reaction across your team's screens.

### 🔐 Project Vault (Zero-Knowledge Secrets)
- **Secure Storage:** Store environment variables, API keys, and server passwords directly within your workspace.
- **AES-256-GCM Encryption:** Credentials are encrypted in the backend using industry-standard authenticated encryption.
- **OAuth Compatible:** Supports "Master PIN" creation for users authenticating via Google OAuth.

### 📚 Documentation Module (NoobieDocs)
- **GitBook meets Postman:** A centralized hub for team knowledge.
- **WYSIWYG Editor:** Build comprehensive guides with embedded code snippets.
- **API Spec Builder:** Design and test API endpoints natively within the platform, complete with Environment Variables support.

### 🤖 The "NoobieHelper" AI Assistant
- **Natural Language Control:** A floating, model-agnostic AI chat window (powered by Vercel AI SDK).
- **Function Calling:** Tell the AI to "Create a task for the database migration due tomorrow," and watch it update the board instantly.
- **Emoji Quoter:** Trigger motivational (or funny) AI-generated quotes that appear as a stunning text reveal animation in your footer.

### 🎵 Embedded YouTube Jukebox
- **Focus Mode:** A floating, minimizable YouTube player embedded directly in the UI.
- **Persistent Playback:** Music continues uninterrupted as you navigate between workspaces and documentation.

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
JWT_SECRET=[REPLACE_WITH_YOUR_SUPER_SECRET_KEY]

# Optional: MongoDB Connection String (Will fallback to memory server if empty or connection fails)
MONGODB_URI=mongodb://localhost:27017/noobieteam

# Google OAuth 2.0 Credentials (Required for "Sign in with Google")
# Obtain these from the Google Cloud Console (APIs & Services -> Credentials).
GOOGLE_CLIENT_ID=[REPLACE_WITH_YOUR_GOOGLE_CLIENT_ID]
GOOGLE_CLIENT_SECRET=[REPLACE_WITH_YOUR_GOOGLE_CLIENT_SECRET]

# Super Admin Role
# The user with this exact email is granted Super Admin privileges.
# They bypass all workspace invitation checks and can delete workspaces.
ADMIN_EMAIL=[REPLACE_WITH_ADMIN_EMAIL]

# --- AI Assistant (Multi-Model Support) ---
DEFAULT_AI_PROVIDER=gemini # Options: openai, gemini, qwen, kimi

# Gemini Configuration (Required if DEFAULT_AI_PROVIDER=gemini)
GEMINI_API_KEY=[REPLACE_WITH_YOUR_GEMINI_API_KEY]
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
GEMINI_MODEL_ID=gemini-3-flash-preview
```

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
