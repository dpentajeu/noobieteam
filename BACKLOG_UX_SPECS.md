# Noobieteam UI/UX Architecture Updates (Backlog Feature)

## 18. Backlog Module (Jira Style)
- **UX Concept:** A high-density, vertical list view designed for rapid task prioritization and seamless transition into the active Kanban board (Sprint/To Do).
- **Trigger Element:** A distinct 'Backlog' toggle button (e.g., a button with a `lucide-list` icon and "Backlog" text) located in the main Workspace Menu/Header.
- **Location & Integration (Side Drawer):** 
  - When the toggle is clicked, the Backlog opens as a **collapsible side-drawer** (sliding in from the left or right).
  - **Crucial Rule:** The Backlog must overlay or push the board slightly but remain visible *simultaneously* with the active Kanban board. This is mandatory to allow direct drag-and-drop between the two contexts.
- **Backlog List UI (High Density):**
  - **Format:** Simple, vertical rows (not full cards).
  - **Data Points per Row:** Minimalist display showing only: Task Title, Assignee Avatar (small, right-aligned), and an optional Priority indicator.
  - **Styling:** Follow the "Instagram-style light minimalist" theme. Use thin dividers between rows (`border-b border-gray-200`), compact padding (`py-2 px-3`), and subtle hover states (`hover:bg-gray-50`).
- **Interaction Mechanics (The Core Flow):**
  - **List-to-Board Drag:** Users click and drag a row from the vertical Backlog list directly onto the active Kanban board.
  - **Valid Drop Zone:** The "To Do" column (or any active column) must highlight visually to indicate it is ready to receive the backlog item.
  - **Visual Feedback:** During the drag, a 'ghost' placeholder (a semi-transparent version of the row or card) follows the cursor.
  - **Conversion:** Upon dropping the row into a column, it instantly converts into a full Kanban card in that stage and the backend updates its status/column ID.
  - **Quick Add:** A permanent "+ Add task" inline input field at the bottom of the Backlog list for rapid data entry without opening a modal.