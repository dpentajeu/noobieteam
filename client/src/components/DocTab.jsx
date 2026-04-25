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
    const { t } = window.useTranslation();

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

    const { showConfirm, showPrompt, showAlert } = window.useModals();
    const { showToast } = window.useToasts();
    const [docs, setDocs] = React.useState([]);
    const [folders, setFolders] = React.useState([]);
    const [selectedDocId, setSelectedDocId] = React.useState(null);
    const [selectedFolderId, setSelectedFolderId] = React.useState(null);
    const [expandedFolders, setExpandedFolders] = React.useState({});
    const [loading, setLoading] = React.useState(true);
    const [isDocEditing, setIsDocEditing] = React.useState(false);
    const [showMobileSidebar, setShowMobileSidebar] = React.useState(false);

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
            if (!res.ok) throw new Error("Failed to create folder");
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

    const fileInputRef = React.useRef(null);
    
    const importPostmanCollection = async (file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const collection = JSON.parse(e.target.result);
                const name = collection.info?.name || 'Postman Import';
                
                // Create Folder
                const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                const description = collection.info?.description || '';
                const collectionDesc = typeof collection.info?.description === 'string' ? collection.info.description : (collection.info?.description?.content || '');
                const folderRes = await fetch(`/api/workspaces/${workspaceId}/folders`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name, slug, description: collectionDesc }) });
                if (!folderRes.ok) throw new Error("Failed to create folder");
                const folder = await folderRes.json();
                const folderId = folder._id || folder.id;
                
                setFolders(prev => [...prev, { ...folder, id: folderId }]);
                setExpandedFolders(prev => ({ ...prev, [folderId]: true }));
                
                const items = collection.item || [];
                const processItem = async (item, currentFolderId) => {
                    if (item.request) {
                        // Extract request
                        const req = item.request;
                        const method = req.method || 'GET';
                        const url = req.url?.raw || (typeof req.url === 'string' ? req.url : '');
                        const headers = (req.header || []).map(h => ({ key: h.key, value: h.value }));
                        const queryParams = (req.url?.query || []).map(q => ({ key: q.key, value: q.value }));
                        let body = '';
                        if (req.body?.mode === 'raw') {
                            if (typeof req.body.raw === 'string') {
                                body = req.body.raw;
                            } else {
                                body = JSON.stringify(req.body.raw, null, 2);
                            }
                        }
                        else if (req.body?.mode === 'formdata') {
                            const formDataArr = Array.isArray(req.body.formdata) ? req.body.formdata : [];
                            body = JSON.stringify(formDataArr.reduce((acc, curr) => { if(curr.key) acc[curr.key] = curr.value || ''; return acc; }, {}), null, 2);
                            headers.push({ key: 'Content-Type', value: 'multipart/form-data' });
                        }
                        else if (req.body?.mode === 'urlencoded') {
                            const urlEncodedArr = Array.isArray(req.body.urlencoded) ? req.body.urlencoded : [];
                            body = JSON.stringify(urlEncodedArr.reduce((acc, curr) => { if(curr.key) acc[curr.key] = curr.value || ''; return acc; }, {}), null, 2);
                            headers.push({ key: 'Content-Type', value: 'application/x-www-form-urlencoded' });
                        }
                        
                        const newDoc = { 
                            title: item.name || 'API Endpoint', 
                            type: 'API', 
                            content: typeof item.request.description === 'string' ? item.request.description : (item.request.description?.content || ''), 
                            folderId: currentFolderId,
                            apiSpec: { method, url, headers, queryParams, body, examples: [] } 
                        };
                        
                        const docRes = await fetch(`/api/workspaces/${workspaceId}/docs`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(newDoc) });
                        const savedDoc = await docRes.json();
                        return { ...savedDoc, id: savedDoc.id || savedDoc._id };
                    } else if (item.item) {
                        // Sub-folder handling could go here, but for now we flat map to the single folder
                        // Create subfolder
                        const subName = item.name || 'Subfolder';
                        const subSlug = subName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                        const subDesc = typeof item.description === 'string' ? item.description : (item.description?.content || '');
                        
                        const subFolderRes = await fetch(`/api/workspaces/${workspaceId}/folders`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name: subName, slug: subSlug, description: subDesc, parentId: currentFolderId }) });
                        if (!subFolderRes.ok) throw new Error("Failed to create subfolder");
                        const subFolder = await subFolderRes.json();
                        const subFolderId = subFolder._id || subFolder.id;
                        
                        setFolders(prev => [...prev, { ...subFolder, id: subFolderId }]);
                        setExpandedFolders(prev => ({ ...prev, [subFolderId]: true }));
                        
                        let importedDocs = [];
                        for (let subItem of item.item) {
                            const subDocs = await processItem(subItem, subFolderId);
                            importedDocs = importedDocs.concat(Array.isArray(subDocs) ? subDocs : [subDocs]);
                        }
                        return importedDocs;
                    }
                    return [];
                };
                
                let allImported = [];
                for (let item of items) {
                    const imported = await processItem(item, folderId);
                    allImported = allImported.concat(Array.isArray(imported) ? imported : [imported]);
                }
                
                setDocs(prev => [...prev, ...allImported]);
                showToast("Postman Collection imported successfully! 🚀");
            } catch (err) {
                console.error(err);
                showAlert("Failed to parse or import Postman Collection: " + err.message, "Import Error");
            }
            if (fileInputRef.current) fileInputRef.current.value = '';
        };
        reader.readAsText(file);
    };

    const addDoc = async (type) => {
        showPrompt(
            `New ${type === 'API' ? 'Endpoint' : 'Document'}`, 
            type === 'API' ? 'Enter title (Or click Import Postman Collection below):' : 'Enter title:', 
            async (title) => {
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

    const activeDoc = selectedDocId ? docs.find(d => (d.id === selectedDocId || d._id === selectedDocId)) : null;
    const activeFolder = selectedFolderId && !selectedDocId ? folders.find(f => (f.id === selectedFolderId || f._id === selectedFolderId)) : null;

    if (loading) return <div className="p-10 text-center animate-pulse">Loading Document Nexus...</div>;

    return (
        <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-[#FAFAFA] animate-fade-in text-black">
            {/* Sidebar */}
            <div className={`${showMobileSidebar ? 'fixed inset-0 z-50 flex w-full' : 'hidden'} md:flex md:w-72 bg-white border-r border-gray-100 flex-col shadow-sm z-10 md:relative`}>
                <div className="p-6 border-b border-gray-50 flex justify-between items-center">
                    <h2 className="text-xl font-black tracking-tight">Docs & API</h2>
                    {showMobileSidebar && (
                        <button onClick={() => setShowMobileSidebar(false)} className="md:hidden p-2 text-gray-500 hover:bg-gray-100 rounded-lg absolute top-4 right-4 z-50">
                            <window.Icon name="x" size={20} />
                        </button>
                    )}
                    <div className="flex gap-2">
                        <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={(e) => importPostmanCollection(e.target.files[0])} />
                        <button onClick={() => fileInputRef.current && fileInputRef.current.click()} className="p-2 bg-orange-50 hover:bg-orange-100 rounded-lg transition text-orange-500 cursor-pointer" title="Import Postman Collection"><window.Icon name="upload-cloud" size={16} /></button>
                        <button onClick={addFolder} className="p-2 bg-gray-50 hover:bg-gray-100 rounded-lg transition text-purple-500 cursor-pointer" title="New Folder"><window.Icon name="folder-plus" size={16} /></button>
                        <button onClick={() => addDoc('TEXT')} className="p-2 bg-gray-50 hover:bg-gray-100 rounded-lg transition text-blue-500 cursor-pointer" title="New Document"><window.Icon name="file-text" size={16} /></button>
                        <button onClick={() => addDoc('API')} className="p-2 bg-gray-50 hover:bg-gray-100 rounded-lg transition text-emerald-500 cursor-pointer" title="New API Endpoint"><window.Icon name="zap" size={16} /></button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-1">
                    {folders.filter(f => !f.parentId).map(folder => {
                        const folderId = folder.id || folder._id;
                        const isExpanded = expandedFolders[folderId];
                        const folderDocs = docs.filter(d => d.folderId === folderId);
                        return (
                            <div key={folderId} className="mb-2">
                                <div className={`flex items-center justify-between p-2 rounded-xl cursor-pointer group transition ${selectedFolderId === folderId && !selectedDocId ? 'bg-blue-50' : 'hover:bg-gray-50'}`} onClick={() => { toggleFolder(folderId); setSelectedFolderId(folderId); setSelectedDocId(null); setShowMobileSidebar(false); }}>
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
                                        {folders.filter(sub => sub.parentId === folderId).map(sub => (
                                            <div key={sub.id || sub._id} className="mb-1">
                                                <div className={`flex items-center justify-between p-2 rounded-xl cursor-pointer group transition ${selectedFolderId === (sub.id || sub._id) && !selectedDocId ? 'bg-blue-50' : 'hover:bg-gray-50'}`} onClick={() => { toggleFolder(sub.id || sub._id); setSelectedFolderId(sub.id || sub._id); setSelectedDocId(null); setShowMobileSidebar(false); }}>
                                                    <div className="flex items-center gap-2">
                                                        <window.Icon name={expandedFolders[sub.id || sub._id] ? "folder-open" : "folder"} size={14} className="text-gray-300" />
                                                        <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{sub.name}</span>
                                                    </div>
                                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                                                        <button onClick={(e) => { e.stopPropagation(); deleteFolder(sub.id || sub._id); }} className="p-1 text-gray-400 hover:text-red-500" title="Delete Folder"><window.Icon name="trash" size={12} /></button>
                                                    </div>
                                                </div>
                                                {expandedFolders[sub.id || sub._id] && (
                                                    <div className="pl-4 mt-1 space-y-1 border-l border-gray-100 ml-2">
                                                        {docs.filter(d => d.folderId === (sub.id || sub._id)).map(doc => {
                                                            const docId = doc.id || doc._id;
                                                            return (
                                                                <div key={docId} onClick={() => { setSelectedDocId(docId); setShowMobileSidebar(false); }} className={`group flex items-center justify-between p-2 rounded-xl cursor-pointer transition ${selectedDocId === docId ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-50 text-gray-600'}`}>
                                                                    <div className="flex items-center gap-2 truncate">
                                                                        <window.Icon name={doc.type === 'API' ? "zap" : "file-text"} size={14} className={selectedDocId === docId ? 'text-blue-500' : 'text-gray-400'} />
                                                                        <span className="text-[11px] font-bold truncate">{doc.title || t('labels.untitled')}</span>
                                                                    </div>
                                                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                                                                        <button onClick={(e) => { e.stopPropagation(); moveToFolder(docId, null); }} className="p-1 text-gray-400 hover:text-gray-600" title="Move to Root"><window.Icon name="log-out" size={12} /></button>
                                                                        <button onClick={(e) => { e.stopPropagation(); deleteDoc(docId); }} className="p-1 text-gray-400 hover:text-red-500" title="Delete Document"><window.Icon name="trash" size={12} /></button>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                        {folderDocs.map(doc => {
                                            const docId = doc.id || doc._id;
                                                                                        return (
                                                <div key={docId} onClick={() => { setSelectedDocId(docId); setShowMobileSidebar(false); }} className={`group flex items-center justify-between p-2 rounded-xl cursor-pointer transition ${selectedDocId === docId ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-50 text-gray-600'}`}>
                                                    <div className="flex items-center gap-2 truncate">
                                                        <window.Icon name={doc.type === 'API' ? "zap" : "file-text"} size={14} className={selectedDocId === docId ? 'text-blue-500' : 'text-gray-400'} />
                                                        <span className="text-xs font-bold truncate">{doc.title || t('labels.untitled')}</span>
                                                    </div>
                                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                                                        <button onClick={(e) => { e.stopPropagation(); moveToFolder(docId, null); }} className="p-1 text-gray-400 hover:text-gray-600" title="Move to Root"><window.Icon name="log-out" size={12} /></button>
                                                        <button onClick={(e) => { e.stopPropagation(); deleteDoc(docId); }} className="p-1 text-gray-400 hover:text-red-500" title="Delete Document"><window.Icon name="trash" size={12} /></button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {folderDocs.length === 0 && <div className="p-2 text-[10px] text-gray-400 italic">{t('labels.empty')}</div>}
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    <div className="mt-4 pt-4 border-t border-gray-100">
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2 px-2">{t('labels.root_documents')}</p>
                    {docs.filter(d => !d.folderId).map(doc => {
                        const docId = doc.id || doc._id;
                        return (
                        <div key={docId} onClick={() => { setSelectedDocId(docId); setShowMobileSidebar(false); }} className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition ${selectedDocId === docId ? 'bg-blue-50 border border-blue-100 text-blue-600 shadow-sm' : 'hover:bg-gray-50 border border-transparent'}`}>
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
            <div className="flex-1 flex flex-col bg-white relative z-0">
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
                                    <option value="">{t('labels.no_folder_root')}</option>
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
                                            {isDocEditing ? t('actions.done_editing') : t('actions.edit_document')}
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
                                        <button onClick={() => handleSendRequest(activeDoc)} className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition shadow-lg shadow-blue-200" disabled={isApiLoading}>{isApiLoading ? t('actions.sending') : t('actions.send_request')}</button>
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
                                                        <span className={apiResponse.status === 200 || apiResponse.status === 201 ? 'text-emerald-400' : 'text-red-400'}>{t('labels.status')}: {apiResponse.status} {apiResponse.statusText}</span>
                                                        <span className="text-blue-400">{t('labels.time')}: {apiResponse.time}ms</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1 p-6 overflow-auto font-mono text-xs leading-relaxed relative">
                                                {isApiLoading ? (
                                                    <div className="flex items-center justify-center h-full gap-4 text-blue-400 animate-pulse">
                                                        <window.Icon name="loader" size={24} className="animate-spin" />
                                                        <span>{t('actions.sending')}</span>
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
                ) : activeFolder ? (
                    <div className="flex-1 flex flex-col h-full">
                        <div className="px-10 py-6 border-b border-gray-50 flex items-center justify-between bg-white z-10 shadow-sm">
                            <input 
                                className="text-3xl font-black bg-transparent outline-none w-2/3 tracking-tighter"
                                value={activeFolder.name}
                                onChange={e => {
                                    const val = e.target.value;
                                    setFolders(prev => prev.map(f => (f.id === activeFolder.id || f._id === activeFolder._id) ? { ...f, name: val } : f));
                                    fetch(`/api/folders/${activeFolder.id || activeFolder._id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name: val }) });
                                }}
                            />
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Folder Overview</span>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 md:p-10 bg-[#FAFAFA]">
                            <div className="max-w-4xl mx-auto flex flex-col h-full">
                                <div className="flex justify-end mb-4">
                                    <button onClick={() => setIsDocEditing(!isDocEditing)} className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition ${isDocEditing ? 'bg-red-50 text-red-500 border border-red-100 hover:bg-red-100' : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'}`}>
                                        {isDocEditing ? t('actions.done_editing') || 'Done Editing' : t('actions.edit_document') || 'Edit Readme'}
                                    </button>
                                </div>
                                <window.ModernDocEditor key={activeFolder.id || activeFolder._id} initialContent={activeFolder.description || ''} editable={isDocEditing} onChange={(jsonStr) => {
                                    setFolders(prev => prev.map(f => (f.id === activeFolder.id || f._id === activeFolder._id) ? { ...f, description: jsonStr } : f));
                                    fetch(`/api/folders/${activeFolder.id || activeFolder._id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ description: jsonStr }) });
                                }} />
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-400 h-full bg-[#FAFAFA]">
                        <window.Icon name="book-open" size={64} className="mb-6 opacity-20" />
                        <h3 className="text-xl font-black tracking-tight text-gray-500">{t('labels.no_document_selected')}</h3>
                        <p className="text-sm font-medium mt-2">Select a document from the sidebar or create a new one.</p>
                    </div>
                )}
            </div>
        </div>
    );
};
