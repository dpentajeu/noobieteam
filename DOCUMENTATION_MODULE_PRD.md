# Product Requirements Document: Documentation Module (Codename: "NoobieDocs")

## 1. Overview
The "Documentation" module is a new section within Noobieteam designed to provide teams with a unified platform for internal knowledge bases and API technical documentation. It combines the structured, content-rich editing of GitBook with the technical precision and testability of Postman.

## 2. Core Features

### 2.1 Content-Based Documentation (GitBook Style)
*   **WYSIWYG Editor:** A high-fidelity rich-text editor (supporting TipTap/Quill) for creating intuitive guides.
*   **Comprehensive Code Snippets:** Multi-language syntax highlighting with "Copy to Clipboard" functionality.
*   **Image & Asset Management:** Drag-and-drop image uploads and responsive embedding.
*   **Nested Hierarchy & Folders:** Support for creating distinct Folders. Users can group multiple text docs and API endpoints into these folders to streamline search and organization.
*   **Markdown Interoperability:** Ability to import from and export to standard Markdown files.

### 2.2 API Documentation & Testing (Postman Style)
*   **API Spec Builder:** Visual interface to define HTTP methods, endpoints, headers, and parameters.
*   **Live Testing ("Try it out"):** A built-in HTTP client allowing users to send real requests to APIs and view formatted JSON/XML responses.
*   **Request/Response Examples:** Ability to save multiple snapshots of successful/failed calls for reference.
*   **Environment Variables:** Define workspace-level variables (e.g., `{{base_url}}`) to switch between Dev/Staging/Production easily.
*   **Authentication Support:** Out-of-the-box support for Bearer Tokens, API Keys, and Basic Auth.

### 2.3 Dynamic Public Documentation Page
*   **Feature:** Convert any internal folder into a polished, read-only public documentation site.
*   **Routing:** The dynamic page must follow a clean URL structure: `/[workspace-path]/docs/[folder-name]`.
*   **Layout:** Similar to Postman's published docs or GitBook. A left-hand navigation sidebar listing all endpoints/pages within the folder, and a main content area rendering the selected document or API spec (with code generation blocks).
*   **Access:** This page should be viewable by anyone with the link (if set to public), stripping away the internal workspace editing tools and Kanban boards.

### 2.4 General Platform Features
*   **Unified Search:** Fast, full-text search across all documentation titles and content.
*   **Role-Based Access:** Inherit workspace permissions (OWNER/MEMBER) for editing and viewing.
*   **Version History:** Basic audit trail of who changed what and when.

## 3. Data Schema Recommendations (MongoDB)

### 3.1 `docs` Collection
Stores both text-based and API-based documentation entries.

```json
{
  "_id": "ObjectId",
  "workspaceId": "ObjectId (ref: workspaces)",
  "title": "string",
  "type": "string (TEXT|API)",
  "content": "string (HTML content for TEXT type or Description for API type)",
  "parentId": "ObjectId (ref: docs, optional)",
  "order": "number",
  "apiSpec": {
    "method": "string (GET|POST|PUT|DELETE|PATCH)",
    "url": "string",
    "headers": [{"key": "string", "value": "string"}],
    "queryParams": [{"key": "string", "value": "string"}],
    "body": "string (JSON string or raw text)",
    "examples": [
      {
        "name": "string",
        "requestBody": "string",
        "responseBody": "string",
        "status": "number"
      }
    ]
  },
  "createdBy": "ObjectId (ref: users)",
  "updatedBy": "ObjectId (ref: users)",
  "createdAt": "date",
  "updatedAt": "date"
}
```

### 3.2 `api_environments` Collection
Stores environment-specific variables for the "Try it out" feature.

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

## 4. UI/UX Design Directions
*   **Theme:** Maintain the "Instagram-style light minimalist" theme (Solid white background, #FAFAFA surfaces, System Blue accents).
*   **Workspace Docs UI (Internal Management):** 
    *   **Left Sidebar (Tree View):** A file explorer listing all Folders, Text Docs, and APIs.
        *   **Action:** A "+ New Folder" button at the top of the sidebar.
        *   **Interaction:** Users must be able to drag-and-drop existing documents/APIs into these folders, or select a folder when creating a new document.
        *   **Icons:** Use distinct Lucide icons for `lucide-folder`, `lucide-file-text`, and `lucide-braces` (for APIs).
    *   **Central Content:** Wide reading area for text docs; split-pane view for API testing (Request on top/left, Response on bottom/right).
*   **Dynamic Public Documentation UI (External View):**
    *   **Layout:** A streamlined, read-only interface.
    *   **Sidebar:** Locks to the specific folder's contents. Only displays docs/APIs within the requested `[folder-name]`.
    *   **Header:** Minimalist. Displays the Workspace name, Folder name, and an optional "Back to Workspace" link for authenticated members. No editing tools or "Try it out" environments (unless explicitly permitted in a future release).
    *   **Search:** Scoped strictly to the contents of the public folder.

## 5. Technical Alignment
*   **Frontend:** Next.js components using `TipTap` for WYSIWYG and `Prism.js` or `react-syntax-highlighter` for code.
*   **API Client:** Use `axios` or native `fetch` with proxy support if needed to bypass CORS during local testing.
*   **Backend:** NestJS controllers to handle Doc CRUD and Environment management.
