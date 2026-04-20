# Noobieteam Database Schema & Connection Guide (MongoDB Edition)

This document outlines the NoSQL database schema (MongoDB) and the setup guide for establishing the local database connection.



### 2.4 Documents Collection (`docs`)
Stores the new WYSIWYG documentation and Postman-style API testing specifications.

```json
{
  "_id": "ObjectId",
  "workspaceId": "ObjectId (ref: workspaces)",
  "title": "string",
  "type": "string (TEXT|API)",
  "content": "string (html/optional)",
  "parentId": "string (optional for nested tree)",
  "order": "number",
  "apiSpec": {
    "method": "string (GET|POST|PUT|DELETE|PATCH)",
    "url": "string",
    "headers": [{ "key": "string", "value": "string" }],
    "queryParams": [{ "key": "string", "value": "string" }],
    "body": "string",
    "examples": [{ "name": "string", "requestBody": "string", "responseBody": "string", "status": "number" }]
  },
  "createdBy": "string (user email)",
  "createdAt": "date",
  "updatedAt": "date"
}
```



### 2.6 Emoji Events Collection (`emojievents`)
Stores the "Meme Feature" ephemeral interactions. Tracks which users have seen a specific floating emoji animation.

```json
{
  "_id": "ObjectId",
  "workspaceId": "string (uuid)",
  "senderEmail": "string",
  "emojiType": "string (e.g. 'rocket', 'fire')",
  "viewedBy": [
    "string (array of user emails)"
  ],
  "createdAt": "date",
  "updatedAt": "date"
}
```

### 2.5 Environments Collection (`envs`)
Stores API testing environment variables scoped to workspaces.

```json
{
  "_id": "ObjectId",
  "workspaceId": "ObjectId (ref: workspaces)",
  "name": "string",
  "variables": [
    {
      "key": "string",
      "value": "string",
      "isSecret": "boolean"
    }
  ],
  "createdAt": "date",
  "updatedAt": "date"
}
```



### 2.6 Emoji Events Collection (`emojievents`)
Stores the "Meme Feature" ephemeral interactions. Tracks which users have seen a specific floating emoji animation.

```json
{
  "_id": "ObjectId",
  "workspaceId": "string (uuid)",
  "senderEmail": "string",
  "emojiType": "string (e.g. 'rocket', 'fire')",
  "viewedBy": [
    "string (array of user emails)"
  ],
  "createdAt": "date",
  "updatedAt": "date"
}
```

---

## 1. Environment Configuration

To connect the application to your local MongoDB instance, you must configure the `.env` file located at the root of the project `/root/workspace/mas-projects/noobieteam/.env`.

### Step-by-Step Guide:
1. Open the `.env` file.
2. Add the `MONGODB_URI` variable. The connection string follows the standard MongoDB format:
   `mongodb://[USER]:[PASSWORD]@[HOST]:[PORT]/[DATABASE_NAME]?authSource=admin`
3. Ensure your `ADMIN_EMAIL` is also correctly set for RBAC.

### Example `.env` File:
```env
# --- Admin & RBAC ---
ADMIN_EMAIL=admin@noobieteam.ai

# --- Application Settings ---
PORT=9743

# --- Database Connection (Local MongoDB) ---
MONGODB_URI="mongodb://localhost:27017/noobieteam"
```

---

## 2. MongoDB Document Schemas

The application uses three primary collections: `users`, `workspaces`, and `tasks`. Data is denormalized where appropriate to leverage MongoDB's document-based model for performance and simplicity.

### 2.1 Users Collection (`users`)
Stores user profiles and authentication data.

```json
{
  "_id": "ObjectId",
  "email": "string (unique)",
  "password": "string (hashed)",
  "name": "string",
  "avatarUrl": "string (optional)",
  "createdAt": "date",
  "updatedAt": "date"
}
```

### 2.2 Workspaces Collection (`workspaces`)
Stores workspace metadata, membership, columns (board stages), and encrypted secrets.

