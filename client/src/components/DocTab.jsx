const React = window.React;

window.ModernDocEditor = ({ initialContent, editable, onChange }) => {
    const editorRef = React.useRef(null);
    const quillRef = React.useRef(null);
    const onChangeRef = React.useRef(onChange);

    React.useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

    React.useEffect(() => {
        if (!editorRef.current) return;
        if (!window.Quill) {
            console.error("window.Quill not found!");
            return;
        }
        if (!quillRef.current) {
            quillRef.current = new window.Quill(editorRef.current, {
                theme: 'snow',
                placeholder: 'Start writing your document...',
                readOnly: !editable,
                modules: { 
                    toolbar: [
                        [{ 'header': [1, 2, 3, false] }],
                        ['bold', 'italic', 'underline', 'strike'],
                        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                        ['code-block', 'link', 'blockquote'],
                        [{ 'color': [] }, { 'background': [] }],
                        ['clean']
                    ]
                }
            });
            
            if (initialContent) {
                if (initialContent.startsWith('[')) {
                    quillRef.current.root.innerHTML = '';
                } else {
                    quillRef.current.clipboard.dangerouslyPasteHTML(initialContent);
                }
            }

            quillRef.current.on('text-change', () => {
                const html = quillRef.current.root.innerHTML;
                if (onChangeRef.current) onChangeRef.current(html);
            });
        }
    }, []);

    React.useEffect(() => {
        if (quillRef.current) {
            quillRef.current.enable(editable);
            const container = editorRef.current.parentNode;
            if (container) {
                const toolbar = container.querySelector('.ql-toolbar');
                if (toolbar) {
                    toolbar.style.display = editable ? 'block' : 'none';
                }
            }
        }
    }, [editable]);

    return (
        <div className="w-full bg-white border border-gray-100 rounded-[2rem] overflow-hidden shadow-sm flex flex-col">
            <div ref={editorRef} className="flex-1 w-full" style={{ minHeight: '500px', padding: '20px' }}></div>
        </div>
    );
};

