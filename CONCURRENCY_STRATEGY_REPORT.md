# Technical Recommendation: Strategies for Avoiding Concurrent Edit Conflicts

To address the requirement of avoiding concurrent edit conflicts on card descriptions, we have evaluated two primary industry-standard strategies suitable for the Noobieteam project.

## 1. Pessimistic Locking (Presence-Based)
This strategy prevents conflicts from occurring by ensuring only one user can edit a card at any given time.

### Implementation Logic:
- **WebSocket Triggers:** When a user opens the Edit Card modal, the client emits an `EDIT_START` event via WebSockets containing the `taskId` and `userId`.
- **Server-Side Registry:** The Node.js server maintains an in-memory registry (or Redis for scaling) of active locks: `{ [taskId]: { userId, expiresAt } }`.
- **Global Broadcast:** The server broadcasts a `CARD_LOCKED` event to all other clients in the same workspace. 
- **UI Interaction:** Other users see a "User X is currently editing" indicator and the "Save" button or input fields are disabled/hidden for them.
- **Release:** The lock is released on `EDIT_STOP` (closing modal) or if the WebSocket connection is lost (disconnect event).

### Pros:
- **Zero Conflict UX:** Completely eliminates the chance of User B overwriting User A's work.
- **Real-time Feel:** Matches the "Social" vibe of Noobieteam.

### Cons:
- Requires a stable WebSocket implementation.

---

## 2. Optimistic Concurrency Control (OCC)
This strategy allows anyone to edit but detects and rejects updates that would cause a conflict.

### Implementation Logic:
- **Versioning:** Enable Mongoose's built-in version key in the `Task` schema:
  ```javascript
  const taskSchema = new Schema({ ... }, { optimisticConcurrency: true });
  ```
- **The Update Loop:**
  1. User A fetches Task X (Version 1).
  2. User B fetches Task X (Version 1).
  3. User B saves (Version incremented to 2 in DB).
  4. User A tries to save with Version 1. 
  5. The server/Mongoose detects the mismatch and throws a `VersionError`.
- **Conflict Resolution:** The client receives a 409 Conflict error and must prompt the user to "Refresh and merge changes" or "Overwrite" (riskier).

### Pros:
- **No Persistent Connection:** Works over standard REST.
- **Low Server Overhead:** No need to manage lock states.

### Cons:
- **Frustrating UX:** Users only find out about the conflict *after* they have finished typing and try to save.

---

## Technical Recommendation to the CTO

**Primary Strategy: Pessimistic Locking via WebSockets.**

Since Noobieteam is targeted at small teams and emphasizes a "Social" and "Interactive" theme, preventing conflicts *before* they happen is vastly superior to showing a "Version Conflict" error. 

### Step-by-Step Implementation for Programmer:
1. **Socket.io Setup:** Integrate `socket.io` in the Express server.
2. **Lock Event:** In `CardModal.jsx`, emit `socket.emit('card:lock', taskId)` on mount and `card:unlock` on unmount.
3. **Lock State:** In `WorkspaceView.jsx`, listen for `card:locked` events to display lock icons on the cards.
4. **Safety Net:** Enable Mongoose `optimisticConcurrency` on the `Task` collection as a second line of defense in case of network edge cases.

This hybrid approach ensures a premium user experience while maintaining absolute data integrity.