```json
{
  "_id": "ObjectId",
  "name": "string",
  "color": "string (css gradient)",
  "avatar": "string (acronym)",
  "archived": "boolean",
  "members": [
    {
      "userId": "ObjectId (ref: users)",
      "role": "string (OWNER|MEMBER)",
      "joinedAt": "date"
    }
  ],
  "columns": [
    {
      "id": "uuid/string",
      "title": "string",
      "order": "number"
    }
  ],
  "secrets": [
    {
      "id": "uuid/string",
      "service": "string",
      "value": "string (AES-256-GCM hex)",
      "iv": "string (hex)",
      "authTag": "string (hex)"
    }
  ],
  "createdAt": "date",
  "updatedAt": "date"
}
```



### 2.4 Documents Collection (`docs`)
Stores the new WYSIWYG documentation and Postman-style API testing specifications.

```json
{
  "_id": "ObjectId",
  "workspaceId": "ObjectId (ref: workspaces)",
  "title": "string",
  "type": "string (TEXT|API)",
  "content": "string (html/optional)",
  "parentId": "string (optional for nested tree)",
  "order": "number",
  "apiSpec": {
    "method": "string (GET|POST|PUT|DELETE|PATCH)",
    "url": "string",
    "headers": [{ "key": "string", "value": "string" }],
    "queryParams": [{ "key": "string", "value": "string" }],
    "body": "string",
    "examples": [{ "name": "string", "requestBody": "string", "responseBody": "string", "status": "number" }]
  },
  "createdBy": "string (user email)",
  "createdAt": "date",
  "updatedAt": "date"
}
```

### 2.5 Environments Collection (`envs`)
Stores API testing environment variables scoped to workspaces.

```json
{
  "_id": "ObjectId",
  "workspaceId": "ObjectId (ref: workspaces)",
  "name": "string",
  "variables": [
    {
      "key": "string",
      "value": "string",
      "isSecret": "boolean"
    }
  ],
  "createdAt": "date",
  "updatedAt": "date"
}
```

### 2.3 Tasks Collection (`tasks`)
Stores tasks (cards) including their checklist items, attachments, and assignees.

```json
{
  "_id": "ObjectId",
  "workspaceId": "ObjectId (ref: workspaces)",
  "columnId": "string (matching workspaces.columns.id)",
  "title": "string",
  "content": "string (html/optional)",
  "urgency": "string (LOW|MED|HIGH)",
  "dueDate": "date (optional)",
  "order": "number",
  "assignees": [
    "ObjectId (ref: users)"
  ],
  "checklist": [
    {
      "id": "uuid/string",
      "text": "string",
      "done": "boolean"
    }
  ],

  "comments": [
    {
      "id": "ObjectId",
      "authorEmail": "string",
      "text": "string",
      "timestamp": "date",
      "taggedUsers": ["string (user emails)"]
    }
  ],
  "attachments": [
    {
      "id": "uuid/string",
      "name": "string",
      "dataUrl": "string",
      "size": "string"
    }
  ],
  "createdAt": "date",
  "updatedAt": "date"
}
```

---

## 3. Relationships & Constraints

- **One-to-Many (Reference):** `workspaces` -> `tasks`. Linked via `workspaceId`.
- **Many-to-Many (Reference):** `users` <-> `tasks` via `tasks.assignees`.
- **Many-to-Many (Reference):** `users` <-> `workspaces` via `workspaces.members`.
- **Embedded:** `columns` and `secrets` are embedded in `workspaces` as they are intrinsic to the workspace lifecycle.
---

## 4. Connection Troubleshooting

If the application hangs during login or workspace creation, verify the following:
- **MongoDB Daemon:** Ensure `mongod` is running on `localhost:27017` (or the URI specified in `.env`).
- **Network Access:** Check for firewalls or port blocks on 27017.
- **Mongoose Buffering:** Mongoose will buffer commands for 10 seconds by default if the connection is lost. If you see `Operation buffering timed out` errors, the database connection has failed.
- **Mock Mode:** For UI testing without a live database, ensure the `server/db.js` fallback warning is visible in the logs. Note that data persistence is NOT active in mock mode unless a memory-db is integrated.