window.DocTab = ({ workspaceId, user }) => {
    const [apiTab, setApiTab] = React.useState('Body');
    const [apiResponse, setApiResponse] = React.useState(null);
    const [isApiLoading, setIsApiLoading] = React.useState(false);

    const handleSendRequest = async (doc) => {
        setIsApiLoading(true);
        setApiResponse(null);
        try {
            const start = Date.now();
            let url = doc.apiSpec?.url || '';
            
            const fetchHeaders = { 'Content-Type': 'application/json' };
            if (doc.apiSpec?.headers && Array.isArray(doc.apiSpec.headers)) {
                doc.apiSpec.headers.forEach(h => {
                    if (h.key && h.value) fetchHeaders[h.key] = h.value;
                });
            }

            const options = {
                method: doc.apiSpec?.method || 'GET',
                headers: fetchHeaders
            };

            if (options.method !== 'GET' && options.method !== 'HEAD' && doc.apiSpec?.body) {
                options.body = doc.apiSpec.body; 
            }

            const res = await fetch(url, options);
            const time = Date.now() - start;
            
            let data;
            const contentType = res.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                data = await res.json();
            } else {
                data = await res.text();
            }

            setApiResponse({
                status: res.status,
                statusText: res.statusText,
                time: time,
                data: data
            });

        } catch (e) {
            setApiResponse({
                status: 'Error',
                statusText: e.message,
                time: 0,
                data: null
            });
        }
        setIsApiLoading(false);
    };

    const { showConfirm, showPrompt } = window.useModals();
    const { showToast } = window.useToasts();
    const [docs, setDocs] = React.useState([]);
    const [folders, setFolders] = React.useState([]);
    const [selectedDocId, setSelectedDocId] = React.useState(null);
    const [expandedFolders, setExpandedFolders] = React.useState({});
    const [loading, setLoading] = React.useState(true);
    const [isDocEditing, setIsDocEditing] = React.useState(false);

    React.useEffect(() => {
        setLoading(true);
        fetch(`/api/workspaces/${workspaceId}/docs`)
            .then(r => {
                if (!r.ok) throw new Error("Backend retrieval failed");
                return r.json();
            })
            .then(d => { 
                setDocs(Array.isArray(d) ? d : []); 
            })
            .catch(err => {
                console.error("Docs load error:", err);
                setDocs([]);
            });
            
        fetch(`/api/workspaces/${workspaceId}/folders`)
            .then(r => r.json())
            .then(f => setFolders(Array.isArray(f) ? f : []))
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [workspaceId]);

    
    const addFolder = () => {
        showPrompt('New Folder', 'Enter folder name:', async (name) => {
            if (!name) return;
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const res = await fetch(`/api/workspaces/${workspaceId}/folders`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name, slug }) });
            const saved = await res.json();
            setFolders(prev => [...prev, { ...saved, id: saved._id || saved.id }]);
            setExpandedFolders(prev => ({ ...prev, [saved._id || saved.id]: true }));
            showToast("Folder created.");
        });
    };

    const deleteFolder = async (id) => {
        showConfirm("Destroy Folder", "PERMANENTLY erase this folder? Documents inside will be moved to root.", async () => {
            await fetch(`/api/folders/${id}`, { method: 'DELETE' });
            setFolders(prev => prev.filter(f => (f.id !== id && f._id !== id)));
            setDocs(prev => prev.map(d => d.folderId === id ? { ...d, folderId: null } : d));
            showToast("Folder destroyed.");
        });
    };

    const moveToFolder = async (docId, folderId) => {
        setDocs(prev => prev.map(d => (d.id === docId || d._id === docId) ? { ...d, folderId } : d));
        await fetch(`/api/docs/${docId}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ folderId }) });
        showToast("Document moved.");
    };

    const toggleFolder = (id) => setExpandedFolders(prev => ({ ...prev, [id]: !prev[id] }));

    const addDoc = async (type) => {
        showPrompt(`New ${type === 'API' ? 'Endpoint' : 'Document'}`, 'Enter title:', async (title) => {
            if (!title) return;
            const newDoc = { title, type, content: '', apiSpec: { method: 'GET', url: '', headers: [], queryParams: [], body: '', examples: [] } };
            const res = await fetch(`/api/workspaces/${workspaceId}/docs`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(newDoc) });
            const saved = await res.json();
            const normalizedSaved = { ...saved, id: saved.id || saved._id };
            setDocs(prev => [...prev, normalizedSaved]);
            setSelectedDocId(normalizedSaved.id);
            showToast("Document initialized.");
        });
    };

    const updateDoc = async (id, upd) => {
        if (!id) return;
        setDocs(prev => prev.map(d => (d.id === id || d._id === id) ? { ...d, ...upd } : d));
        await fetch(`/api/docs/${id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(upd) });
    };

    const deleteDoc = async (id) => {
        if (!id) return;
        showConfirm("Destroy Document", "PERMANENTLY erase this document?", async () => {
            await fetch(`/api/docs/${id}`, { method: 'DELETE' });
            setDocs(prev => prev.filter(d => (d.id !== id && d._id !== id)));
            if (selectedDocId === id) setSelectedDocId(null);
            showToast("Document destroyed.");
        });
    };

    const activeDoc = docs.find(d => (d.id === selectedDocId || d._id === selectedDocId));

    if (loading) return <div className="p-10 text-center animate-pulse">Loading Document Nexus...</div>;

    return (
        <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-[#FAFAFA] animate-fade-in text-black">
            {/* Sidebar */}
            <div className="w-72 bg-white border-r border-gray-100 flex flex-col shadow-sm z-10">
                <div className="p-6 border-b border-gray-50 flex justify-between items-center">
                    <h2 className="text-xl font-black tracking-tight">Docs & API</h2>
                    <div className="flex gap-2">
                        <button onClick={addFolder} className="p-2 bg-gray-50 hover:bg-gray-100 rounded-lg transition text-purple-500" title="New Folder"><window.Icon name="folder-plus" size={16} /></button>
                        <button onClick={() => addDoc('TEXT')} className="p-2 bg-gray-50 hover:bg-gray-100 rounded-lg transition text-blue-500" title="New Document"><window.Icon name="file-text" size={16} /></button>
                        <button onClick={() => addDoc('API')} className="p-2 bg-gray-50 hover:bg-gray-100 rounded-lg transition text-emerald-500" title="New API Endpoint"><window.Icon name="zap" size={16} /></button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-1">
                    {folders.map(folder => {
                        const folderId = folder.id || folder._id;
                        const isExpanded = expandedFolders[folderId];
                        const folderDocs = docs.filter(d => d.folderId === folderId);
                        return (
                            <div key={folderId} className="mb-2">
                                <div className="flex items-center justify-between p-2 rounded-xl hover:bg-gray-50 cursor-pointer group" onClick={() => toggleFolder(folderId)}>
                                    <div className="flex items-center gap-2">
                                        <window.Icon name={isExpanded ? "folder-open" : "folder"} size={16} className="text-gray-400" />
                                        <span className="text-xs font-black text-gray-700">{folder.name}</span>
                                    </div>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                                        <button onClick={(e) => { e.stopPropagation(); window.open(`/docs/${workspaceId}/${folder.slug || folderId}`, '_blank'); }} className="p-1 text-gray-400 hover:text-blue-500" title="Open Dynamic Docs Page"><window.Icon name="external-link" size={12} /></button>
                                        <button onClick={(e) => { e.stopPropagation(); deleteFolder(folderId); }} className="p-1 text-gray-400 hover:text-red-500" title="Delete Folder"><window.Icon name="trash" size={12} /></button>
                                    </div>
                                </div>
                                {isExpanded && (
                                    <div className="pl-6 mt-1 space-y-1">
                                        {folderDocs.map(doc => {
                                            const docId = doc.id || doc._id;
                                                                                        return (
                                                <div key={docId} onClick={() => setSelectedDocId(docId)} className={`group flex items-center justify-between p-2 rounded-xl cursor-pointer transition ${selectedDocId === docId ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-50 text-gray-600'}`}>
                                                    <div className="flex items-center gap-2 truncate">
                                                        <window.Icon name={doc.type === 'API' ? "zap" : "file-text"} size={14} className={selectedDocId === docId ? 'text-blue-500' : 'text-gray-400'} />
                                                        <span className="text-xs font-bold truncate">{doc.title || 'Untitled'}</span>
                                                    </div>
                                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                                                        <button onClick={(e) => { e.stopPropagation(); moveToFolder(docId, null); }} className="p-1 text-gray-400 hover:text-gray-600" title="Move to Root"><window.Icon name="log-out" size={12} /></button>
                                                        <button onClick={(e) => { e.stopPropagation(); deleteDoc(docId); }} className="p-1 text-gray-400 hover:text-red-500" title="Delete Document"><window.Icon name="trash" size={12} /></button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {folderDocs.length === 0 && <div className="p-2 text-[10px] text-gray-400 italic">Empty</div>}
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    <div className="mt-4 pt-4 border-t border-gray-100">
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2 px-2">Root Documents</p>
                    {docs.filter(d => !d.folderId).map(doc => {
                        const docId = doc.id || doc._id;
                        return (
                        <div key={docId} onClick={() => setSelectedDocId(docId)} className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition ${selectedDocId === docId ? 'bg-blue-50 border border-blue-100 text-blue-600 shadow-sm' : 'hover:bg-gray-50 border border-transparent'}`}>
                            <div className="flex items-center gap-3">
                                {doc.type === 'API' ? (
                                    <span className={`text-[9px] font-black w-10 text-center rounded px-1 py-0.5 ${doc.apiSpec?.method === 'POST' ? 'bg-emerald-100 text-emerald-700' : doc.apiSpec?.method === 'GET' ? 'bg-blue-100 text-blue-700' : doc.apiSpec?.method === 'PUT' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{doc.apiSpec?.method}</span>
                                ) : (
                                    <window.Icon name="file-text" size={16} className={selectedDocId === docId ? 'text-blue-500' : 'text-gray-400'} />
                                )}
                                <span className={`text-xs font-bold truncate max-w-[140px] ${selectedDocId === docId ? 'text-blue-700' : 'text-gray-700'}`}>{doc.title}</span>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); deleteDoc(docId); }} className="text-gray-300 hover:text-red-500 transition"><window.Icon name="trash-2" size={14}/></button>
                        </div>
                        );
                    })}
                    {docs.length === 0 && <p className="text-xs text-gray-400 text-center mt-10 font-medium italic">No documentation found. Create one to begin.</p>}
                </div>
            </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 flex flex-col bg-white">
                {activeDoc ? (
                    <div className="flex-1 flex flex-col h-full">
                        {/* Editor Header */}
                        <div className="px-10 py-6 border-b border-gray-50 flex items-center justify-between bg-white z-10 shadow-sm">
                            <input 
                                className="text-3xl font-black bg-transparent outline-none w-2/3 tracking-tighter"
                                value={activeDoc.title}
                                onChange={e => updateDoc(activeDoc.id || activeDoc._id, { title: e.target.value })}
                            />
                            
                            <div className="flex items-center gap-4">
                                <select 
                                    className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-1 font-bold text-gray-600 outline-none"
                                    value={activeDoc.folderId || ''}
                                    onChange={e => moveToFolder(activeDoc.id || activeDoc._id, e.target.value || null)}
                                >
                                    <option value="">No Folder (Root)</option>
                                    {folders.map(f => <option key={f.id || f._id} value={f.id || f._id}>{f.name}</option>)}
                                </select>
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{activeDoc.type} Spec</span>
                            </div>

                        </div>
                        
                        {/* Document Types */}
                        <div className="flex-1 overflow-y-auto p-10 bg-[#FAFAFA]">
                            {activeDoc.type === 'TEXT' ? (
                                <div className="max-w-4xl mx-auto flex flex-col h-full">
                                    <div className="flex justify-end mb-4">
                                        <button onClick={() => setIsDocEditing(!isDocEditing)} className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition ${isDocEditing ? 'bg-red-50 text-red-500 border border-red-100 hover:bg-red-100' : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'}`}>
                                            {isDocEditing ? "Done Editing" : "Edit Document"}
                                        </button>
                                    </div>
                                    <window.ModernDocEditor key={activeDoc.id || activeDoc._id} initialContent={activeDoc.content} editable={isDocEditing} onChange={(jsonStr) => updateDoc(activeDoc.id || activeDoc._id, { content: jsonStr })} />
                                </div>
                            ) : (
                                <div className="max-w-6xl mx-auto flex flex-col gap-6">
                                    {/* API Endpoint Config */}
                                    <div className="bg-white p-6 rounded-[2rem] shadow-lg border border-gray-100 flex items-center gap-4">
                                        <select 
                                            className="bg-gray-50 text-black font-black text-xs px-4 py-3 rounded-xl border border-gray-100 outline-none uppercase tracking-widest cursor-pointer"
                                            value={activeDoc.apiSpec?.method}
                                            onChange={e => updateDoc(activeDoc.id || activeDoc._id, { apiSpec: { ...activeDoc.apiSpec, method: e.target.value } })}
                                        >
                                            {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map(m => <option key={m} value={m}>{m}</option>)}
                                        </select>
                                        <input 
                                            className="flex-1 bg-gray-50 text-black font-mono text-sm px-6 py-3 rounded-xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition"
                                            placeholder="https://api.example.com/v1/endpoint"
                                            value={activeDoc.apiSpec?.url}
                                            onChange={e => updateDoc(activeDoc.id || activeDoc._id, { apiSpec: { ...activeDoc.apiSpec, url: e.target.value } })}
                                        />
                                        <button onClick={() => handleSendRequest(activeDoc)} className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition shadow-lg shadow-blue-200" disabled={isApiLoading}>{isApiLoading ? 'Sending...' : 'Send Request'}</button>
                                    </div>
                                    
                                    {/* Split Pane: Request & Response */}
                                    <div className="grid grid-cols-2 gap-8 h-[600px]">
                                        {/* Request Config */}
                                        <div className="bg-white rounded-[2rem] shadow-xl border border-gray-100 flex flex-col overflow-hidden">
                                            <div className="bg-gray-50 px-6 py-4 border-b border-gray-100 flex gap-6 text-[10px] font-black uppercase tracking-widest text-gray-500">
                                                {['Body', 'Headers', 'Params', 'Auth'].map(tab => (
                                                    <button key={tab} onClick={() => setApiTab(tab)} className={`transition pb-1 ${apiTab === tab ? 'text-blue-600 border-b-2 border-blue-600' : 'hover:text-black'}`}>{tab}</button>
                                                ))}
                                            </div>
                                            <div className="flex-1 p-6 overflow-auto">
                                                {apiTab === 'Body' && (
                                                    <textarea 
                                                        className="w-full h-full bg-gray-50 border border-gray-100 rounded-xl p-4 font-mono text-xs outline-none focus:ring-2 focus:ring-blue-500 resize-none text-black"
                                                        placeholder={`{\n  "key": "value"\n}`}
                                                        value={activeDoc.apiSpec?.body || ''}
                                                        onChange={e => updateDoc(activeDoc.id || activeDoc._id, { apiSpec: { ...activeDoc.apiSpec, body: e.target.value } })}
                                                    />
                                                )}
                                                {apiTab === 'Headers' && (
                                                    <div className="space-y-4">
                                                        {(activeDoc.apiSpec?.headers || []).map((h, i) => (
                                                            <div key={i} className="flex gap-4">
                                                                <input placeholder="Key" className="flex-1 bg-gray-50 p-3 rounded-xl border border-gray-100 text-xs font-mono" value={h.key || ''} onChange={e => { const nh = [...activeDoc.apiSpec.headers]; nh[i].key = e.target.value; updateDoc(activeDoc.id || activeDoc._id, { apiSpec: { ...activeDoc.apiSpec, headers: nh } }); }} />
                                                                <input placeholder="Value" className="flex-1 bg-gray-50 p-3 rounded-xl border border-gray-100 text-xs font-mono" value={h.value || ''} onChange={e => { const nh = [...activeDoc.apiSpec.headers]; nh[i].value = e.target.value; updateDoc(activeDoc.id || activeDoc._id, { apiSpec: { ...activeDoc.apiSpec, headers: nh } }); }} />
                                                                <button onClick={() => { const nh = activeDoc.apiSpec.headers.filter((_, idx) => idx !== i); updateDoc(activeDoc.id || activeDoc._id, { apiSpec: { ...activeDoc.apiSpec, headers: nh } }); }} className="p-3 text-red-500 hover:bg-red-50 rounded-xl"><window.Icon name="trash-2" size={16}/></button>
                                                            </div>
                                                        ))}
                                                        <button onClick={() => { const nh = [...(activeDoc.apiSpec?.headers || []), {key: '', value: ''}]; updateDoc(activeDoc.id || activeDoc._id, { apiSpec: { ...activeDoc.apiSpec, headers: nh } }); }} className="text-xs font-black text-blue-500 uppercase tracking-widest">+ Add Header</button>
                                                    </div>
                                                )}
                                                {apiTab === 'Params' && (
                                                    <div className="space-y-4">
                                                        {(activeDoc.apiSpec?.queryParams || []).map((p, i) => (
                                                            <div key={i} className="flex gap-4">
                                                                <input placeholder="Key" className="flex-1 bg-gray-50 p-3 rounded-xl border border-gray-100 text-xs font-mono" value={p.key || ''} onChange={e => { const np = [...activeDoc.apiSpec.queryParams]; np[i].key = e.target.value; updateDoc(activeDoc.id || activeDoc._id, { apiSpec: { ...activeDoc.apiSpec, queryParams: np } }); }} />
                                                                <input placeholder="Value" className="flex-1 bg-gray-50 p-3 rounded-xl border border-gray-100 text-xs font-mono" value={p.value || ''} onChange={e => { const np = [...activeDoc.apiSpec.queryParams]; np[i].value = e.target.value; updateDoc(activeDoc.id || activeDoc._id, { apiSpec: { ...activeDoc.apiSpec, queryParams: np } }); }} />
                                                                <button onClick={() => { const np = activeDoc.apiSpec.queryParams.filter((_, idx) => idx !== i); updateDoc(activeDoc.id || activeDoc._id, { apiSpec: { ...activeDoc.apiSpec, queryParams: np } }); }} className="p-3 text-red-500 hover:bg-red-50 rounded-xl"><window.Icon name="trash-2" size={16}/></button>
                                                            </div>
                                                        ))}
                                                        <button onClick={() => { const np = [...(activeDoc.apiSpec?.queryParams || []), {key: '', value: ''}]; updateDoc(activeDoc.id || activeDoc._id, { apiSpec: { ...activeDoc.apiSpec, queryParams: np } }); }} className="text-xs font-black text-blue-500 uppercase tracking-widest">+ Add Param</button>
                                                    </div>
                                                )}
                                                {apiTab === 'Auth' && (
                                                    <div className="p-4 text-xs font-mono text-gray-500 bg-yellow-50 rounded-xl border border-yellow-100">
                                                        Note: Inject Bearer tokens directly into the Headers tab for this version.
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        
                                        {/* Response Viewer */}
                                        <div className="bg-gray-900 rounded-[2rem] shadow-2xl border border-gray-800 flex flex-col overflow-hidden text-gray-300">
                                            <div className="bg-gray-800/50 px-6 py-4 border-b border-gray-800 flex justify-between items-center text-[10px] font-black uppercase tracking-widest">
                                                <span className="text-gray-400">Response</span>
                                                {apiResponse && (
                                                    <div className="flex gap-4">
                                                        <span className={apiResponse.status === 200 || apiResponse.status === 201 ? 'text-emerald-400' : 'text-red-400'}>Status: {apiResponse.status} {apiResponse.statusText}</span>
                                                        <span className="text-blue-400">Time: {apiResponse.time}ms</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1 p-6 overflow-auto font-mono text-xs leading-relaxed relative">
                                                {isApiLoading ? (
                                                    <div className="flex items-center justify-center h-full gap-4 text-blue-400 animate-pulse">
                                                        <window.Icon name="loader" size={24} className="animate-spin" />
                                                        <span>Sending Request...</span>
                                                    </div>
                                                ) : apiResponse ? (
                                                    <pre>{typeof apiResponse.data === 'object' ? JSON.stringify(apiResponse.data, null, 2) : apiResponse.data}</pre>
                                                ) : (
                                                    <div className="text-gray-600 flex items-center justify-center h-full">Hit Send Request to execute the API call.</div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-400 h-full bg-[#FAFAFA]">
                        <window.Icon name="book-open" size={64} className="mb-6 opacity-20" />
                        <h3 className="text-xl font-black tracking-tight text-gray-500">No Document Selected</h3>
                        <p className="text-sm font-medium mt-2">Select a document from the sidebar or create a new one.</p>
                    </div>
                )}
            </div>
        </div>
    );
};
