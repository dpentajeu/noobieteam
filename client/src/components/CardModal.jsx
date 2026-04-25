window.CardModal = ({ card, user, members, allUsers, onClose, onSave, onDelete, socket, workspaceId }) => {
    
    React.useEffect(() => {
        if (socket && card && (card.id || card._id)) {
            socket.emit('card:lock', { cardId: card.id || card._id, userEmail: user?.email, workspaceId });
        }
        return () => {
            if (socket && card && (card.id || card._id)) {
                socket.emit('card:unlock', { cardId: card.id || card._id, workspaceId });
            }
        };
    }, [socket, card.id, card._id, user?.email, workspaceId]);

    const { showConfirm } = window.useModals();
    const { showToast } = window.useToasts();
    const { t } = window.useTranslation ? window.useTranslation() : { t: k => k };
    const [title, setTitle] = React.useState(card.title);
    const [content, setContent] = React.useState(card.content);
    const [isEditingContent, setIsEditingContent] = React.useState(false);
    const [dueDate, setDueDate] = React.useState(() => {
        if (!card.dueDate) return '';
        const dStr = String(card.dueDate);
        return dStr.includes('T') ? dStr.split('T')[0] : dStr;
    });
    const [urgency, setUrgency] = React.useState(card.urgency || 'LOW');
    const [epic, setEpic] = React.useState(card.epic || '');
    const [checklist, setChecklist] = React.useState(card.checklist || []);
    const [assignees, setAssignees] = React.useState(card.assignees || []);
    const [newCheckItem, setNewCheckItem] = React.useState('');
    const [editingCheckId, setEditingCheckId] = React.useState(null);
    const [editingCheckText, setEditingCheckText] = React.useState('');
    const [attachments, setAttachments] = React.useState(card.attachments || []);
    const [showAssignDropdown, setShowAssignDropdown] = React.useState(false);
    const fileInputRef = React.useRef(null);
    const [showAudit, setShowAudit] = React.useState(false);
    const [previewImage, setPreviewImage] = React.useState(null);

    const [comments, setComments] = React.useState(card.comments || []);
    const [newComment, setNewComment] = React.useState('');
    const [showCommentTagDropdown, setShowCommentTagDropdown] = React.useState(false);
    const [commentTaggedUsers, setCommentTaggedUsers] = React.useState([]);

    const submitComment = async () => {
        if (!newComment.trim()) return;
        const payload = {
            authorEmail: user?.email || 'Unknown',
            text: newComment,
            taggedUsers: commentTaggedUsers
        };
        try {
            const taskId = card.id || card._id;
            const res = await fetch(`/api/tasks/${taskId}/comments`, { 
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify(payload) 
            });
            if (res.ok) {
                const updatedTask = await res.json();
                setComments(updatedTask.comments || [...comments, { ...payload, _id: window.generateId('cmt'), timestamp: new Date() }]);
                setNewComment('');
                setCommentTaggedUsers([]);
            }
        } catch(e) { console.error(e); }
    };

    const handleCommentChange = (e) => {
        const val = e.target.value;
        setNewComment(val);
        if (val.endsWith('@')) {
            setShowCommentTagDropdown(true);
        } else if (!val.includes('@')) {
            setShowCommentTagDropdown(false);
        }
    };

    const addCommentTag = (email) => {
        if (!commentTaggedUsers.includes(email)) {
            setCommentTaggedUsers([...commentTaggedUsers, email]);
        }
        setNewComment(newComment.replace(/@$/, `@${email} `));
        setShowCommentTagDropdown(false);
    };

    const deleteComment = async (commentId) => {
        const taskId = card.id || card._id;
        try {
            const res = await fetch(`/api/tasks/${taskId}/comments/${commentId}`, { method: 'DELETE' });
            if (res.ok) {
                setComments(prev => prev.filter(c => c._id !== commentId));
            }
        } catch(e) { console.error(e); }
    };

    const parseContent = (html) => {
        if (!html) return `<p class="italic text-gray-400">${t('alerts.no_objective') || 'No objective defined...'}</p>`;
        const temp = document.createElement('div');
        temp.innerHTML = html;
        const walk = document.createTreeWalker(temp, NodeFilter.SHOW_TEXT, null, false);
        let node;
        const nodesToReplace = [];
        while (node = walk.nextNode()) {
            if (node.parentNode && node.parentNode.tagName === 'A') continue;
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            if (urlRegex.test(node.nodeValue)) {
                nodesToReplace.push(node);
            }
        }
        nodesToReplace.forEach(n => {
            const span = document.createElement('span');
            span.innerHTML = n.nodeValue.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" class="text-blue-500 underline">$1</a>');
            n.parentNode.replaceChild(span, n);
        });
        return temp.innerHTML;
    };

    const colors = { LOW: 'bg-blue-400', MED: 'bg-yellow-400', HIGH: 'bg-red-500' };

    const handleToggleCheck = React.useCallback((id) => {
        setChecklist(prev => {
            const arr = [...prev];
            return arr.map(item => {
                if (!item) return item;
                if (item.id === id) {
                    return { ...item, done: !item.done };
                }
                return item;
            });
        });
    }, []);

    const handleDeleteCheck = React.useCallback((id) => {
        setChecklist(prev => prev.filter(item => item && item.id !== id));
    }, []);

    const handleStartEditCheck = (item) => {
        setEditingCheckId(item.id);
        setEditingCheckText(item.text);
    };

    const handleSaveCheckEdit = (id) => {
        if (!editingCheckText.trim()) { setEditingCheckId(null); return; }
        setChecklist(prev => prev.map(item => item && item.id === id ? { ...item, text: editingCheckText.trim() } : item));
        setEditingCheckId(null);
        setEditingCheckText('');
    };

    const toggleAssignee = (email) => {
        if (!email) return;
        if (assignees.includes(email)) setAssignees(assignees.filter(e => e !== email));
        else setAssignees([...assignees, email]);
    };

    const handleUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (re) => {
                setAttachments([...attachments, { id: window.generateId('att'), name: file.name, dataUrl: re.target.result, size: (file.size / 1024).toFixed(1) + ' KB' }]);
                showToast(t('alerts.file_attached') || "File attachment synchronized. 📎");
            };
            reader.readAsDataURL(file);
        }
    };

    const getMemberData = (email) => {
        return (Array.isArray(allUsers) ? allUsers : []).find(u => u.email === email) || { email, avatar: null };
    };

    return (
        <div className="fixed inset-0 z-[1600] flex items-center justify-center p-4 glass-blur animate-fade-in text-black">
            <div className="bg-white w-[95%] md:w-full max-w-3xl rounded-3xl md:rounded-[2.5rem] shadow-2xl border border-gray-100 overflow-hidden animate-pop flex flex-col max-h-[90vh] md:max-h-[85vh]">
                <div className="p-6 border-b border-gray-50 flex justify-between items-center bg-gray-50/50">
                    <input className="text-2xl font-black focus:outline-none w-full bg-transparent tracking-tighter" value={title} onChange={e => setTitle(e.target.value)} />
                    <div className="flex gap-2">
                        <button onClick={() => showConfirm(t('actions.delete_mission'), t('actions.erase_completely'), () => onDelete(card.id))} className="p-3 text-red-400 hover:bg-red-50 rounded-full transition"><window.Icon name="trash-2" size={20} /></button>
                        <button onClick={onClose} className="p-3 hover:bg-gray-100 rounded-full transition"><window.Icon name="x" size={20} /></button>
                    </div>
                </div>
                <div className="p-4 md:p-8 space-y-6 md:space-y-8 overflow-y-auto no-scrollbar flex-1">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
                        <div><label className="block text-sm font-black text-black uppercase tracking-widest mb-3">{t('labels.deadline')}</label><input type="date" className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 text-[11px] font-black" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
                        <div><label className="block text-sm font-black text-black uppercase tracking-widest mb-3">{t('labels.epic_tag') || 'Epic Tag'}</label><input className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none text-[11px] font-black" placeholder="e.g. Q4 Release" value={epic} onChange={e => setEpic(e.target.value)} /></div>
                        <div><label className="block text-sm font-black text-black uppercase tracking-widest mb-3">{t('labels.priority')}</label>
                            <div className="flex gap-1.5 p-1 bg-gray-50 rounded-2xl border border-gray-100">
                                {['LOW', 'MED', 'HIGH'].map(lvl => (
                                    <button key={lvl} onClick={() => setUrgency(lvl)} className={`flex-1 py-2 rounded-xl text-[8px] font-black uppercase tracking-widest transition ${urgency === lvl ? colors[lvl] + ' text-white shadow-md' : 'text-gray-400 hover:bg-white'}`}>{t(`labels.${lvl.toLowerCase()}`)}</button>
                                ))}
                            </div>
                        </div>
                    </div>
                    
                    <div>
                        <label className="block text-sm font-black text-black uppercase tracking-widest mb-3">{t('labels.assignees')}</label>
                        <div className="flex flex-wrap gap-2 items-center">
                            {assignees.map(email => {
                                if (!email) return null;
                                const m = getMemberData(email);
                                return (
                                    <div key={email} className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-100">
                                        <window.Avatar label={email.charAt(0).toUpperCase()} src={m.avatar} size="sm" />
                                        <span className="text-[10px] font-bold">{email.split('@')[0]}</span>
                                        <button onClick={() => toggleAssignee(email)} className="text-gray-400 hover:text-red-500"><window.Icon name="x" size={12} /></button>
                                    </div>
                                );
                            })}
                            <div className="relative">
                                <button onClick={() => setShowAssignDropdown(!showAssignDropdown)} className="w-8 h-8 rounded-full border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-400 transition"><window.Icon name="plus" size={14}/></button>
                                {showAssignDropdown && (
                                    <div className="absolute top-full left-0 mt-2 w-48 bg-white rounded-2xl shadow-2xl border border-gray-100 p-2 z-[2000] animate-pop text-black">
                                        {members.map(email => (
                                            <button key={email} onClick={() => { toggleAssignee(email); setShowAssignDropdown(false); }} className={`w-full text-left p-2 rounded-xl text-[10px] font-bold flex items-center gap-2 hover:bg-gray-50 ${assignees.includes(email) ? 'bg-blue-50 text-blue-600' : ''}`}>
                                                <window.Avatar label={email.charAt(0).toUpperCase()} src={getMemberData(email).avatar} size="sm" /> {email}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div>
                        <div className="flex justify-between items-center mb-3">
                            <label className="text-sm font-black text-black uppercase tracking-widest">{t('labels.mission_objective')}</label>
                            <button onClick={() => setIsEditingContent(!isEditingContent)} className={`p-2 rounded-lg transition ${isEditingContent ? 'bg-black text-white' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}><window.Icon name="edit-3" size={14} /></button>
                        </div>
                        {isEditingContent ? (
                            <window.WYSIWYG id={card.id || card._id} value={content} onChange={setContent} />
                        ) : (
                            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 text-xs min-h-[60px] ql-editor" dangerouslySetInnerHTML={{ __html: parseContent(content) }} />
                        )}
                    </div>
                    
                    <div>
                        <div className="text-sm font-black text-black uppercase tracking-widest mb-6 flex justify-between items-center">
            <div className="flex items-center gap-4">
                {t('labels.checklist_status')}
                <button onClick={() => setChecklist(prev => prev.map(item => ({ ...item, done: true })))} className="text-[9px] font-bold text-blue-500 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1 rounded transition">{t('actions.check_all') || 'Check All'}</button>
            </div>
            <span className="text-blue-500 lowercase tracking-tight">{checklist.filter(i => i && i.done).length}/{checklist.length} {t('labels.done')}</span>
        </div>
                        <div className="space-y-3 mb-6">
                            {checklist.map(item => {
                                if (!item) return null;
                                return (
                                    <div key={item.id} className="flex items-center gap-4 p-4 bg-gray-50 rounded-[1.5rem] group transition hover:bg-white border border-transparent hover:border-gray-100">
                                        <button onClick={() => handleToggleCheck(item.id)} className={`w-8 h-8 rounded-xl border flex items-center justify-center transition-all flex-shrink-0 ${item.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-200'}`}>{item.done && <window.Icon name="check" size={14} />}</button>
                                        {editingCheckId === item.id ? (
                                            <input
                                                autoFocus
                                                className="flex-1 text-[13px] font-bold bg-white border border-blue-300 rounded-xl px-3 py-1 outline-none focus:ring-2 focus:ring-blue-400"
                                                value={editingCheckText}
                                                onChange={e => setEditingCheckText(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') handleSaveCheckEdit(item.id); if (e.key === 'Escape') setEditingCheckId(null); }}
                                                onBlur={() => handleSaveCheckEdit(item.id)}
                                            />
                                        ) : (
                                            <span
                                                className={`flex-1 text-[13px] font-bold ${item.done ? 'line-through text-gray-300 cursor-default' : 'text-gray-800 cursor-pointer hover:text-blue-600'}`}
                                                onClick={() => !item.done && handleStartEditCheck(item)}
                                                title={!item.done ? 'Click to edit' : ''}
                                            >{item.text}</span>
                                        )}
                                        <button onClick={() => handleDeleteCheck(item.id)} className="opacity-0 group-hover:opacity-100 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-full transition flex-shrink-0"><window.Icon name="trash-2" size={14} /></button>
                                    </div>
                                );
                            })}
                        </div>
                        <input className="w-full p-4 bg-gray-50 rounded-[1.5rem] border border-gray-100 outline-none text-[11px] font-black" placeholder={t('labels.define_objective')} value={newCheckItem} onChange={e => setNewCheckItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && newCheckItem.trim() && (setChecklist(prev => [...prev, { id: window.generateId('chk'), text: newCheckItem.trim(), done: false }]), setNewCheckItem(''))} />
                    </div>

                    <div><label className="block text-sm font-black text-black uppercase tracking-widest mb-6">{t('labels.attachments')}</label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {attachments.map((a, i) => (
                                <div key={i} className="bg-gray-50 p-4 rounded-2xl border border-gray-100 flex items-center justify-between shadow-sm hover:shadow-md transition">
                                    <div className="flex items-center gap-3">
                                        {a.dataUrl?.startsWith('data:image/') || a.name.match(/\.(jpeg|jpg|gif|png|webp)$/i) ? (
                                            <div className="w-10 h-10 rounded-lg overflow-hidden cursor-pointer border border-gray-200" onClick={() => setPreviewImage(a.dataUrl)}>
                                                <img src={a.dataUrl} alt={a.name} className="w-full h-full object-cover" />
                                            </div>
                                        ) : (
                                            <window.Icon name="file-text" size={18} className="text-gray-400" />
                                        )}
                                        <div><p className="text-[10px] font-black line-clamp-1">{a.name}</p><p className="text-[8px] text-gray-400 uppercase font-black">{a.size}</p></div></div>
                                    <div className="flex gap-1"><button onClick={() => { const l = document.createElement('a'); l.href = a.dataUrl; l.download = a.name; l.click(); }} className="p-2 text-blue-500 hover:bg-blue-50 rounded-full transition" title={t('actions.download')}><window.Icon name="download" size={16} /></button><button onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))} className="p-2 text-red-500 hover:bg-red-50 rounded-full transition" title={t('actions.remove')}><window.Icon name="trash-2" size={16} /></button></div>
                                </div>
                            ))}
                            <div onClick={() => fileInputRef.current.click()} className="border-2 border-dashed border-gray-100 p-4 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 transition text-gray-300 gap-1.5"><window.Icon name="upload-cloud" size={24} /><span className="text-[9px] font-black uppercase tracking-widest">{t('actions.attach_intel')}</span><input type="file" ref={fileInputRef} className="hidden" onChange={handleUpload} /></div>
                        </div>
                    </div>

                    <div className="border-t border-gray-100 pt-8 mt-4">
                        <label className="block text-sm font-black text-black uppercase tracking-widest mb-6">{t('labels.mission_chatter_title')}</label>
                        <div className="space-y-4 mb-6">
                            {comments.map(cmt => {
                                const m = getMemberData(cmt.authorEmail);
                                return (
                                    <div key={cmt._id} className="flex gap-4 p-4 bg-gray-50 rounded-2xl border border-gray-100 group">
                                        <window.Avatar label={cmt.authorEmail?.charAt(0).toUpperCase()} src={m.avatar} size="md" />
                                        <div className="flex-1">
                                            <div className="flex justify-between items-center mb-1">
                                                <div>
                                                    <span className="text-xs font-black">{cmt.authorEmail.split('@')[0]}</span>
                                                    <span className="text-[9px] text-gray-400 font-bold ml-2">{new Date(cmt.timestamp).toLocaleString()}</span>
                                                </div>
                                                <button onClick={() => deleteComment(cmt._id)} className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-600 transition"><window.Icon name="trash-2" size={12}/></button>
                                            </div>
                                            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{cmt.text}</p>
                                            {cmt.taggedUsers && cmt.taggedUsers.length > 0 && (
                                                <div className="mt-2 flex flex-wrap gap-1">
                                                    {cmt.taggedUsers.map(u => <span key={u} className="text-[9px] bg-blue-50 text-blue-500 px-2 py-0.5 rounded-full font-black">@{u.split('@')[0]}</span>)}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            {comments.length === 0 && <p className="text-xs text-gray-400 italic">{t('alerts.no_communication')}</p>}
                        </div>
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <textarea 
                                    className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-4 text-sm resize-none outline-none focus:ring-2 focus:ring-blue-500 transition" 
                                    rows="1" 
                                    placeholder={t('labels.comment_placeholder')}
                                    value={newComment} 
                                    onChange={handleCommentChange} 
                                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), submitComment())}
                                />
                                {showCommentTagDropdown && (
                                    <div className="absolute bottom-full left-0 mb-2 w-48 bg-white rounded-2xl shadow-2xl border border-gray-100 p-2 z-[2000] animate-pop text-black">
                                        {members.map(email => (
                                            <button key={email} onClick={() => addCommentTag(email)} className="w-full text-left p-2 rounded-xl text-[10px] font-bold flex items-center gap-2 hover:bg-gray-50">
                                                <window.Avatar label={email.charAt(0).toUpperCase()} src={getMemberData(email).avatar} size="sm" /> {email.split('@')[0]}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <button onClick={submitComment} title={t('actions.submit_intel')} className="bg-blue-500 hover:bg-blue-600 text-white rounded-2xl px-6 font-black uppercase tracking-widest text-[10px] transition"><window.Icon name="send" size={16} /></button>
                        </div>
                    </div>
                </div>
                <div className="p-6 border-t border-gray-50 bg-gray-50/50 flex flex-col">
    {showAudit && (
        <div className="mb-4 bg-white p-4 rounded-xl border border-gray-100 max-h-48 overflow-y-auto text-black">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">{t('labels.audit_trail')}</h4>
            <div className="space-y-2">
                {(card.auditTrail || []).map((log, i) => (
                    <div key={i} className="text-xs text-gray-500 flex justify-between border-b border-gray-50 pb-1">
                        <span><strong className="text-gray-700">{log.user || t('labels.system')}</strong> -> {log.action}</span>
                        <span className="text-[9px] text-gray-400">{new Date(log.timestamp).toLocaleString()}</span>
                    </div>
                ))}
                {(!card.auditTrail || card.auditTrail.length === 0) && <div className="text-xs text-gray-400 italic">{t('alerts.no_history')}</div>}
            </div>
        </div>
    )}
    <div className="flex justify-between items-center">
        <button onClick={() => setShowAudit(!showAudit)} className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 transition text-[10px] font-black uppercase tracking-widest">
            <window.Icon name={showAudit ? "chevron-up" : "chevron-down"} size={14} /> {t('labels.audit_trail')}
        </button>
        <button onClick={() => onSave({ __v: card.__v, title, content, dueDate, urgency, epic, checklist, assignees, attachments, auditEvent: { user: user?.email || 'System', action: 'Updated card contents' } })} className="bg-blue-500 text-white px-10 py-4 rounded-full text-[10px] font-black uppercase tracking-widest active:scale-95 transition shadow-xl">{t('actions.synchronize')}</button>
    </div>
</div>
            </div>
            {previewImage && (
                <window.GlobalModal isOpen={true} onClose={() => setPreviewImage(null)} title={t('labels.attachment_preview')} footer={<button onClick={() => setPreviewImage(null)} className="bg-black text-white px-8 py-3 rounded-full text-[9px] font-black uppercase tracking-widest shadow-xl">{t('actions.close')}</button>}>
                    <div className="flex items-center justify-center min-h-[300px]">
                        <img src={previewImage} alt="Preview" className="max-w-full max-h-[70vh] rounded-2xl shadow-lg" />
                    </div>
                </window.GlobalModal>
            )}
        </div>
    );
};
