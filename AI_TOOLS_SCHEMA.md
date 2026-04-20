# AI Assistant Tool Definitions (JSON Schemas)

The following JSON Schemas must be registered with the LLM (e.g., via the Vercel AI SDK `tools` array) to enable the AI to perform CRUD operations on the Noobieteam Kanban board.

```json
[
  {
    "type": "function",
    "function": {
      "name": "create_card",
      "description": "Creates a new task card in a specific column on the Kanban board. Use this when the user explicitly asks to add, create, or make a new task.",
      "parameters": {
        "type": "object",
        "properties": {
          "title": {
            "type": "string",
            "description": "The short, descriptive title of the task."
          },
          "column_id": {
            "type": "string",
            "description": "The exact ID of the column where the card should be placed. This must be retrieved from the dynamically injected board state in the system prompt."
          },
          "description": {
            "type": "string",
            "description": "Optional. Detailed information or instructions for the task."
          },
          "due_date": {
            "type": "string",
            "description": "Optional. The deadline for the task, formatted as an ISO 8601 date string (e.g., '2026-04-19T00:00:00.000Z'). Convert natural language like 'tomorrow' into this format."
          },
          "priority": {
            "type": "string",
            "enum": ["low", "medium", "high"],
            "description": "Optional. The priority level of the task."
          }
        },
        "required": ["title", "column_id"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "query_board",
      "description": "Searches and filters existing tasks on the Kanban board. Use this to answer questions like 'What is assigned to me?', 'What tasks are expiring soon?', or 'Find the database migration task'.",
      "parameters": {
        "type": "object",
        "properties": {
          "filters": {
            "type": "object",
            "properties": {
              "status": {
                "type": "string",
                "description": "Optional. Filter by the column ID or status name."
              },
              "expiring_within_days": {
                "type": "number",
                "description": "Optional. Number of days to look ahead for expiring tasks (e.g., 2 for 'next 48 hours')."
              },
              "keyword": {
                "type": "string",
                "description": "Optional. A specific word or phrase to search for within task titles and descriptions."
              },
              "assignee_id": {
                "type": "string",
                "description": "Optional. The ID of the user to filter tasks by."
              }
            }
          }
        },
        "required": ["filters"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "update_card",
      "description": "Modifies an existing task on the Kanban board. Use this to move tasks between columns, assign users, or change the title, description, or due date.",
      "parameters": {
        "type": "object",
        "properties": {
          "card_id": {
            "type": "string",
            "description": "The exact unique ID of the card to update. This must be retrieved from the dynamically injected board state in the system prompt."
          },
          "updates": {
            "type": "object",
            "description": "An object containing only the fields that need to be changed.",
            "properties": {
              "column_id": {
                "type": "string",
                "description": "Optional. The new column ID to move the card to."
              },
              "title": {
                "type": "string",
                "description": "Optional. The new title for the card."
              },
              "description": {
                "type": "string",
                "description": "Optional. The new description for the card."
              },
              "due_date": {
                "type": "string",
                "description": "Optional. The new deadline, formatted as an ISO 8601 date string."
              },
              "assignee_id": {
                "type": "string",
                "description": "Optional. The user ID to assign to the card."
              }
            }
          }
        },
        "required": ["card_id", "updates"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "archive_card",
      "description": "Archives a specific task on the Kanban board. Use this when the user asks to delete, remove, or archive a card. For safety, cards are never hard-deleted.",
      "parameters": {
        "type": "object",
        "properties": {
          "card_id": {
            "type": "string",
            "description": "The exact unique ID of the card to archive. This must be retrieved from the dynamically injected board state in the system prompt."
          }
        },
        "required": ["card_id"]
      }
    }
  }
]
```