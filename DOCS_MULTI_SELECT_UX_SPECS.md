# Documentation & API Multi-Select UI/UX Specifications

## Objective
Enable users to perform bulk actions (Delete, Move to Folder) on Documents and API endpoints within the Noobieteam Docs module sidebar.

## 1. Sidebar Item UI Updates
To maintain a clean aesthetic while allowing robust multi-selection, the checkbox behavior will be context-aware.

### Checkbox Visibility Rules
*   **Default State:** Checkboxes are hidden to maintain the "Instagram-style" minimalist UI.
*   **Hover State:** When a user hovers over any sidebar item (Document or API endpoint), a subtle, unstyled checkbox appears aligned to the left of the item icon.
*   **Selected State:** Once an item is checked, its checkbox remains visible (even when the mouse leaves). The row's background subtly shifts (e.g., `bg-blue-500/10` in dark mode or `bg-blue-50` in light mode) to indicate active selection.
*   **Active Multi-Select Mode:** If `selectedItems.length > 0`, the hover requirement is dropped for all other items. Checkboxes become permanently visible next to *all* items in the sidebar to encourage bulk selection.

### Checkbox Design
*   Use a standardized Tailwind CSS checkbox (`w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500`).
*   Position: Between the expand/collapse chevron (if applicable) and the Document/API type icon (`lucide-file-text` or `lucide-braces`).

## 2. Floating Action Bar
When one or more items are selected (`selectedItems.length > 0`), a Floating Action Bar emerges at the bottom center of the workspace (or immediately anchored to the bottom of the sidebar if space is constrained).

### Layout & Animations
*   **Animation:** `slide-up` and `fade-in` from the bottom.
*   **Position:** Fixed at the bottom center of the screen `fixed bottom-8 left-1/2 -translate-x-1/2 z-50`.
*   **Style:** Glassmorphism pill shape (`backdrop-blur-md bg-white/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 shadow-xl rounded-full px-6 py-3`).

### Actions / Elements
*   **Selection Counter:** Displays "X selected" (e.g., `text-sm font-medium text-gray-700 dark:text-gray-200`).
*   **Divider:** A vertical bar separating the counter from the actions (`h-4 w-px bg-gray-300 dark:bg-gray-600 mx-4`).
*   **Action 1: Move to Folder**
    *   Icon: `lucide-folder-input`
    *   Label: "Move"
    *   Interaction: Opens a minimal dropdown or modal listing all available folders. Clicking a folder executes the bulk update.
*   **Action 2: Delete Selected**
    *   Icon: `lucide-trash-2`
    *   Label: "Delete"
    *   Style: Red text/icon on hover (`hover:text-red-500`).
    *   Interaction: Triggers a confirmation modal ("Are you sure you want to delete X items?").
*   **Action 3: Cancel (Clear Selection)**
    *   Icon: `lucide-x`
    *   Interaction: Clears the `selectedItems` array, closing the action bar and reverting the sidebar to default state.

## 3. Data Structure (Frontend Zustand State)
*   Recommend adding a `selectedDocIds: string[]` array to the active Docs/Workspace store.
*   Functions needed: `toggleDocSelection(id)`, `clearDocSelection()`, `bulkDeleteDocs(ids)`, `bulkMoveDocs(ids, targetFolderId)`.