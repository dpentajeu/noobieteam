window.WorkspaceView = ({ workspace, onBack, user, onLogout, onThemeChange, theme, onUpdateUser, isJukeboxActive }) => {
    const { showConfirm, showPrompt, showAlert } = window.useModals();
    const { showToast } = window.useToasts();
    const [columns, setColumns] = React.useState(workspace.columns && workspace.columns.length > 0 ? workspace.columns : [{ id: 'todo', title: 'To Do', order: 0 }]);
    const [cards, setCards] = React.useState([]);
    const [allUsers, setAllUsers] = React.useState([]);
    const [members, setMembers] = React.useState(() => {
        if (!workspace || !workspace.members) return [user?.email].filter(Boolean);
        return workspace.members.map(m => typeof m === 'string' ? m : m?.userId).filter(Boolean);
    });
    const [loading, setLoading] = React.useState(true);
    const [expiredCards, setExpiredCards] = React.useState([]);
    const [showExpiredModal, setShowExpiredModal] = React.useState(false);
    const [hasShownWelcome, setHasShownWelcome] = React.useState(false);
    const [selectedMoveCol, setSelectedMoveCol] = React.useState('');
    const { t } = window.useTranslation ? window.useTranslation() : { t: k => k };

    React.useEffect(() => {
        fetch(`/api/workspaces/${workspace.id}/tasks`).then(r => r.json()).then(data => { 
            const validData = Array.isArray(data) ? data.sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0)) : [];
            setCards(validData); 
            setLoading(false); 
            
            // Check for expired cards
            const now = new Date();
            const expired = validData.filter(c => {
                if (c.archived || !c.dueDate || c.expiredAlertAcknowledged) return false;
                // Exclude cards in 'done' column or any column title like 'Done'
                const parentCol = columns.find(col => col.id === c.columnId);
                if (c.columnId === 'done' || (parentCol && parentCol.title && parentCol.title.toLowerCase().includes('done'))) return false;
                const due = new Date(c.dueDate);
                const diffDays = (now - due) / (1000 * 60 * 60 * 24);
                return diffDays >= 3;
            });
            if (expired.length > 0) {
                setExpiredCards(expired);
                setShowExpiredModal(true);
                setSelectedMoveCol(columns[0]?.id || 'todo');
            }
            
            if (!hasShownWelcome && user?.email) {
                const myCards = validData.filter(c => c && !c.archived && c.assignees && c.assignees.includes(user.email));
                const expiringCount = myCards.filter(c => {
                    if (!c.dueDate) return false;
                    const due = new Date(c.dueDate);
                    const diffDays = (due - now) / (1000 * 60 * 60 * 24);
                    return diffDays >= 0 && diffDays <= 3;
                }).length;
                const backlogCount = myCards.filter(c => c.columnId === 'backlog' || c.col === 'backlog').length;
                
                // Show toast with stats
                showToast(t('alerts.welcome_stats', { total: myCards.length, expiring: expiringCount, backlog: backlogCount }) || `Workspace loaded: You have ${myCards.length} assigned cards (${expiringCount} expiring soon, ${backlogCount} in backlog).`);
                setHasShownWelcome(true);
            }
        }).catch(console.error);
        fetch('/api/users').then(r => r.json()).then(data => setAllUsers(Array.isArray(data) ? data : [])).catch(console.error);
        fetch('/api/config').then(r => r.json()).then(data => { if (data.aiConfig) setAiConfig(data.aiConfig); if (data.adminEmail) window.NT_ADMIN_EMAIL = data.adminEmail; }).catch(console.error);
        
        // Fetch unseen emojis
        const fetchUnseenEmojis = async () => {
            try {
                if (!user || !user.email) return;
                const res = await fetch(`/api/workspaces/${workspace.id}/emojis/unseen?email=${user.email}`);
                const unseen = await res.json();
                if (unseen && unseen.length > 0) {
                    const idsToMark = unseen.map(e => e._id || e.id);
                    let allSpawns = [];
                    unseen.forEach((event, idx) => {
                        const delayOffset = idx * 0.8; // Faster stagger
                        // If many actions, reduce emojis per action to avoid browser lag
                        const emojiCount = unseen.length > 1 ? 5 : 15; 
                        const spawns = Array.from({ length: emojiCount }).map((_, i) => ({
                            id: window.generateId('emj'),
                            emoji: event.emojiType,
                            left: 50 + (Math.random() * 40 - 20) + '%',
                            delay: delayOffset + Math.random() * 0.5,
                            duration: 2 + Math.random() * 1.5,
                            rotate: Math.random() * 60 - 30,
                            sway: (Math.random() * 100 - 50) + 'px'
                        }));
                        allSpawns = [...allSpawns, ...spawns];
                    });
                    setSpamEmojis(prev => [...prev, ...allSpawns]);
                    setTimeout(() => setSpamEmojis([]), (unseen.length * 800) + 3500);

                    // Mark as viewed
                    await fetch('/api/emojis/mark-viewed', {
                        method: 'PUT',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ emojiIds: idsToMark, userEmail: user.email })
                    });
                }
            } catch (e) { console.error("Failed to fetch unseen emojis", e); }
        };
        fetchUnseenEmojis();
        
        // Start polling loop
        const interval = setInterval(fetchUnseenEmojis, 10000);
        return () => clearInterval(interval);
    }, [workspace.id, user]);

    const [editingCard, setEditingCard] = React.useState(null);
    const [tab, setTab] = React.useState('board');
    const [showMemberDropdown, setShowMemberDropdown] = React.useState(false);
    const memberDropdownRef = React.useRef(null);
    React.useEffect(() => {
        const handleClickOutside = (event) => {
            if (memberDropdownRef.current && !memberDropdownRef.current.contains(event.target)) {
                setShowMemberDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);
    const [isAIChatOpen, setIsAIChatOpen] = React.useState(false);
    const [viewArchivedCol, setViewArchivedCol] = React.useState(null);
    const socketRef = React.useRef(null);
    const [lockedCards, setLockedCards] = React.useState({});
    
    React.useEffect(() => {
        if (!window.io) return;
        // Point socket.io to the dynamic backend path explicitly
        const backendUrl = window.location.origin.includes('task.zettalog.com') ? 'https://task.zettalog.com' : window.location.origin;
        const socket = window.io(backendUrl, { path: '/api/socket.io' });
        socketRef.current = socket;
        
        socket.on('card:locked', ({ cardId, user }) => {
            setLockedCards(prev => Object.assign({}, prev, { [cardId]: user }));
        });
        
        socket.on('card:unlocked', ({ cardId }) => {
            setLockedCards(prev => {
                const next = Object.assign({}, prev);
                delete next[cardId];
                return next;
            });
        });
        
        socket.on('card:lock_rejected', ({ cardId, message }) => {
            showToast(message);
            setEditingCard(null);
        });
        
        return () => {
            socket.disconnect();
        };
    }, [workspace.id]);
    const [showBacklog, setShowBacklog] = React.useState(false);
    
    // Safety check for Drag and Drop library
    const dnd = window.ReactBeautifulDnd;
    const [aiMessages, setAiMessages] = React.useState([{ role: 'bot', content: t('alerts.ai_welcome') || "Hello! I am NoobieHelper. I can help you manage your Kanban board via natural language. How can I assist today?" }]);
    const [aiInput, setAiInput] = React.useState('');
    const [aiAttachment, setAiAttachment] = React.useState(null);
    const aiFileInputRef = React.useRef(null);
    const [isAiDragging, setIsAiDragging] = React.useState(false);
    const [showEmojiPicker, setShowEmojiPicker] = React.useState(false);
    const [footerQuote, setFooterQuote] = React.useState(null);
    
    const footerQuoteTimeoutRef = React.useRef(null);
    const [spamEmojis, setSpamEmojis] = React.useState([]);

    const handleEmojiSelect = async (emoji) => {
        setShowEmojiPicker(false);
        
        // Save to backend so others see it
        fetch(`/api/workspaces/${workspace.id}/emojis`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ emojiType: emoji, senderEmail: user?.email })
        }).catch(console.error);

        // Spawn 15 emojis for the Facebook Live effect
        const spawns = Array.from({ length: 15 }).map((_, i) => ({
            id: window.generateId('emj'),
            emoji,
            left: 50 + (Math.random() * 40 - 20) + '%', // Randomly scatter around center
            delay: Math.random() * 0.5,
            duration: 2 + Math.random() * 1.5,
            rotate: Math.random() * 60 - 30,
            sway: (Math.random() * 100 - 50) + 'px'
        }));
        setSpamEmojis(spawns);
        setTimeout(() => setSpamEmojis([]), 3500); // clear after animation

        try {
            const systemMsg = { role: 'system', content: 'You are a motivational speaker.' };
            const userMsg = { role: 'user', content: `Generate a one-line motivational quote based on this emoji: ${emoji}. Make it a funny mix with motivation. Very short and punchy.` };
            const result = await window.AIService.call([systemMsg, userMsg], aiConfig);
            const quote = result.choices[0].message.content || 'Touch grass';
            setFooterQuote(quote);
        } catch(e) {
            console.error(e);
            setFooterQuote('Touch grass');
        }
        
        if (footerQuoteTimeoutRef.current) clearTimeout(footerQuoteTimeoutRef.current);
        // Stay on screen for 1 minute
        footerQuoteTimeoutRef.current = setTimeout(() => setFooterQuote(null), 60000);
    };
    const [aiConfig, setAiConfig] = React.useState({ model: 'gemini-3-flash-preview', apiKey: '[REDACTED_API_KEY]', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/' });
    const [isAISettingsOpen, setIsAISettingsOpen] = React.useState(false);
    const [filterKeyword, setFilterKeyword] = React.useState('');
    const [filterAssignee, setFilterAssignee] = React.useState('');
    const [filterEpic, setFilterEpic] = React.useState('');
    const [filterExpiring, setFilterExpiring] = React.useState(false);
    const userLabel = React.useMemo(() => user?.email?.charAt(0).toUpperCase() || '?', [user]);

    
    const updateWorkspace = async (fields) => {
        const res = await fetch(`/api/workspaces/${workspace.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fields)
        });
        return await res.json();
    };

    const epics = React.useMemo(() => [...new Set((cards || []).map(c => c && c.epic).filter(Boolean))], [cards]);

            const displayCards = React.useMemo(() => {
        const uniqueCards = Array.from(new Map((Array.isArray(cards) ? cards : []).filter(c => c && (c.id || c._id)).map(c => [String(c.id || c._id), c])).values());
        return uniqueCards.filter(c => {
            if (!c) return false;
            if (c.archived) return false;
            const title = c.title || '';
            const content = c.content || '';
            if (filterKeyword && !title.toLowerCase().includes(filterKeyword.toLowerCase()) && !content.toLowerCase().includes(filterKeyword.toLowerCase())) return false;
            if (filterAssignee && (!c.assignees || !c.assignees.includes(filterAssignee))) return false;
            if (filterEpic && (!c.epic || !c.epic.toLowerCase().includes(filterEpic.toLowerCase()))) return false;
            if (filterExpiring) {
                if (!c.dueDate) return false;
                const due = new Date(c.dueDate);
                const now = new Date();
                const diffTime = due - now;
                const diffDays = diffTime / (1000 * 60 * 60 * 24); 
                if (diffDays > 3) return false;
            }
            return true;
        });
    }, [cards, filterKeyword, filterAssignee, filterEpic, filterExpiring]);

    const moveCard = async (id, direction) => {
        const card = cards.find(x => x && x.id === id);
        if (!card) return;
        const currentColId = card.columnId || card.col;
        const colIdx = columns.findIndex(c => c.id === currentColId);
        const nextIdx = colIdx + direction;
        if (nextIdx >= 0 && nextIdx < columns.length) {
            const nextColId = columns[nextIdx].id;
            await fetch(`/api/tasks/${id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ columnId: nextColId, col: nextColId, auditEvent: { user: user?.email || 'System', action: 'Moved card to ' + nextColId } }) });
            setCards(prev => prev.map(c => c.id === id ? { ...c, columnId: nextColId, col: nextColId } : c));
        }
    };

    const headerClass = window.THEMES.find(t => t.id === theme)?.class || 'theme-default';
    const isDarkHeader = ['dark', 'darkblue', 'green', 'ocean'].includes(theme);

    const getMemberData = (email) => {
        return (Array.isArray(allUsers) ? allUsers : []).find(u => u.email === email) || { email, avatar: null };
    };

    const colThemeClasses = React.useMemo(() => {
        switch (theme) {
            case 'dark': return 'bg-[#1A1A1A] text-[#FFFFFF] border-[#333333]';
            case 'darkblue': return 'bg-[#1E3A8A] text-[#FFFFFF] border-[#1E40AF]';
            case 'green': return 'bg-[#065F46] text-[#FFFFFF] border-[#064E3B]';
            case 'ocean': return 'bg-[#0369A1] text-[#FFFFFF] border-[#075985]';
            default: return 'bg-[#FFFFFF] text-[#262626] border-[#f0f0f0]';
        }
    }, [theme]);

    const colIconThemeClasses = React.useMemo(() => {
        if (!theme || theme === 'default') return 'text-gray-400 hover:text-gray-800 hover:bg-black/5';
        return 'text-white hover:text-gray-200 hover:bg-white/10';
    }, [theme]);

    const aiTools = [
  {
    "type": "function",
    "function": {
      "name": "create_card",
      "description": "Creates a new task card in a specific column on the Kanban board. Use this when the user explicitly asks to add, create, or make a new task.",
      "parameters": {
        "type": "object",
        "properties": {
          "title": { "type": "string", "description": "The short, descriptive title of the task." },
          "column_id": { "type": "string", "description": "The exact ID of the column where the card should be placed. This must be retrieved from the dynamically injected board state in the system prompt." },
          "description": { "type": "string", "description": "Optional. Detailed information or instructions for the task." },
          "due_date": { "type": "string", "description": "Optional. The deadline for the task, formatted as an ISO 8601 date string (e.g., '2026-04-19T00:00:00.000Z'). Convert natural language like 'tomorrow' into this format." },
          "priority": { "type": "string", "enum": ["low", "medium", "high"], "description": "Optional. The priority level of the task." }
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
              "status": { "type": "string", "description": "Optional. Filter by the column ID or status name." },
              "expiring_within_days": { "type": "number", "description": "Optional. Number of days to look ahead for expiring tasks (e.g., 2 for 'next 48 hours')." },
              "keyword": { "type": "string", "description": "Optional. A specific word or phrase to search for within task titles and descriptions." },
              "assignee_id": { "type": "string", "description": "Optional. The ID of the user to filter tasks by." }
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
          "card_id": { "type": "string", "description": "The exact unique ID of the card to update. This must be retrieved from the dynamically injected board state in the system prompt." },
          "updates": {
            "type": "object",
            "description": "An object containing only the fields that need to be changed.",
            "properties": {
              "column_id": { "type": "string", "description": "Optional. The new column ID to move the card to." },
              "title": { "type": "string", "description": "Optional. The new title for the card." },
              "description": { "type": "string", "description": "Optional. The new description for the card." },
              "due_date": { "type": "string", "description": "Optional. The new deadline, formatted as an ISO 8601 date string." },
              "assignee_id": { "type": "string", "description": "Optional. The user ID to assign to the card." }
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
          "card_id": { "type": "string", "description": "The exact unique ID of the card to archive. This must be retrieved from the dynamically injected board state in the system prompt." }
        },
        "required": ["card_id"]
      }
    }
  }
];

    const minimizeState = () => {
        const minimizedColumns = (columns || []).map(c => ({ id: c.id, title: c.title }));
        const minimizedTasks = (cards || []).filter(c => c && !c.archived).map(c => ({ id: c.id || c._id, title: c.title, columnId: c.columnId || c.col, urgency: c.urgency, dueDate: c.dueDate, assignees: c.assignees }));
        return JSON.stringify({ columns: minimizedColumns, tasks: minimizedTasks });
    };

    const handleAiFileUpload = (file) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            setAiAttachment({ name: file.name, content: e.target.result });
            showToast(t('alerts.file_attached') || "File attached to AI Context. 📎");
        };
        reader.readAsText(file);
    };

    const handleAISend = async () => {
        if (!aiInput.trim() && !aiAttachment) return;
        const contentStr = aiAttachment ? `Attached Context File: [${aiAttachment.name}]

${aiAttachment.content}

User Request: ${aiInput}` : aiInput;
        const userMsg = { role: 'user', content: contentStr };
        setAiMessages(prev => [...prev, userMsg]);
        setAiInput('');
        setAiAttachment(null);
        
        let currentMessages = [...aiMessages, userMsg];
        let turnLimit = 3; // Prevent infinite loops

        try {
            while (turnLimit > 0) {
                const systemMsg = { role: 'system', content: `You are NoobieHelper. Workspace context: "${workspace.name}". Current board state: ${minimizeState()}. If a user asks about tasks, use the query_board tool first. CRITICAL: When responding to the user, you MUST reply in natural language instead of raw JSON. Never output raw arrays or JSON objects to the user.` };
                const chatHistory = [systemMsg, ...currentMessages.map(m => {
                    if (m.role === 'tool_result') return { role: 'tool', name: m.name, tool_call_id: m.tool_call_id, content: m.content };
                    return { role: m.role === 'bot' ? 'assistant' : m.role, content: m.content, tool_calls: m.tool_calls };
                })];
                
                const result = await window.AIService.call(chatHistory, aiConfig, aiTools);
                const choice = result.choices[0].message;
                const assistantTurn = { role: 'bot', content: choice.content || (choice.tool_calls ? null : "I couldn't process that request."), tool_calls: choice.tool_calls };
                currentMessages.push(assistantTurn);
                setAiMessages(prev => [...prev, assistantTurn]);

                if (choice.tool_calls && choice.tool_calls.length > 0) {
                    for (const tool of choice.tool_calls) {
                        const args = JSON.parse(tool.function.arguments);
                        let toolResponseContent = "";

                        if (tool.function.name === 'create_card') {
                            const pMap = { low: 'LOW', medium: 'MED', high: 'HIGH' };
                            const mappedUrgency = pMap[args.priority?.toLowerCase()] || 'LOW';
                            const nc = { 
                                columnId: args.column_id || 'todo', 
                                title: args.title, 
                                content: args.description || '', 
                                urgency: mappedUrgency, 
                                dueDate: args.due_date || '', 
                                assignees: [user?.email], 
                                attachments: [], 
                                checklist: [], 
                                auditEvent: { user: user?.email || 'System', action: 'AI created card' } 
                            };
                            try {
                                const res = await fetch(`/api/workspaces/${workspace.id}/tasks`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(nc) });
                                const saved = await res.json();
                                if (!res.ok) {
                                    toolResponseContent = `Error: Failed to create task. ${saved.error || res.statusText}`;
                                } else {
                                    const resolvedId = saved._id || saved.id;
                                    setCards(prev => [...prev, { ...saved, id: resolvedId }]);
                                    toolResponseContent = `Success: Created task "${args.title}" (ID: ${resolvedId})`;
                                }
                            } catch (e) {
                                toolResponseContent = `Error: Network failure. ${e.message}`;
                            }
                        }
                        else if (tool.function.name === 'query_board') {
                            const filters = args.filters || {};
                            let filtered = cards.filter(c => !c.archived);
                            if (filters.status) filtered = filtered.filter(c => (c.columnId || c.col) === filters.status);
                            if (filters.keyword) filtered = filtered.filter(c => c.title.toLowerCase().includes(filters.keyword.toLowerCase()) || (c.content && c.content.toLowerCase().includes(filters.keyword.toLowerCase())));
                            if (filters.assignee_id) filtered = filtered.filter(c => c.assignees && c.assignees.includes(filters.assignee_id));
                            if (filters.expiring_within_days !== undefined) {
                                filtered = filtered.filter(c => {
                                    if (!c.dueDate) return false;
                                    const due = new Date(c.dueDate);
                                    const now = new Date();
                                    const diffDays = (due - now) / (1000 * 60 * 60 * 24);
                                    return diffDays <= filters.expiring_within_days;
                                });
                            }
                            toolResponseContent = JSON.stringify(filtered.map(c => ({ id: c.id || c._id, title: c.title, columnId: c.columnId || c.col, dueDate: c.dueDate })));
                        }
                        else if (tool.function.name === 'update_card') {
                            const updates = args.updates || {};
                            // Map snake_case from AI to camelCase for backend/frontend
                            const mappedUpdates = {};
                            if (updates.column_id) mappedUpdates.columnId = updates.column_id;
                            if (updates.title) mappedUpdates.title = updates.title;
                            if (updates.description) mappedUpdates.content = updates.description;
                            if (updates.due_date) mappedUpdates.dueDate = updates.due_date;
                            if (updates.assignee_id) mappedUpdates.assignees = [updates.assignee_id];
                            if (updates.priority) {
                                const pMap = { low: 'LOW', medium: 'MED', high: 'HIGH' };
                                mappedUpdates.urgency = pMap[updates.priority?.toLowerCase()] || 'LOW';
                            }

                            const payload = { ...mappedUpdates, auditEvent: { user: user?.email || 'System', action: 'AI updated card' } };
                            try {
                                const res = await fetch(`/api/tasks/${args.card_id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
                                const updated = await res.json();
                                if (!res.ok) {
                                    toolResponseContent = `Error: Failed to update task. ${updated.error || res.statusText}`;
                                } else {
                                    setCards(prev => (prev || []).map(c => (c && (c.id === args.card_id || c._id === args.card_id)) ? { ...c, ...mappedUpdates } : c));
                                    toolResponseContent = `Success: Updated task ${args.card_id}`;
                                }
                            } catch (e) {
                                toolResponseContent = `Error: Network failure. ${e.message}`;
                            }
                        }
                        else if (tool.function.name === 'archive_card') {
                            try {
                                const res = await fetch(`/api/tasks/${args.card_id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ archived: true, auditEvent: { user: user?.email || 'System', action: 'AI archived card' } }) });
                                if (!res.ok) {
                                    const errData = await res.json().catch(()=>({}));
                                    toolResponseContent = `Error: Failed to archive task. ${errData.error || res.statusText}`;
                                } else {
                                    setCards(prev => (prev || []).map(c => (c && (c.id === args.card_id || c._id === args.card_id)) ? { ...c, archived: true } : c));
                                    toolResponseContent = `Success: Archived task ${args.card_id}`;
                                }
                            } catch (e) {
                                toolResponseContent = `Error: Network failure. ${e.message}`;
                            }
                        }

                        const resultTurn = { role: 'tool_result', name: tool.function.name, tool_call_id: tool.id, content: toolResponseContent };
                        currentMessages.push(resultTurn);
                        setAiMessages(prev => [...prev, resultTurn]);
                    }
                    turnLimit--;
                    continue; // Loop for followup
                }
                break; // No more tools, stop
            }
        } catch (err) {
            setAiMessages(prev => [...prev, { role: 'bot', content: `Error: ${err.message}` }]);
        }
    };

    const isAdmin = user?.email === window.NT_ADMIN_EMAIL || user?.email === 'admin@noobieteam.ai';
    const [showUserManagement, setShowUserManagement] = React.useState(false);

    


    if (!dnd) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-yellow-50 p-10">
                <div className="max-w-md bg-white p-8 rounded-3xl shadow-xl text-center">
                    <h2 className="text-xl font-black text-yellow-600 mb-4">{t('alerts.library_load_error')}</h2>
                    <p className="text-sm text-gray-500 mb-6">The Drag and Drop engine (ReactBeautifulDnd) failed to initialize. This usually happens due to a slow network connection to the CDN.</p>
                    <button onClick={() => window.location.reload()} className="px-6 py-2 bg-yellow-500 text-white rounded-full text-[10px] font-black uppercase tracking-widest">{t('actions.retry_connection')}</button>
                </div>
            </div>
        );
    }
    
    return (
        <div className="h-screen flex flex-col bg-white overflow-hidden text-black">
            <nav className={`h-16 px-6 flex items-center justify-between sticky top-0 z-[120] transition-colors duration-500 shadow-sm ${headerClass}`}>
                <div className="flex items-center gap-6">
                    <button onClick={() => showConfirm(t('actions.exit_workspace') || 'Exit Workspace', t('alerts.confirm_exit_workspace') || 'Are you sure you want to return to the workspace selection hub?', onBack)} className={`p-2.5 hover:bg-black/5 rounded-xl transition ${isDarkHeader ? 'text-white' : 'text-black'}`}><window.Icon name="arrow-left" size={20}/></button>
                    <div className={`leading-none ${isDarkHeader ? 'text-white' : 'text-black'}`}><h2 className="text-lg font-black tracking-tighter italic mr-4">{t('app_name')}</h2><p className="text-[8px] font-black uppercase tracking-[0.4em] opacity-50 mt-1.5">{workspace.name}</p></div>
                    {isAdmin && (
                        <button onClick={() => setShowUserManagement(true)} className={`text-[10px] font-black uppercase tracking-widest transition hover:opacity-70 flex items-center gap-2 ${isDarkHeader ? 'text-white/80' : 'text-gray-500'}`}>
                            <window.Icon name="users" size={14} /> {t('labels.user_management')}
                        </button>
                    )}
                </div>
                <div className="hidden md:flex bg-black/5 p-1 rounded-2xl gap-1">
                    <button onClick={() => setTab('board')} className={`px-8 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition ${tab === 'board' ? 'bg-white shadow-lg text-black' : isDarkHeader ? 'text-white opacity-40 hover:opacity-100' : 'opacity-40 hover:opacity-100'}`}>{t('tabs.board')}</button>
                    <button onClick={() => setTab('vault')} className={`px-8 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition ${tab === 'vault' ? 'bg-white shadow-lg text-black' : isDarkHeader ? 'text-white opacity-40 hover:opacity-100' : 'opacity-40 hover:opacity-100'}`}>{t('tabs.vault')}</button>
                    <button onClick={() => setTab('docs')} className={`px-8 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition ${tab === 'docs' ? 'bg-white shadow-lg text-black' : isDarkHeader ? 'text-white opacity-40 hover:opacity-100' : 'opacity-40 hover:opacity-100'}`}>{t('tabs.docs')}</button>
                </div>
                <div className="flex items-center gap-6 relative">
                    <div ref={memberDropdownRef} className={`p-2.5 rounded-xl transition cursor-pointer relative ${isDarkHeader ? "bg-white/10 hover:bg-white/20" : "bg-black/5 hover:bg-black/10"}`} 
                         onClick={() => setShowMemberDropdown(!showMemberDropdown)}>
                        <window.Icon name="users" size={18} className={isDarkHeader ? "text-white" : "text-black"} />
                        {showMemberDropdown && (
                            <div className="absolute top-full right-0 mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 p-5 z-[150] animate-pop text-black">
                                <div className="flex justify-between items-center mb-3 px-1">
                                    <p className="text-xs font-black uppercase tracking-widest text-gray-400">{t('labels.board_members')}</p>
                                    <div className="flex gap-2">
                                        <button onClick={(e) => { e.stopPropagation(); showConfirm(t('labels.leave_workspace_title'), t('alerts.confirm_detach_workspace'), async () => { const newMembers = members.filter(m => m !== user?.email); setMembers(newMembers); await fetch(`/api/workspaces/${workspace.id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ members: newMembers.map(u => ({userId: u, role: 'MEMBER'})) }) }); setTimeout(onBack, 100); }); }} className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg transition" title={t('actions.leave_workspace')}><window.Icon name="user-minus" size={14}/></button>
                                        <button onClick={(e) => { e.stopPropagation(); showPrompt(t('labels.invite_user_title'), t('labels.user_email'), async (email) => { if(email) { const newMembers = [...members, email]; setMembers(newMembers); await fetch(`/api/workspaces/${workspace.id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ members: newMembers.map(u => ({userId: u, role: 'MEMBER'})) }) }); } }); }} className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition" title={t('actions.invite_user')}><window.Icon name="user-plus" size={14}/></button>
                                    </div>
                                </div>
                                <div className="space-y-1.5 max-h-56 overflow-y-auto no-scrollbar">
                                    {members.filter(m => m && typeof m === 'string').map(m => {
                                        const md = getMemberData(m);
                                        return (
                                            <div key={m} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-xl transition group">
                                                <window.Avatar label={m.charAt(0).toUpperCase()} src={md.avatar} size="sm" story />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-black truncate">{m.split('@')[0]}</p>
                                                    <p className="text-xs text-gray-400 truncate">{m}</p>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                    <window.ProfileMenu user={user} onLogout={onLogout} onThemeChange={onThemeChange} currentTheme={theme} onUpdateUser={onUpdateUser} />
                </div>
            </nav>
            {/* Mobile Tab Nav */}
            <div className="md:hidden flex bg-black/5 p-2 gap-2 justify-center border-b border-gray-100">
                <button onClick={() => setTab('board')} className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition ${tab === 'board' ? 'bg-white shadow-md text-black' : 'text-gray-500 opacity-60'}`}>{t('tabs.board')}</button>
                <button onClick={() => setTab('vault')} className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition ${tab === 'vault' ? 'bg-white shadow-md text-black' : 'text-gray-500 opacity-60'}`}>{t('tabs.vault')}</button>
                <button onClick={() => setTab('docs')} className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition ${tab === 'docs' ? 'bg-white shadow-md text-black' : 'text-gray-500 opacity-60'}`}>{t('tabs.docs')}</button>
            </div>
            {tab === 'board' ? (
                <main className="p-4 md:p-8 flex-1 overflow-x-auto overflow-y-hidden no-scrollbar flex flex-col animate-fade-in h-full">
                    <header className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 md:mb-12 gap-4 md:gap-6">
                        <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-8 w-full overflow-hidden">
                            <h1 className="text-2xl md:text-4xl font-black tracking-tighter truncate">{workspace.name}</h1>
                            <div className="flex items-center gap-3 bg-gray-50/80 p-1.5 rounded-2xl border border-gray-100 flex-shrink-0">
                                <div className="relative">
                                    <window.Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input className="pl-8 pr-3 py-1.5 bg-white border border-gray-200 rounded-xl text-[10px] font-bold outline-none focus:border-blue-500 w-32 lg:w-48" placeholder={t('labels.search_placeholder')} value={filterKeyword} onChange={e => setFilterKeyword(e.target.value)} />
                                </div>
                                <input className="bg-white text-[10px] font-bold px-3 py-1.5 rounded-xl border border-gray-200 outline-none w-32 text-gray-600" placeholder={t('labels.epic_tag') || 'Filter by Epic'} value={filterEpic} onChange={e => setFilterEpic(e.target.value)} />
                                <select className="bg-white text-[10px] font-bold px-3 py-1.5 rounded-xl border border-gray-200 outline-none cursor-pointer text-gray-600" value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
                                    <option value="">{t('labels.all_members')}</option>
                                    {members.filter(m => m && typeof m === 'string').map(m => <option key={m} value={m}>{m.split('@')[0]}</option>)}
                                </select>
                                <button onClick={() => setFilterExpiring(!filterExpiring)} className={`p-2 rounded-xl border transition ${filterExpiring ? 'bg-red-500 border-red-500 text-white shadow-lg' : 'bg-white border-gray-200 text-gray-400 hover:text-red-500'}`} title={t('labels.expiring_soon')}>
                                    <window.Icon name="clock" size={14} />
                                </button>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => setShowBacklog(!showBacklog)} className={`px-6 py-4 rounded-full text-[9px] font-black uppercase tracking-widest shadow-xl active:scale-95 transition flex items-center gap-2 ${showBacklog ? 'bg-blue-100 text-blue-700' : 'bg-white text-gray-700 border border-gray-200'}`}><window.Icon name="list" size={14} /> {t('actions.backlog')}</button>
                            <button onClick={() => showPrompt(t('actions.new_stage'), t('labels.stage_name'), async (name) => { if(name) { const newCols = [...columns, { id: window.generateId('col'), title: name }]; await fetch(`/api/workspaces/${workspace.id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ columns: newCols }) }); setColumns(newCols); } })} className="bg-black text-white px-8 py-4 rounded-full text-[9px] font-black uppercase tracking-widest shadow-xl active:scale-95 transition flex-shrink-0">{t('actions.new_stage')}</button>
                        </div>
                    </header>
                    <dnd.DragDropContext onDragEnd={async (result) => {
                                if (!result.destination) return;
                                const { source, destination, draggableId, type } = result;
                                
                                if (type === 'COLUMN') {
                                    const newCols = [...columns];
                                    const [removed] = newCols.splice(source.index, 1);
                                    newCols.splice(destination.index, 0, removed);
                                    setColumns(newCols);
                                    await fetch(`/api/workspaces/${workspace.id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ columns: newCols }) });
                                    return;
                                }

                                const newCards = [...cards];
                                const draggedIdx = newCards.findIndex(c => c.id === draggableId);
                                if (draggedIdx === -1) return;
                                
                                const draggedCard = { ...newCards[draggedIdx], columnId: destination.droppableId };
                                newCards.splice(draggedIdx, 1);
                                
                                const destColCards = newCards.filter(c => c && c.columnId === destination.droppableId && !c.archived);
                                
                                if (destination.index >= destColCards.length) {
                                    newCards.push(draggedCard);
                                } else {
                                    const anchorCardId = destColCards[destination.index].id;
                                    const globalInsertIdx = newCards.findIndex(c => c.id === anchorCardId);
                                    newCards.splice(globalInsertIdx, 0, draggedCard);
                                }
                                
                                // Recalculate order index for the destination column
                                const destColUpdatedCards = newCards.filter(c => c && c.columnId === destination.droppableId && !c.archived);
                                const bulkUpdates = destColUpdatedCards.map((c, i) => {
                                    c.orderIndex = i;
                                    return { id: c.id || c._id, orderIndex: i, columnId: c.columnId };
                                });
                                
                                setCards(newCards);
                                await fetch(`/api/tasks/${draggableId}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ columnId: destination.droppableId, auditEvent: { user: user?.email || 'System', action: 'Moved card to ' + destination.droppableId } }) });
                                await fetch(`/api/workspaces/${workspace.id || workspace._id}/tasks/bulk-order`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ updates: bulkUpdates }) });
                            }}>
                            <div className="flex flex-col md:flex-row gap-6 flex-1 overflow-hidden h-full w-full">
                        {showBacklog && (
                            <div className="w-full md:w-80 flex-shrink-0 bg-gray-50 border border-gray-200 rounded-[2rem] flex flex-col h-[50vh] md:h-full animate-fade-in">
                                <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-100/50 rounded-t-[2rem]">
                                    <h3 className="text-sm font-black uppercase tracking-widest text-gray-700 flex items-center gap-2">
                                        <window.Icon name="list" size={16} className="text-gray-500" />
                                        {t('actions.backlog')}
                                    </h3>
                                    <div className="flex gap-1 opacity-50 hover:opacity-100 transition">
                                        <button onClick={() => setShowBacklog(false)} className="p-1 hover:bg-gray-200 rounded"><window.Icon name="x" size={14}/></button>
                                    </div>
                                </div>
                                <dnd.Droppable droppableId="backlog">
                                    {(provided) => (
                                        <div ref={provided.innerRef} {...provided.droppableProps} className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-2 min-h-[100px]">
                                            {displayCards.filter(c => c && (c.columnId === 'backlog' || c.col === 'backlog')).map((card, idx) => (
                                                <dnd.Draggable key={`backlog-${card.id || card._id || idx}`} draggableId={String(card.id || card._id)} index={idx}>
                                                    {(dragProvided, snapshot) => (
                                                        <div ref={dragProvided.innerRef} {...dragProvided.draggableProps} {...dragProvided.dragHandleProps} onClick={() => { const cId = card.id || card._id; if (lockedCards[cId] && lockedCards[cId] !== user?.email) { showToast(t('alerts.card_locked', { user: lockedCards[cId] }) || `Locked by ${lockedCards[cId]}`); } else { setEditingCard(card); } }} className={`bg-white border border-gray-100 rounded-xl p-3 shadow-sm hover:shadow-md transition cursor-pointer flex justify-between items-center group ${snapshot.isDragging ? 'rotate-2 scale-105 shadow-xl z-50' : ''}`}>
                                                            {lockedCards[card.id || card._id] && lockedCards[card.id || card._id] !== user?.email && <div className="absolute -top-2 -right-2 bg-red-100 text-red-600 rounded-full p-1 z-10 shadow-sm border border-white" title={`Locked by ${lockedCards[card.id || card._id]}`}><window.Icon name="lock" size={12}/></div>}
<div className="flex flex-col gap-1 overflow-hidden pr-2">
                                                                <span className="font-bold text-xs text-gray-800 truncate">{card.epic ? <span className="mr-1 text-[8px] px-1 bg-purple-100 text-purple-700 rounded uppercase">{card.epic}</span> : null}{card.title}</span>
                                                                <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                                                                    {card.dueDate ? new Date(card.dueDate).toLocaleDateString() : t('labels.no_date')}
                                                                </span>
                                                            </div>
                                                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${ {low: 'bg-blue-300', med: 'bg-yellow-400', high: 'bg-red-500', LOW: 'bg-blue-300', MED: 'bg-yellow-400', HIGH: 'bg-red-500'}[card.urgency?.toLowerCase() || 'low'] }`}></div>
                                                        </div>
                                                    )}
                                                </dnd.Draggable>
                                            ))}
                                            {provided.placeholder}
                                        </div>
                                    )}
                                </dnd.Droppable>
                                <div className="p-3 border-t border-gray-200 bg-gray-100/50 rounded-b-[2rem]">
                                    <button onClick={() => { 
                                        const nc = { columnId: 'backlog', title: t('labels.new_backlog_item'), urgency: 'LOW', assignees: [user?.email], auditEvent: { user: user?.email || 'System', action: 'Created backlog card' } };
                                        fetch(`/api/workspaces/${workspace.id}/tasks`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(nc) }).then(r=>r.json()).then(task => { const resId = task.id || task._id; const finalTask = { ...task, id: resId }; setCards(prev => [...prev, finalTask]); setEditingCard(finalTask); }); 
                                    }} className="w-full py-2 bg-white border border-gray-200 text-gray-600 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-gray-50 transition shadow-sm flex items-center justify-center gap-2">
                                        <window.Icon name="plus" size={14} /> {t('actions.add_to_backlog')}
                                    </button>
                                </div>
                            </div>
                        )}
                        <dnd.Droppable droppableId="all-columns" direction="horizontal" type="COLUMN">
                        {(providedBoard) => (
                            <div className="flex flex-col md:flex-row gap-6 md:gap-10 flex-1 h-full overflow-x-auto overflow-y-hidden no-scrollbar w-full" {...providedBoard.droppableProps} ref={providedBoard.innerRef}>
                                {columns.filter(col => col.id !== 'backlog').map((col, index) => (
                                    <dnd.Draggable key={String(col.id || `col-${index}`)} draggableId={String(col.id || `col-${index}`)} index={index}>
                                        {(providedCol) => (
                                            <div ref={providedCol.innerRef} {...providedCol.draggableProps} className={`w-full md:w-80 flex flex-col gap-4 group ${colThemeClasses} rounded-[2rem] p-4 h-full max-h-full overflow-hidden flex-shrink-0`}>
                                                <div {...providedCol.dragHandleProps} className={`flex justify-between items-center px-4 border-b border-inherit pb-4 pt-2 flex-shrink-0`}>
                                                    <div className="flex gap-2 items-center min-w-0"><h3 className="text-sm font-black uppercase tracking-widest text-inherit truncate">{col.title}</h3><button onClick={() => setViewArchivedCol(col.id)} className={`opacity-0 group-hover:opacity-100 transition p-1.5 rounded-lg ${colIconThemeClasses} flex-shrink-0`} title={t('labels.archived_cards')}><window.Icon name="archive" size={16}/></button></div>
                                                    <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition">
                                                        <button onClick={() => { 
                                                            const nc = { columnId: col.id, title: t('labels.new_task'), urgency: 'LOW', assignees: [user?.email], auditEvent: { user: user?.email || 'System', action: 'Created card' } };
                                                            fetch(`/api/workspaces/${workspace.id}/tasks`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(nc) }).then(r=>r.json()).then(task => { const resId = task.id || task._id; const finalTask = { ...task, id: resId }; setCards(prev => [...prev, finalTask]); setEditingCard(finalTask); }); 
                                                        }} className={`p-1.5 rounded-lg transition ${colIconThemeClasses}`} title={t('actions.new_task')}><window.Icon name="plus-circle" size={18} /></button>
                                                        {col.id !== 'todo' && <button onClick={() => showConfirm(t('actions.erase_stage'), t('alerts.confirm_erase_stage', {name: col.title}), async () => { 
                                                const newCols = columns.filter(c => c.id !== col.id);
                                                await fetch(`/api/workspaces/${workspace.id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ columns: newCols }) });
                                                setColumns(newCols);
                                            })} className={`p-1.5 rounded-lg transition ${colIconThemeClasses}`} title={t('actions.erase_stage')}><window.Icon name="minus-circle" size={18} /></button>}
                                                    </div>
                                                </div>
                                                <dnd.Droppable droppableId={String(col.id || `col-${index}`)}>
                                                    {(providedCards) => (
                                                        <div ref={providedCards.innerRef} {...providedCards.droppableProps} className="space-y-8 min-h-[100px] overflow-y-auto no-scrollbar flex-1 pb-4">
                                                            {displayCards.filter(c => c && (c.columnId === col.id || c.col === col.id)).map((card, idx) => (
                                                                <dnd.Draggable key={`col-${card.id || card._id || idx}`} draggableId={String(card.id || card._id)} index={idx}>
                                                                    {(provided, snapshot) => (
                                                                        <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps} onClick={() => { const cId = card.id || card._id; if (lockedCards[cId] && lockedCards[cId] !== user?.email) { showToast(t('alerts.card_locked', { user: lockedCards[cId] }) || `Locked by ${lockedCards[cId]}`); } else { setEditingCard(card); } }} className={`bg-white text-gray-800 border border-gray-100 rounded-2xl p-4 insta-shadow hover:shadow-xl transition-all duration-300 cursor-pointer group relative ${snapshot.isDragging ? 'rotate-2 scale-105 shadow-2xl z-50' : 'hover:scale-[1.02]'}`}>
                                            {lockedCards[card.id || card._id] && lockedCards[card.id || card._id] !== user?.email && <div className="absolute top-2 right-2 bg-red-100 text-red-600 rounded-full p-1.5 z-10 shadow-sm border border-white" title={`Locked by ${lockedCards[card.id || card._id]}`}><window.Icon name="lock" size={14}/></div>}
<div className="flex justify-between items-start mb-3"><div className={`w-16 h-2 rounded-full ${ {low: 'bg-blue-300', med: 'bg-yellow-400', high: 'bg-red-500', LOW: 'bg-blue-300', MED: 'bg-yellow-400', HIGH: 'bg-red-500'}[card.urgency?.toLowerCase() || 'low'] }`}></div><div className="opacity-0 group-hover:opacity-100 flex gap-2 transition" onClick={e => e.stopPropagation()}><button onClick={async (e) => { e.stopPropagation(); await fetch(`/api/tasks/${card.id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ archived: true, auditEvent: { user: user?.email || 'System', action: 'Archived card' } }) }); setCards(cards.map(c => c.id === card.id ? { ...c, archived: true } : c)); showToast(t('alerts.card_archived'), 'success'); }} className="p-2 bg-gray-50 text-gray-400 hover:text-red-500 rounded-xl hover:bg-red-50" title={t('actions.archive')}><window.Icon name="archive" size={14}/></button><button onClick={(e) => { e.stopPropagation(); moveCard(card.id, -1); }} className="p-2 bg-gray-50 rounded-xl hover:bg-gray-100"><window.Icon name="arrow-left" size={14}/></button><button onClick={(e) => { e.stopPropagation(); moveCard(card.id, 1); }} className="p-2 bg-gray-50 rounded-xl hover:bg-gray-100"><window.Icon name="arrow-right" size={14}/></button></div></div>
                                            {card.epic && <div className="inline-block px-2 py-0.5 bg-purple-100 text-purple-700 text-[8px] font-black uppercase tracking-widest rounded mb-2 shadow-sm border border-purple-200">{card.epic}</div>}
                                            <h4 className="font-black text-base leading-tight mb-3 tracking-tight">{card.title}</h4>
                                            {card.dueDate && <div className="inline-flex items-center gap-2.5 bg-red-50 text-red-500 px-3 py-1.5 rounded-full text-[8px] font-black uppercase tracking-widest mb-3 border-2 border-red-100 shadow-lg shadow-red-100"><window.Icon name="calendar" size={14} /> {card.dueDate}</div>}
                                            {card.checklist?.length > 0 && <div className="w-full bg-gray-50 h-1.5 rounded-full overflow-hidden mb-3 border border-gray-100"><div className="bg-emerald-400 h-fit max-h-full transition-all duration-1000" style={{ width: `${(card.checklist.filter(i => i && i.done).length / card.checklist.length) * 100}%` }}></div></div>}
                                            <div className="pt-3 border-t border-gray-50 flex items-center justify-between text-gray-300">
                                                <div className="flex -space-x-2">
                                                    {card.assignees?.map(email => {
                                                        if (!email) return null;
                                                        const m = getMemberData(email);
                                                        return <window.Avatar key={email} label={email.charAt(0).toUpperCase()} src={m.avatar} size="sm" active />;
                                                    })}
                                                </div>
                                                <div className="flex gap-2">
                                                    {card.attachments?.length > 0 && <window.Icon name="paperclip" size={14} />}
                                                    {card.content && <window.Icon name="align-left" size={14} />}
                                                    {card.comments?.length > 0 && <div className="flex items-center gap-1 text-[10px] font-bold text-gray-400"><window.Icon name="message-circle" size={14} /> {card.comments.length}</div>}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                                                </dnd.Draggable>
                                                            ))}
                                                            {providedCards.placeholder}
                                                        </div>
                                                    )}
                                                </dnd.Droppable>
                                            </div>
                                        )}
                                    </dnd.Draggable>
                                ))}
                                {providedBoard.placeholder}
                            </div>
                        )}
                    </dnd.Droppable>
                    </div>
                    </dnd.DragDropContext>
                </main>
            ) : tab === 'vault' ? <window.VaultTab workspace={workspace} user={user} onUpdate={updateWorkspace} onUpdateUser={onUpdateUser} /> : tab === 'docs' ? <window.DocTab workspaceId={workspace?.id || workspace?._id} user={user} /> : null}
            {editingCard && <window.CardModal card={editingCard} user={user} members={members} allUsers={allUsers} socket={socketRef.current} workspaceId={workspace.id || workspace._id} onClose={() => setEditingCard(null)} onSave={async (upd) => { 
                const cardId = editingCard.id || editingCard._id; 
                const res = await fetch(`/api/tasks/${cardId}`, { method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify(upd) }); 
                const updatedTask = await res.json(); 
                if (!res.ok) {
                    if (res.status === 409) {
                        showAlert(t('alerts.overwrite_conflict') || updatedTask.error || "Conflict: This card was modified by another user recently. Please refresh to avoid overwriting their work.", t('alerts.conflict') || "Overwrite Conflict");
                    } else {
                        showAlert(updatedTask.error || "Failed to update task", "Update Error");
                    }
                    return;
                }
                setCards(prev => (prev || []).map(c => (c && (c.id === cardId || c._id === cardId)) ? updatedTask : c)); 
                setEditingCard(null); 
            }} onDelete={async (id) => { await fetch(`/api/tasks/${id}`, { method: "DELETE" }); setCards(prev => (prev || []).filter(c => c && (c.id !== id && c._id !== id))); setEditingCard(null); }} />}
            
            
            {/* Emoji Spam Animation */}
            {spamEmojis.map(s => (
                <div key={s.id} className="fixed z-[2000] text-4xl pointer-events-none animate-fly-up-fade" style={{ left: s.left, bottom: '15%', animationDelay: `${s.delay}s`, animationDuration: `${s.duration}s`, '--sway': s.sway, transform: `rotate(${s.rotate}deg)` }}>
                    {s.emoji}
                </div>
            ))}

            {/* AI Floating Quoter (Emoji Icon) */}
            <div className={`fixed right-5 z-[2001] transition-all duration-400 ${isJukeboxActive ? 'bottom-[calc(45%+70px)]' : 'bottom-[calc(25%+70px)]'}`}>
                <div className="relative">
                    <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-2xl hover:scale-110 active:scale-95 transition border border-gray-100"><window.Icon name="smile" size={24} className="text-yellow-500" /></button>
                    {showEmojiPicker && (
                        <div className="absolute bottom-0 right-16 bg-white p-4 rounded-3xl shadow-2xl flex flex-wrap gap-3 border border-gray-100 animate-pop w-[280px]">
                            {['😀','😂','😡','🤯','🤖','☕','🔥','🚀','💡','🏆','🎯','💪','🎉','😎','😴','🙌','🙏','🌟','✨','💯','🦄','🐉'].map(e => (
                                <button key={e} onClick={() => handleEmojiSelect(e)} className="text-2xl hover:scale-125 transition transform origin-center">{e}</button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* AI Footer Quote with typing animation */}
            {footerQuote && (
                <div className="fixed bottom-0 left-0 right-0 z-[1000] p-4 pointer-events-none">
                    <div className="w-3/4 max-w-4xl mx-auto bg-black/80 backdrop-blur-md border border-white/10 text-white px-8 py-4 rounded-full text-center shadow-2xl shadow-blue-500/20 animate-fade-in-up">
                        <p className="text-xs font-black uppercase tracking-widest typing-effect overflow-hidden whitespace-nowrap">{footerQuote}</p>
                    </div>
                </div>
            )}
            
            {/* Floating AI Assistant Chat */}
            
            {showExpiredModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-xl z-[9999] flex items-center justify-center p-4 animate-fade-in">
                    <div className="max-w-[480px] w-full bg-white p-8 rounded-[2.5rem] shadow-2xl border border-red-500/30">
                        <div className="w-16 h-16 bg-red-50 rounded-3xl flex items-center justify-center mx-auto mb-6"><window.Icon name="alert-triangle" size={32} className="text-red-500" /></div>
                        <h2 className="text-3xl font-black italic tracking-tighter mb-2 text-center text-black">{t('labels.action_required')}</h2>
                        <p className="text-xs text-gray-500 mb-6 text-center font-bold">{t('alerts.overdue_msg')}</p>
                        
                        <div className="max-h-[200px] overflow-y-auto no-scrollbar space-y-2 mb-6 border border-gray-100 rounded-2xl p-4 bg-gray-50">
                            {expiredCards.map(c => (
                                <div key={c.id || c._id} className="flex justify-between items-center text-xs">
                                    <span className="font-bold text-gray-800 truncate pr-4">{c.title}</span>
                                    <span className="text-[9px] font-black text-red-500 uppercase tracking-widest whitespace-nowrap bg-red-50 px-2 py-1 rounded-md">{new Date(c.dueDate).toLocaleDateString()}</span>
                                </div>
                            ))}
                        </div>

                        <div className="space-y-3">
                            <button onClick={async () => {
                                const cardIds = expiredCards.map(c => c.id || c._id);
                                await fetch(`/api/workspaces/${workspace.id}/tasks/bulk-archive`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ cardIds }) });
                                setCards(prev => prev.map(c => cardIds.includes(c.id || c._id) ? { ...c, archived: true, expiredAlertAcknowledged: true } : c));
                                setShowExpiredModal(false);
                                showToast(t('alerts.workspace_archived'));
                            }} className="w-full py-3 bg-red-500 text-white rounded-xl text-xs font-black tracking-widest uppercase shadow-lg shadow-red-200 hover:scale-105 active:scale-95 transition">
                                {t('actions.archive_all_expired')}
                            </button>
                            
                            <div className="flex gap-2">
                                <select value={selectedMoveCol} onChange={e => setSelectedMoveCol(e.target.value)} className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-black">
                                    {columns.map(col => <option key={col.id} value={col.id}>{col.title}</option>)}
                                </select>
                                <button onClick={async () => {
                                    if (!selectedMoveCol) return;
                                    const cardIds = expiredCards.map(c => c.id || c._id);
                                    await fetch(`/api/workspaces/${workspace.id}/tasks/bulk-move`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ cardIds, targetColumn: selectedMoveCol }) });
                                    setCards(prev => prev.map(c => cardIds.includes(c.id || c._id) ? { ...c, columnId: selectedMoveCol, col: selectedMoveCol, expiredAlertAcknowledged: true } : c));
                                    setShowExpiredModal(false);
                                    showToast(t('alerts.tasks_moved'));
                                }} className="px-6 py-3 bg-black text-white rounded-xl text-xs font-black tracking-widest uppercase shadow-lg shadow-gray-300 hover:scale-105 active:scale-95 transition">
                                    {t('actions.move_all')}
                                </button>
                            </div>

                            <button onClick={() => setShowExpiredModal(false)} className="w-full py-3 text-gray-500 rounded-xl text-[10px] font-black tracking-widest uppercase hover:bg-gray-50 transition">
                                {t('actions.do_nothing')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className={`ai-floating ${isJukeboxActive ? 'ai-floating-shifted' : 'ai-floating-default'} ${isAIChatOpen ? 'ai-maximized bg-white' : 'ai-minimized bg-black'} animate-pop`}>
                {isAIChatOpen ? (
                    <>
                        <div className="p-4 bg-black text-white flex justify-between items-center">
                            <div className="flex items-center gap-2"><window.Icon name="sparkles" size={16} /><span className="text-xs font-black uppercase tracking-widest">NoobieHelper</span></div>
                            <div className="flex gap-2">
                                <button onClick={() => setIsAISettingsOpen(true)} className="p-1 hover:bg-white/10 rounded transition"><window.Icon name="settings" size={14}/></button>
                                <button onClick={() => setIsAIChatOpen(false)} className="p-1 hover:bg-white/10 rounded transition"><window.Icon name="minus" size={14}/></button>
                            </div>
                        </div>
                        <div className="flex-1 p-4 overflow-y-auto no-scrollbar flex flex-col">
                            {aiMessages.map((msg, i) => (
                                <div key={i} className={`ai-message ${msg.role === 'user' ? 'ai-msg-user' : 'ai-msg-bot'}`}>{msg.content}</div>
                            ))}
                        </div>
                        {aiAttachment && (
                            <div className="px-4 py-2 bg-blue-50 border-t border-blue-100 flex justify-between items-center text-xs text-blue-700 font-bold">
                                <div className="flex items-center gap-2 truncate"><window.Icon name="file-text" size={14} /> {aiAttachment.name}</div>
                                <button onClick={() => setAiAttachment(null)} className="p-1 hover:bg-blue-100 rounded text-blue-400 hover:text-blue-700 transition"><window.Icon name="x" size={14} /></button>
                            </div>
                        )}
                        <div 
                            className="p-4 border-t border-gray-100 flex gap-2 relative"
                            onDragOver={(e) => { e.preventDefault(); setIsAiDragging(true); }}
                            onDragLeave={() => setIsAiDragging(false)}
                            onDrop={async (e) => {
                                e.preventDefault();
                                setIsAiDragging(false);
                                const file = e.dataTransfer.files[0];
                                if (file) handleAiFileUpload(file);
                            }}
                        >
                            {isAiDragging && (
                                <div className="absolute inset-0 z-50 bg-white/90 border-2 border-dashed border-blue-400 rounded-b-2xl flex items-center justify-center pointer-events-none">
                                    <p className="text-blue-500 font-black text-xs uppercase tracking-widest flex items-center gap-2"><window.Icon name="upload-cloud" size={16} /> Drop file to analyze context</p>
                                </div>
                            )}
                            <button onClick={() => aiFileInputRef.current && aiFileInputRef.current.click()} className="p-3 bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700 rounded-xl transition" title="Upload PRD or Meeting Minutes (TXT/MD/JSON)"><window.Icon name="paperclip" size={18}/></button>
                            <input type="file" ref={aiFileInputRef} className="hidden" accept=".txt,.md,.json,.csv" onChange={(e) => { if(e.target.files[0]) handleAiFileUpload(e.target.files[0]); }} />
                            <input className="flex-1 p-3 bg-gray-50 rounded-xl text-xs outline-none focus:ring-1 focus:ring-black" placeholder={t('labels.search_placeholder')} value={aiInput} onChange={e => setAiInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAISend()} />
                            <button onClick={handleAISend} className="p-3 bg-black text-white rounded-xl active:scale-95 transition"><window.Icon name="send" size={18}/></button>
                        </div>
                    </>
                ) : (
                    <button onClick={() => setIsAIChatOpen(true)} className="w-full h-full flex items-center justify-center text-white hover:scale-110 transition p-0 m-0"><window.Icon name="message-square" size={24} /></button>
                )}
            </div>

            <window.GlobalModal isOpen={isAISettingsOpen} onClose={() => setIsAISettingsOpen(false)} title={t('labels.ai_configuration')} footer={<button onClick={() => setIsAISettingsOpen(false)} className="bg-black text-white px-8 py-3 rounded-full text-[9px] font-black uppercase tracking-widest shadow-xl">{t('actions.close')}</button>}>
                <div className="space-y-4">
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{t('alerts.ai_defaults_msg')}</p>
                    <div>
                        <label className="block text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2">{t('labels.base_url')}</label>
                        <input className="w-full p-4 bg-gray-50 rounded-xl border border-gray-100 outline-none text-xs font-bold" value={aiConfig.baseUrl} readOnly placeholder="https://api.openai.com/v1" />
                    </div>
                    <div>
                        <label className="block text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2">{t('labels.api_key')}</label>
                        <input className="w-full p-4 bg-gray-50 rounded-xl border border-gray-100 outline-none text-xs font-bold" type="password" value={aiConfig.apiKey} readOnly placeholder="sk-..." />
                    </div>
                    <div>
                        <label className="block text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2">{t('labels.model_id')}</label>
                        <input className="w-full p-4 bg-gray-50 rounded-xl border border-gray-100 outline-none text-xs font-bold" value={aiConfig.model} readOnly placeholder="gpt-4o" />
                    </div>
                </div>
            </window.GlobalModal>

            <window.GlobalModal isOpen={!!viewArchivedCol} onClose={() => setViewArchivedCol(null)} title={t('labels.archived_cards')} footer={<button onClick={() => setViewArchivedCol(null)} className="bg-black text-white px-8 py-3 rounded-full text-[9px] font-black uppercase tracking-widest shadow-xl text-white">{t('actions.close')}</button>}>
                <div className="space-y-4 max-h-96 overflow-y-auto no-scrollbar">
                    {cards.filter(c => c && c.columnId === viewArchivedCol && c.archived).length === 0 ? <p className="text-gray-400 text-xs text-center py-4">{t('alerts.no_archived_cards')}</p> : 
                    cards.filter(c => c && c.columnId === viewArchivedCol && c.archived).map(c => (
                        <div key={c.id} className="flex justify-between items-center p-4 border border-gray-100 rounded-xl">
                            <div><p className="font-black text-sm">{c.title}</p></div>
                            <button onClick={async () => { await fetch(`/api/tasks/${c.id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ archived: false, auditEvent: { user: user?.email || 'System', action: 'Restored card' } }) }); setCards(prev => prev.map(card => card.id === c.id ? { ...card, archived: false } : card)); }} className="text-blue-500 hover:text-blue-600 bg-blue-50 p-2 rounded-lg flex gap-2 items-center text-xs font-bold"><window.Icon name="upload-cloud" size={14}/> {t('actions.restore')}</button>
                        </div>
                    ))}
                </div>
            </window.GlobalModal>

            {showUserManagement && <window.UserManagement user={user} adminEmail={window.NT_ADMIN_EMAIL} onClose={() => setShowUserManagement(false)} />}
        </div>
    );
};
