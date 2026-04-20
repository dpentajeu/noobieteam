# Product Requirements Document: Documentation Module (Codename: "NoobieDocs")

## 1. Overview
The "Documentation" module is a new section within Noobieteam designed to provide teams with a unified platform for internal knowledge bases and API technical documentation. It combines the structured, content-rich editing of GitBook with the technical precision and testability of Postman.

## 2. Core Features

### 2.1 Content-Based Documentation (GitBook Style)
*   **WYSIWYG Editor:** A high-fidelity rich-text editor (supporting TipTap/Quill) for creating intuitive guides.
*   **Comprehensive Code Snippets:** Multi-language syntax highlighting with "Copy to Clipboard" functionality.
*   **Image & Asset Management:** Drag-and-drop image uploads and responsive embedding.
*   **Nested Hierarchy:** Support for folders and sub-pages to organize large documentation sets.
*   **Markdown Interoperability:** Ability to import from and export to standard Markdown files.

### 2.2 API Documentation & Testing (Postman Style)
*   **API Spec Builder:** Visual interface to define HTTP methods, endpoints, headers, and parameters.
*   **Live Testing ("Try it out"):** A built-in HTTP client allowing users to send real requests to APIs and view formatted JSON/XML responses.
*   **Request/Response Examples:** Ability to save multiple snapshots of successful/failed calls for reference.
*   **Environment Variables:** Define workspace-level variables (e.g., `{{base_url}}`) to switch between Dev/Staging/Production easily.
*   **Authentication Support:** Out-of-the-box support for Bearer Tokens, API Keys, and Basic Auth.

### 2.3 General Platform Features
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
*   **Layout:** 
    *   **Left Sidebar:** Document tree/hierarchy with distinct icons for Folders, Pages, and API Endpoints.
    *   **Central Content:** Wide reading area for text docs; split-pane view for API testing (Request on top/left, Response on bottom/right).
    *   **Header:** Quick search bar and "Share" button.

## 5. Technical Alignment
*   **Frontend:** Next.js components using `TipTap` for WYSIWYG and `Prism.js` or `react-syntax-highlighter` for code.
*   **API Client:** Use `axios` or native `fetch` with proxy support if needed to bypass CORS during local testing.
*   **Backend:** NestJS controllers to handle Doc CRUD and Environment management.
