// Task card editor.
//
// Presentational sections live at module scope on purpose. Declared inside
// CardModal they would be a new component type on every render, so React would
// unmount and remount every input — dropping focus on each keystroke.
//
// The edited card is one `draft` reducer rather than a dozen useState calls:
// "is this dirty?" and "what do we PUT?" then both read from a single object
// instead of re-listing every field and drifting when a new one is added.

const CM_URGENCIES = ['LOW', 'MED', 'HIGH'];
const CM_QA_STATUSES = ['NONE', 'PENDING', 'PASSED', 'FAILED'];
const CM_URGENCY_COLORS = { LOW: 'bg-blue-400', MED: 'bg-yellow-400', HIGH: 'bg-red-500' };
const CM_QA_COLORS = { NONE: 'bg-gray-400', PENDING: 'bg-amber-400', PASSED: 'bg-emerald-500', FAILED: 'bg-red-500' };
const CM_IMAGE_EXT = /\.(jpeg|jpg|gif|png|webp|svg)$/i;
const CM_VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;
const CM_MAX_TOTAL_BYTES = 10 * 1024 * 1024;
// A mention is only "in progress" while the caret sits on a trailing @token.
// Matching the whole value (rather than "contains an @") is what lets the
// dropdown close again once the tag is finished.
const CM_MENTION = /(^|\s)@\S*$/;

// One type scale for the whole dialog. Ad-hoc sizes (text-[8px], text-[11px],
// text-xs) had crept into every section, so the same kind of text rendered at a
// different size depending on which block it sat in. Body is 13px to match the
// Quill editor, which hard-codes 13px in index.html — anything else makes the
// objective reflow the moment you click into it.
const CM_TYPE = {
    label: 'text-sm font-black text-black uppercase tracking-widest',
    body: 'text-[13px]',
    input: 'text-[13px] font-black',
    meta: 'text-[10px]',
    micro: 'text-[9px]',
};

const cmDateOnly = value => {
    if (!value) return '';
    const str = String(value);
    return str.includes('T') ? str.split('T')[0] : str;
};

// Attachments are uploaded to the server and stored as a path
// (`task_media/<file>`), not embedded in the task document. Legacy rows still
// carry a base64 `dataUrl`, so size reads whichever is present.
const cmAttachmentBytes = a => {
    if (a.byteSize) return a.byteSize;
    // base64 is ~33% larger than the file it encodes
    if (a.dataUrl) return Math.round(a.dataUrl.length * 0.75);
    return 0;
};

const cmDraftFromCard = card => ({
    title: card.title || '',
    content: card.content || '',
    dueDate: cmDateOnly(card.dueDate),
    urgency: card.urgency || 'LOW',
    qaStatus: card.qaStatus || 'NONE',
    epic: card.epic || '',
    checklist: (card.checklist || []).filter(Boolean),
    assignees: (card.assignees || []).filter(Boolean),
    attachments: (card.attachments || []).filter(Boolean),
});

const cmDraftReducer = (state, action) => {
    switch (action.type) {
        case 'field':
            return { ...state, [action.field]: action.value };
        case 'toggleAssignee':
            return {
                ...state,
                assignees: state.assignees.includes(action.email)
                    ? state.assignees.filter(e => e !== action.email)
                    : [...state.assignees, action.email],
            };
        case 'addCheck':
            return { ...state, checklist: [...state.checklist, action.item] };
        case 'toggleCheck':
            return {
                ...state,
                checklist: state.checklist.map(i => (i.id === action.id ? { ...i, done: !i.done } : i)),
            };
        case 'renameCheck':
            return {
                ...state,
                checklist: state.checklist.map(i => (i.id === action.id ? { ...i, text: action.text } : i)),
            };
        case 'deleteCheck':
            return { ...state, checklist: state.checklist.filter(i => i.id !== action.id) };
        case 'setAllChecks':
            return { ...state, checklist: state.checklist.map(i => ({ ...i, done: action.done })) };
        case 'addAttachment':
            return { ...state, attachments: [...state.attachments, action.attachment] };
        case 'removeAttachment':
            return { ...state, attachments: state.attachments.filter((_, i) => i !== action.index) };
        default:
            return state;
    }
};

// Closes a dropdown on any click outside it. The callback is held in a ref so a
// new inline arrow on each render does not tear down and re-add the listener.
const cmUseOutsideClick = (ref, onOutside, active) => {
    const handler = React.useRef(onOutside);
    React.useEffect(() => { handler.current = onOutside; });
    React.useEffect(() => {
        if (!active) return;
        const onMouseDown = e => {
            if (ref.current && !ref.current.contains(e.target)) handler.current();
        };
        document.addEventListener('mousedown', onMouseDown);
        return () => document.removeEventListener('mousedown', onMouseDown);
    }, [active]);
};

const CMLabel = ({ children, className = 'mb-3' }) => (
    <label className={`block ${CM_TYPE.label} ${className}`}>{children}</label>
);

const CMSegmented = ({ options, value, colors, onChange, renderLabel }) => (
    <div className="flex gap-1.5 p-1 bg-gray-50 rounded-2xl border border-gray-100">
        {options.map(opt => (
            <button
                key={opt}
                onClick={() => onChange(opt)}
                className={`flex-1 py-2 rounded-xl ${CM_TYPE.micro} font-black uppercase tracking-widest transition ${
                    value === opt ? colors[opt] + ' text-white shadow-md' : 'text-gray-400 hover:bg-white'
                }`}
            >{renderLabel(opt)}</button>
        ))}
    </div>
);

const CMAssignees = ({ assignees, members, memberOf, onToggle, t }) => {
    const [open, setOpen] = React.useState(false);
    const dropdownRef = React.useRef(null);
    cmUseOutsideClick(dropdownRef, () => setOpen(false), open);

    return (
        <div>
            <CMLabel>{t('labels.assignees')}</CMLabel>
            <div className="flex flex-wrap gap-2 items-center">
                {assignees.map(email => {
                    const m = memberOf(email);
                    return (
                        <div key={email} className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-100">
                            <window.Avatar label={window.getInitials(m)} src={window.getImageUrl(m.avatar)} size="sm" />
                            <span className={`${CM_TYPE.meta} font-bold`}>{email.split('@')[0]}</span>
                            <button onClick={() => onToggle(email)} className="text-gray-400 hover:text-red-500"><window.Icon name="x" size={12} /></button>
                        </div>
                    );
                })}
                <div className="relative" ref={dropdownRef}>
                    <button onClick={() => setOpen(o => !o)} className="w-8 h-8 rounded-full border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-400 transition"><window.Icon name="plus" size={14} /></button>
                    {open && (
                        <div className="absolute top-full left-0 mt-2 w-48 bg-white rounded-2xl shadow-2xl border border-gray-100 p-2 z-[2000] animate-pop text-black max-h-64 overflow-y-auto">
                            {(members || []).map(email => {
                                const m = memberOf(email);
                                return (
                                    <button
                                        key={email}
                                        onClick={() => { onToggle(email); setOpen(false); }}
                                        className={`w-full text-left p-2 rounded-xl ${CM_TYPE.meta} font-bold flex items-center gap-2 hover:bg-gray-50 ${assignees.includes(email) ? 'bg-blue-50 text-blue-600' : ''}`}
                                    >
                                        <window.Avatar label={window.getInitials(m)} src={window.getImageUrl(m.avatar)} size="sm" /> {email}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const CMObjective = ({ content, onChange, cardId, readOnly, t }) => {
    const [editing, setEditing] = React.useState(false);

    // Linkifying walks the DOM, so it only re-runs when the HTML actually changes
    // rather than on every keystroke elsewhere in the modal.
    const html = React.useMemo(() => {
        if (!content) return `<p class="text-gray-400">${t('alerts.no_objective') || 'No objective defined...'}</p>`;
        const temp = document.createElement('div');
        temp.innerHTML = content;
        const walk = document.createTreeWalker(temp, NodeFilter.SHOW_TEXT, null, false);
        const nodesToReplace = [];
        let node;
        while ((node = walk.nextNode())) {
            if (node.parentNode && node.parentNode.tagName === 'A') continue;
            if (/(https?:\/\/[^\s]+)/.test(node.nodeValue)) nodesToReplace.push(node);
        }
        nodesToReplace.forEach(n => {
            const span = document.createElement('span');
            span.innerHTML = n.nodeValue.replace(/(https?:\/\/[^\s]+)/g, (raw) => {
                const url = window.trimUrlPunctuation(raw);
                const tail = raw.slice(url.length);
                // A card on this platform gets no target: the delegated handler below
                // keeps you in the app rather than reloading it in a new tab.
                const target = window.parseInternalCardUrl(url) ? '' : ' target="_blank" rel="noopener noreferrer"';
                return `<a href="${url}"${target} class="text-blue-500 underline">${url}</a>${tail}`;
            });
            n.parentNode.replaceChild(span, n);
        });
        return temp.innerHTML;
    }, [content, t]);

    // Delegated, because this subtree is injected as HTML and cannot carry React props.
    // Checking every anchor rather than only the ones linkified above also covers links
    // the author inserted with the editor's own link button.
    const handleContentClick = React.useCallback((event) => {
        const anchor = event.target.closest && event.target.closest('a[href]');
        if (!anchor) {
            if (!readOnly) setEditing(true);
            return;
        }
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        const internal = window.parseInternalCardUrl(anchor.getAttribute('href'));
        if (!internal) {
            // External link: let it open, but do not also drop the box into edit mode.
            event.stopPropagation();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (window.NTNavigateToCard) window.NTNavigateToCard(internal);
    }, [readOnly]);

    return (
        <div>
            <div className="mb-3">
                <CMLabel className="">{t('labels.mission_objective')}</CMLabel>
            </div>
            {editing && !readOnly ? (
                <window.WYSIWYG id={cardId} value={content} onChange={onChange} onBlur={() => setEditing(false)} autoFocus />
            ) : (
                // `ql-editor` is required for Quill's own list/align/indent markup to
                // render, but it also ships `padding: 12px 15px` — !p-4 overrides it so
                // this box lines up with every other panel in the modal.
                // Quill is contenteditable, not a form control, so a disabled fieldset
                // would not stop it — read-only has to keep this branch rendered.
                <div
                    className={`!p-4 bg-gray-50 rounded-2xl border border-gray-100 ${CM_TYPE.body} min-h-[60px] ql-editor transition ${readOnly ? '' : 'cursor-text hover:border-blue-200 hover:bg-white'}`}
                    onClick={handleContentClick}
                    dangerouslySetInnerHTML={{ __html: html }}
                />
            )}
        </div>
    );
};

const CMChecklist = ({ items, onToggle, onRename, onDelete, onAdd, onSetAll, readOnly, t, tr }) => {
    const [newItem, setNewItem] = React.useState('');
    const [editingId, setEditingId] = React.useState(null);
    const [editingText, setEditingText] = React.useState('');
    // Escape has to cancel a rename, but tearing the input down also fires its
    // blur handler — without this flag the cancelled text would be committed.
    const cancelledEdit = React.useRef(false);
    const addRef = React.useRef(null);

    const doneCount = items.filter(i => i.done).length;
    const allDone = items.length > 0 && doneCount === items.length;
    const percent = items.length ? Math.round((doneCount / items.length) * 100) : 0;

    const startEdit = item => { setEditingId(item.id); setEditingText(item.text); };

    const commitEdit = id => {
        if (!cancelledEdit.current && editingText.trim()) onRename(id, editingText.trim());
        cancelledEdit.current = false;
        setEditingId(null);
        setEditingText('');
    };

    const cancelEdit = () => {
        cancelledEdit.current = true;
        setEditingId(null);
        setEditingText('');
    };

    const addItem = () => {
        if (!newItem.trim()) return;
        onAdd({ id: window.generateId('chk'), text: newItem.trim(), done: false });
        setNewItem('');
        // Adding is usually done in bursts, so keep the caret in the field.
        addRef.current?.focus();
    };

    return (
        <div>
            <div className={`${CM_TYPE.label} mb-3 flex justify-between items-center gap-4`}>
                <div className="flex items-center gap-3 min-w-0">
                    <span className="truncate">{t('labels.checklist_status')}</span>
                    {items.length > 0 && (
                        <button
                            onClick={() => onSetAll(!allDone)}
                            className={`${CM_TYPE.micro} font-black uppercase tracking-widest text-blue-500 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1 rounded-full transition whitespace-nowrap`}
                        >{allDone ? tr('actions.uncheck_all', 'Uncheck All') : tr('actions.check_all', 'Check All')}</button>
                    )}
                </div>
                {items.length > 0 && (
                    <span className={`${CM_TYPE.meta} font-black tracking-tight whitespace-nowrap ${allDone ? 'text-emerald-500' : 'text-gray-400'}`}>
                        {doneCount}/{items.length} <span className="lowercase">{t('labels.done')}</span>
                    </span>
                )}
            </div>

            {/* Same emerald bar the board card shows, so progress reads the same in both places. */}
            {items.length > 0 && (
                <div className="w-full bg-gray-50 h-1.5 rounded-full overflow-hidden mb-4 border border-gray-100" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                    <div className="bg-emerald-400 h-full transition-all duration-500" style={{ width: `${percent}%` }} />
                </div>
            )}

            {items.length === 0 ? (
                <div className={`${CM_TYPE.body} text-gray-300 font-bold text-center py-6 mb-3 border-2 border-dashed border-gray-100 rounded-2xl`}>
                    {tr('labels.checklist_empty', 'No checklist items yet.')}
                </div>
            ) : (
                <div className="space-y-1.5 mb-3">
                    {items.map(item => (
                        <div key={item.id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl group transition hover:bg-gray-50 border border-transparent hover:border-gray-100">
                            <button
                                onClick={() => onToggle(item.id)}
                                role="checkbox"
                                aria-checked={!!item.done}
                                aria-label={item.text}
                                className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all flex-shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 ${item.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-200 hover:border-emerald-400'}`}
                            >{item.done && <window.Icon name="check" size={12} />}</button>
                            {editingId === item.id ? (
                                <input
                                    autoFocus
                                    className={`flex-1 min-w-0 ${CM_TYPE.body} font-bold bg-white border border-blue-300 rounded-xl px-3 py-1 outline-none focus:ring-2 focus:ring-blue-400`}
                                    value={editingText}
                                    onChange={e => setEditingText(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') commitEdit(item.id);
                                        if (e.key === 'Escape') cancelEdit();
                                    }}
                                    onBlur={() => commitEdit(item.id)}
                                />
                            ) : (
                                // Done items stay editable — a typo does not become
                                // permanent just because the box got ticked.
                                // A span ignores the disabled fieldset, so read-only has
                                // to drop the click-to-rename affordance itself.
                                <span
                                    tabIndex={readOnly ? -1 : 0}
                                    onClick={() => { if (!readOnly) startEdit(item); }}
                                    onKeyDown={e => { if (!readOnly && e.key === 'Enter') { e.preventDefault(); startEdit(item); } }}
                                    className={`flex-1 min-w-0 break-words ${CM_TYPE.body} font-bold rounded outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${readOnly ? '' : 'cursor-pointer'} ${item.done ? `line-through text-gray-300 ${readOnly ? '' : 'hover:text-gray-400'}` : `text-gray-800 ${readOnly ? '' : 'hover:text-blue-600'}`}`}
                                    title={readOnly ? undefined : tr('actions.click_to_edit', 'Click to edit')}
                                >{item.text}</span>
                            )}
                            {/* Hover-only controls are unreachable by touch and keyboard,
                                so the button is always visible below sm and whenever the
                                row holds focus. */}
                            <button
                                onClick={() => onDelete(item.id)}
                                aria-label={tr('actions.delete_item', 'Delete item')}
                                title={tr('actions.delete_item', 'Delete item')}
                                className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 sm:focus-visible:opacity-100 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-full transition flex-shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-red-300"
                            ><window.Icon name="trash-2" size={14} /></button>
                        </div>
                    ))}
                </div>
            )}

            <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-2xl border border-gray-100 focus-within:border-blue-200 focus-within:bg-white transition">
                <window.Icon name="plus" size={16} className="text-gray-300 ml-2 shrink-0" />
                <input
                    ref={addRef}
                    className={`flex-1 min-w-0 bg-transparent outline-none ${CM_TYPE.input}`}
                    placeholder={t('labels.define_objective')}
                    value={newItem}
                    onChange={e => setNewItem(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') addItem();
                        if (e.key === 'Escape') setNewItem('');
                    }}
                />
                <button
                    onClick={addItem}
                    disabled={!newItem.trim()}
                    className={`${CM_TYPE.micro} font-black uppercase tracking-widest px-4 py-2 rounded-xl transition shrink-0 ${newItem.trim() ? 'bg-blue-500 hover:bg-blue-600 text-white active:scale-95' : 'bg-gray-100 text-gray-300 cursor-not-allowed'}`}
                >{tr('actions.add_item', 'Add')}</button>
            </div>
        </div>
    );
};

const CMAttachments = ({ attachments, uploading, onUpload, onRemove, onPreview, readOnly, t }) => {
    const fileInputRef = React.useRef(null);

    return (
        <div>
            <CMLabel className="mb-6">{t('labels.attachments')}</CMLabel>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {attachments.map((a, i) => {
                    // `path` is the current shape; `dataUrl` is legacy base64 still
                    // sitting on older cards. Both must render or existing
                    // attachments vanish from the UI.
                    const src = a.path ? window.getImageUrl(a.path) : a.dataUrl;
                    // Legacy rows can be missing `name` entirely, so never call a
                    // string method on it unguarded.
                    const name = a.name || 'Attachment';
                    const mime = a.mimeType || '';
                    const isImage = mime.startsWith('image/') || (a.dataUrl || '').startsWith('data:image/') || CM_IMAGE_EXT.test(name);
                    const isVideo = mime.startsWith('video/') || CM_VIDEO_EXT.test(name);
                    return (
                        <div key={a.id || i} className="bg-gray-50 p-4 rounded-2xl border border-gray-100 flex items-center justify-between shadow-sm hover:shadow-md transition">
                            <div className="flex items-center gap-3 min-w-0">
                                {isImage ? (
                                    <div className="w-10 h-10 rounded-lg overflow-hidden cursor-pointer border border-gray-200 shrink-0" onClick={() => onPreview({ src, name, isVideo: false })}>
                                        <img src={src} alt={name} className="w-full h-full object-cover" />
                                    </div>
                                ) : isVideo ? (
                                    // preload="metadata" is enough for the browser to paint a first
                                    // frame as the thumbnail without pulling the whole file down.
                                    <div className="relative w-10 h-10 rounded-lg overflow-hidden cursor-pointer border border-gray-200 shrink-0 bg-black" onClick={() => onPreview({ src, name, isVideo: true })} title={t('labels.attachment_preview')}>
                                        <video src={src} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                                        <div className="absolute inset-0 flex items-center justify-center bg-black/30 text-white">
                                            <window.Icon name="play" size={14} />
                                        </div>
                                    </div>
                                ) : (
                                    <window.Icon name="file-text" size={18} className="text-gray-400 shrink-0" />
                                )}
                                <div className="min-w-0">
                                    <p className={`${CM_TYPE.meta} font-black line-clamp-1`} title={name}>{name}</p>
                                    <p className={`${CM_TYPE.micro} text-gray-400 uppercase font-black`}>{a.size || ''}</p>
                                </div>
                            </div>
                            <div className="flex gap-1 shrink-0">
                                <a href={src} download={name} target="_blank" rel="noreferrer" className="p-2 text-blue-500 hover:bg-blue-50 rounded-full transition inline-flex" title={t('actions.download')}><window.Icon name="download" size={16} /></a>
                                <button onClick={() => onRemove(i)} className="p-2 text-red-500 hover:bg-red-50 rounded-full transition" title={t('actions.remove')}><window.Icon name="trash-2" size={16} /></button>
                            </div>
                        </div>
                    );
                })}
                {/* Upload tile is a div, so the disabled fieldset cannot reach it —
                    read-only drops it entirely rather than showing a dead target. */}
                {!readOnly && (
                    <div
                        onClick={() => { if (!uploading) fileInputRef.current.click(); }}
                        className={`border-2 border-dashed border-gray-100 p-4 rounded-2xl flex flex-col items-center justify-center transition text-gray-300 gap-1.5 ${uploading ? 'opacity-50 cursor-wait' : 'cursor-pointer hover:bg-gray-50'}`}
                    >
                        <window.Icon name={uploading ? 'loader' : 'upload-cloud'} size={24} className={uploading ? 'animate-spin' : ''} />
                        <span className={`${CM_TYPE.micro} font-black uppercase tracking-widest`}>{uploading ? (t('labels.uploading') || 'Uploading...') : t('actions.attach_intel')}</span>
                        <input type="file" ref={fileInputRef} className="hidden" disabled={uploading} onChange={onUpload} />
                    </div>
                )}
            </div>
        </div>
    );
};

const CMComments = ({ comments, members, memberOf, onSubmit, onDelete, t }) => {
    const [text, setText] = React.useState('');
    const [tagged, setTagged] = React.useState([]);
    const [showTagDropdown, setShowTagDropdown] = React.useState(false);
    const [sending, setSending] = React.useState(false);
    const composerRef = React.useRef(null);
    cmUseOutsideClick(composerRef, () => setShowTagDropdown(false), showTagDropdown);

    const handleChange = e => {
        const val = e.target.value;
        setText(val);
        setShowTagDropdown(CM_MENTION.test(val));
    };

    const addTag = email => {
        setTagged(prev => (prev.includes(email) ? prev : [...prev, email]));
        setText(prev => prev.replace(CM_MENTION, `$1@${email} `));
        setShowTagDropdown(false);
    };

    const submit = async () => {
        if (sending || !text.trim()) return;
        setSending(true);
        const ok = await onSubmit(text, tagged);
        setSending(false);
        if (ok) {
            setText('');
            setTagged([]);
            setShowTagDropdown(false);
        }
    };

    return (
        <div className="border-t border-gray-100 pt-8 mt-4">
            <CMLabel className="mb-6">{t('labels.mission_chatter_title')}</CMLabel>
            <div className="space-y-4 mb-6">
                {comments.map(cmt => {
                    const m = memberOf(cmt.authorEmail);
                    return (
                        <div key={cmt._id} className="flex gap-4 p-4 bg-gray-50 rounded-2xl border border-gray-100 group">
                            <window.Avatar label={window.getInitials(m)} src={window.getImageUrl(m.avatar)} size="md" />
                            <div className="flex-1">
                                <div className="flex justify-between items-center mb-1">
                                    <div>
                                        <span className={`${CM_TYPE.meta} font-black`}>{(cmt.authorEmail || '').split('@')[0]}</span>
                                        <span className={`${CM_TYPE.micro} text-gray-400 font-bold ml-2`}>{new Date(cmt.timestamp).toLocaleString()}</span>
                                    </div>
                                    <button onClick={() => onDelete(cmt._id)} className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-600 transition"><window.Icon name="trash-2" size={12} /></button>
                                </div>
                                {/* Rendered as text with its URLs linkified — never as HTML,
                                    since the body is unsanitised user input. Links to a card
                                    on this platform navigate in place instead of opening a tab. */}
                                <p className={`${CM_TYPE.body} text-gray-700 whitespace-pre-wrap leading-relaxed`}>
                                    <window.LinkedText text={cmt.text} />
                                </p>
                                {cmt.taggedUsers && cmt.taggedUsers.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                        {cmt.taggedUsers.map(u => <span key={u} className={`${CM_TYPE.micro} bg-blue-50 text-blue-500 px-2 py-0.5 rounded-full font-black`}>@{u.split('@')[0]}</span>)}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
                {comments.length === 0 && <p className={`${CM_TYPE.body} text-gray-400 italic`}>{t('alerts.no_communication')}</p>}
            </div>
            <div className="flex gap-2">
                <div className="relative flex-1" ref={composerRef}>
                    <textarea
                        className={`w-full bg-gray-50 border border-gray-100 rounded-2xl p-4 ${CM_TYPE.body} resize-none outline-none focus:ring-2 focus:ring-blue-500 transition`}
                        rows="1"
                        placeholder={t('labels.comment_placeholder')}
                        value={text}
                        onChange={handleChange}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
                        }}
                    />
                    {showTagDropdown && (
                        <div className="absolute bottom-full left-0 mb-2 w-48 bg-white rounded-2xl shadow-2xl border border-gray-100 p-2 z-[2000] animate-pop text-black max-h-64 overflow-y-auto">
                            {(members || []).map(email => {
                                const m = memberOf(email);
                                return (
                                    <button key={email} onClick={() => addTag(email)} className={`w-full text-left p-2 rounded-xl ${CM_TYPE.meta} font-bold flex items-center gap-2 hover:bg-gray-50`}>
                                        <window.Avatar label={window.getInitials(m)} src={window.getImageUrl(m.avatar)} size="sm" /> {email.split('@')[0]}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
                <button
                    onClick={submit}
                    disabled={sending || !text.trim()}
                    title={t('actions.submit_intel')}
                    className={`bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-2xl px-6 font-black uppercase tracking-widest ${CM_TYPE.meta} transition`}
                ><window.Icon name={sending ? 'loader' : 'send'} size={16} className={sending ? 'animate-spin' : ''} /></button>
            </div>
        </div>
    );
};

const CMAuditTrail = ({ trail, t }) => (
    <div className="mb-4 bg-white p-4 rounded-xl border border-gray-100 max-h-48 overflow-y-auto text-black">
        <h4 className={`${CM_TYPE.meta} font-black uppercase tracking-widest text-gray-400 mb-2`}>{t('labels.audit_trail')}</h4>
        <div className="space-y-2">
            {(trail || []).map((log, i) => (
                <div key={i} className={`${CM_TYPE.meta} text-gray-500 flex justify-between border-b border-gray-50 pb-1`}>
                    <span><strong className="text-gray-700">{log.user || t('labels.system')}</strong> {'->'} {log.action}</span>
                    <span className={`${CM_TYPE.micro} text-gray-400`}>{new Date(log.timestamp).toLocaleString()}</span>
                </div>
            ))}
            {(!trail || trail.length === 0) && <div className={`${CM_TYPE.meta} text-gray-400 italic`}>{t('alerts.no_history')}</div>}
        </div>
    </div>
);

window.CardModal = ({ card, lockedBy, user, members, allUsers, onClose, onSave, onDelete, socket, workspaceId, cardUrl }) => {
    const cardId = card.id || card._id;
    // Someone else holds the edit lock: the card opens, but every field that the
    // whole-card PUT would overwrite is frozen. Comments are exempt — they post to
    // their own endpoint and cannot clobber the editor's work.
    const readOnly = !!lockedBy && lockedBy !== user?.email;
    const lockedByName = (lockedBy || '').split('@')[0];

    React.useEffect(() => {
        if (socket && cardId) {
            // Emitted even when we believe the card is locked: a client that joined
            // after the lock was taken never saw `card:locked`, and the rejection is
            // what tells it. Re-runs when `lockedBy` clears, so a viewer whose turn
            // comes takes the lock and becomes an editor without reopening.
            socket.emit('card:lock', { cardId, userEmail: user?.email, workspaceId });
        }
        return () => {
            if (socket && cardId) {
                // Ignored by the server unless this socket is the holder.
                socket.emit('card:unlock', { cardId, workspaceId });
            }
        };
        // Keyed on `readOnly`, not `lockedBy`: once *we* hold the lock our own email
        // lands in `lockedBy`, and re-running on that would emit unlock-then-lock in
        // a loop against our own lock.
    }, [socket, cardId, user?.email, workspaceId, readOnly]);

    const { showConfirm } = window.useModals();
    const { showToast } = window.useToasts();
    const { t } = window.useTranslation ? window.useTranslation() : { t: k => k };
    const tr = React.useCallback((key, fallback) => {
        const value = t(key);
        return value && value !== key ? value : fallback;
    }, [t]);

    // `baseline` is the card as it was opened; `draft` is the working copy.
    // Both come from the same factory so dirty-checking compares like with like.
    const baseline = React.useMemo(() => cmDraftFromCard(card), [card]);
    const [draft, dispatch] = React.useReducer(cmDraftReducer, baseline);
    const setField = React.useCallback((field, value) => dispatch({ type: 'field', field, value }), []);

    const [comments, setComments] = React.useState(card.comments || []);
    const [uploading, setUploading] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [showAudit, setShowAudit] = React.useState(false);
    // { src, name, isVideo } — images and videos share one preview modal.
    const [preview, setPreview] = React.useState(null);

    const dirty = React.useMemo(
        () => JSON.stringify(draft) !== JSON.stringify(baseline),
        [draft, baseline]
    );

    // allUsers is scanned once per change instead of once per assignee, per
    // dropdown row and per comment author on every render.
    const usersByEmail = React.useMemo(() => {
        const map = new Map();
        (Array.isArray(allUsers) ? allUsers : []).forEach(u => { if (u && u.email) map.set(u.email, u); });
        return map;
    }, [allUsers]);
    const memberOf = React.useCallback(
        email => usersByEmail.get(email) || { email, avatar: null },
        [usersByEmail]
    );

    const submitComment = React.useCallback(async (text, taggedUsers) => {
        const payload = { authorEmail: user?.email || 'Unknown', text, taggedUsers };
        try {
            const res = await fetch(`/api/tasks/${cardId}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) throw new Error((data && data.error) || tr('alerts.comment_failed', 'Unable to post comment.'));
            // The PUT returns the whole task; fall back to appending locally if a
            // future response ever stops echoing the comment list back.
            if (Array.isArray(data && data.comments)) setComments(data.comments);
            else setComments(prev => [...prev, { ...payload, _id: window.generateId('cmt'), timestamp: new Date() }]);
            return true;
        } catch (err) {
            showToast(err.message || tr('alerts.comment_failed', 'Unable to post comment.'), 'error');
            return false;
        }
    }, [cardId, user?.email, tr, showToast]);

    const deleteComment = React.useCallback(id => {
        showConfirm(
            tr('actions.delete_comment', 'Delete Comment'),
            tr('alerts.confirm_delete_comment', 'Delete this comment? This cannot be undone.'),
            async () => {
                try {
                    const res = await fetch(`/api/tasks/${cardId}/comments/${id}`, { method: 'DELETE' });
                    if (!res.ok) throw new Error(tr('alerts.comment_delete_failed', 'Unable to delete comment.'));
                    setComments(prev => prev.filter(c => c._id !== id));
                } catch (err) {
                    showToast(err.message, 'error');
                }
            }
        );
    }, [cardId, showConfirm, tr, showToast]);

    const handleUpload = async e => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;

        const currentTotal = draft.attachments.reduce((sum, a) => sum + cmAttachmentBytes(a), 0);
        if (currentTotal + file.size > CM_MAX_TOTAL_BYTES) {
            const usedMB = (currentTotal / 1024 / 1024).toFixed(1);
            const fileMB = (file.size / 1024 / 1024).toFixed(1);
            showToast(t('alerts.attachment_limit_exceeded') || `File too large (${fileMB} MB) — card limit is 10 MB total (${usedMB} MB used).`, 'error');
            return;
        }

        setUploading(true);
        try {
            const formData = new FormData();
            formData.append('category', 'task_media');
            formData.append('file', file);
            const res = await fetch('/api/upload?category=task_media', { method: 'POST', body: formData });
            const data = await res.json().catch(() => null);
            if (!res.ok) throw new Error((data && data.error) || 'Upload failed.');
            dispatch({
                type: 'addAttachment',
                attachment: {
                    id: window.generateId('att'),
                    name: file.name,
                    path: data.path,
                    mimeType: file.type || '',
                    byteSize: file.size,
                    size: (file.size / 1024).toFixed(1) + ' KB',
                },
            });
            showToast(t('alerts.file_attached') || 'File attachment synchronized. 📎');
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            setUploading(false);
        }
    };

    // Guarded against double-fire: a second click while the PUT is in flight
    // would save the same payload twice and bump __v out from under the first.
    const handleSave = async () => {
        if (saving || readOnly) return;
        setSaving(true);
        try {
            await onSave({
                __v: card.__v,
                ...draft,
                auditEvent: { user: user?.email || 'System', action: 'Updated card contents' },
            });
        } catch (err) {
            showToast(err?.message || tr('alerts.save_failed', 'Unable to save card.'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleClose = () => {
        // A read-only viewer cannot have edits worth confirming, and its draft can
        // change under it when the poll swaps in a newer version of the card.
        if (!dirty || readOnly) return onClose();
        showConfirm(
            t('actions.discard_changes') || 'Discard Changes?',
            t('alerts.confirm_discard_changes') || 'You have unsaved changes. Are you sure you want to discard them?',
            onClose
        );
    };

    // Escape routes through handleClose, never onClose — otherwise it would
    // silently discard unsaved edits that the ✕ button asks you to confirm.
    window.useEscapeKey(handleClose);

    // Clicking a card link inside a comment or the description replaces the card on
    // screen, which discards the draft just as closing would — so it has to ask the
    // same question. Published on `window` because the navigation itself is driven from
    // App, which has no view of this modal's draft state.
    React.useEffect(() => {
        const openCardId = String(card.id || card._id || '');
        window.NTConfirmLeaveCard = (target, proceed) => {
            // A link to the card already on screen leaves nothing, so it never asks.
            if (target && String(target.cardId) === openCardId) return proceed();
            if (!dirty || readOnly) return proceed();
            showConfirm(
                t('actions.discard_changes') || 'Discard Changes?',
                t('alerts.confirm_discard_changes') || 'You have unsaved changes. Are you sure you want to discard them?',
                proceed
            );
        };
        return () => { delete window.NTConfirmLeaveCard; };
    }, [card.id, card._id, dirty, readOnly, showConfirm, t]);

    const copyCardLink = async () => {
        const link = cardUrl || window.location.href;
        const ok = await window.copyText(link);
        if (ok) showToast(tr('alerts.copied_to_clipboard', 'Copied to clipboard!'));
        else showToast(tr('alerts.copy_failed', 'Unable to copy link.'), 'error');
    };

    return (
        <div className="fixed inset-0 z-[1600] flex items-center justify-center p-4 glass-blur animate-fade-in text-black">
            <div className="bg-white w-[95%] md:w-full max-w-3xl rounded-3xl md:rounded-[2.5rem] shadow-2xl border border-gray-100 overflow-hidden animate-pop flex flex-col max-h-[90vh] md:max-h-[85vh]">
                <div className="p-6 border-b border-gray-50 flex justify-between items-center bg-gray-50/50">
                    <input className="text-2xl font-black focus:outline-none w-full bg-transparent tracking-tighter" value={draft.title} readOnly={readOnly} onChange={e => setField('title', e.target.value)} />
                    <div className="flex gap-2">
                        <button onClick={copyCardLink} className="p-3 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-full transition" title={tr('actions.copy_link', 'Copy Link')}><window.Icon name="link" size={20} /></button>
                        {!readOnly && (
                            <button onClick={() => showConfirm(t('actions.delete_mission'), t('actions.erase_completely'), () => onDelete(cardId))} className="p-3 text-red-400 hover:bg-red-50 rounded-full transition"><window.Icon name="trash-2" size={20} /></button>
                        )}
                        <button onClick={handleClose} className="p-3 hover:bg-gray-100 rounded-full transition"><window.Icon name="x" size={20} /></button>
                    </div>
                </div>

                {readOnly && (
                    <div className="px-6 py-3 bg-amber-50 border-b border-amber-100 flex items-center gap-2.5 text-amber-700">
                        <window.Icon name="lock" size={14} className="shrink-0" />
                        <span className={`${CM_TYPE.meta} font-bold`}>
                            {tr('labels.read_only_banner', `${lockedByName} is editing this card. You can read it and post comments — edits are locked until they close it.`).replace('{user}', lockedByName)}
                        </span>
                    </div>
                )}

                <div className="p-4 md:p-8 space-y-6 md:space-y-8 overflow-y-auto no-scrollbar flex-1">
                    {/* A disabled fieldset disables every form control inside it, which
                        covers the inputs and buttons. The handful of controls that are
                        plain divs/spans take an explicit `readOnly` prop instead. */}
                    <fieldset disabled={readOnly} className="m-0 p-0 border-0 min-w-0 space-y-6 md:space-y-8 disabled:opacity-60">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
                        <div>
                            <CMLabel>{t('labels.deadline')}</CMLabel>
                            <input type="date" className={`w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 ${CM_TYPE.input}`} value={draft.dueDate} onChange={e => setField('dueDate', e.target.value)} />
                        </div>
                        <div>
                            <CMLabel>{t('labels.epic_tag') || 'Epic Tag'}</CMLabel>
                            <input className={`w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none ${CM_TYPE.input}`} placeholder="e.g. Q4 Release" value={draft.epic} onChange={e => setField('epic', e.target.value)} />
                        </div>
                        <div>
                            <CMLabel>{t('labels.priority')}</CMLabel>
                            <CMSegmented
                                options={CM_URGENCIES}
                                value={draft.urgency}
                                colors={CM_URGENCY_COLORS}
                                onChange={v => setField('urgency', v)}
                                renderLabel={lvl => t(`labels.${lvl.toLowerCase()}`)}
                            />
                        </div>
                    </div>

                    <div>
                        <CMLabel>{t('labels.qa_status')}</CMLabel>
                        <CMSegmented
                            options={CM_QA_STATUSES}
                            value={draft.qaStatus}
                            colors={CM_QA_COLORS}
                            onChange={v => setField('qaStatus', v)}
                            renderLabel={st => t(`labels.qa_${st.toLowerCase()}`)}
                        />
                    </div>

                    <CMAssignees
                        assignees={draft.assignees}
                        members={members}
                        memberOf={memberOf}
                        onToggle={email => email && dispatch({ type: 'toggleAssignee', email })}
                        t={t}
                    />

                    <CMObjective
                        content={draft.content}
                        onChange={value => setField('content', value)}
                        cardId={cardId}
                        readOnly={readOnly}
                        t={t}
                    />

                    <CMChecklist
                        items={draft.checklist}
                        onToggle={id => dispatch({ type: 'toggleCheck', id })}
                        onRename={(id, text) => dispatch({ type: 'renameCheck', id, text })}
                        onDelete={id => dispatch({ type: 'deleteCheck', id })}
                        onAdd={item => dispatch({ type: 'addCheck', item })}
                        onSetAll={done => dispatch({ type: 'setAllChecks', done })}
                        readOnly={readOnly}
                        t={t}
                        tr={tr}
                    />

                    <CMAttachments
                        attachments={draft.attachments}
                        uploading={uploading}
                        onUpload={handleUpload}
                        onRemove={index => dispatch({ type: 'removeAttachment', index })}
                        onPreview={setPreview}
                        readOnly={readOnly}
                        t={t}
                    />
                    </fieldset>

                    <CMComments
                        comments={comments}
                        members={members}
                        memberOf={memberOf}
                        onSubmit={submitComment}
                        onDelete={deleteComment}
                        t={t}
                    />
                </div>

                <div className="p-6 border-t border-gray-50 bg-gray-50/50 flex flex-col">
                    {showAudit && <CMAuditTrail trail={card.auditTrail} t={t} />}
                    <div className="flex justify-between items-center gap-4">
                        <div className="flex items-center gap-4 min-w-0">
                            <button onClick={() => setShowAudit(!showAudit)} className={`flex items-center gap-1.5 text-gray-400 hover:text-gray-600 transition ${CM_TYPE.meta} font-black uppercase tracking-widest`}>
                                <window.Icon name={showAudit ? 'chevron-up' : 'chevron-down'} size={14} /> {t('labels.audit_trail')}
                            </button>
                            {dirty && !saving && !readOnly && (
                                <span className={`flex items-center gap-1.5 text-amber-500 ${CM_TYPE.meta} font-black uppercase tracking-widest whitespace-nowrap`}>
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                    {tr('labels.unsaved_changes', 'Unsaved changes')}
                                </span>
                            )}
                        </div>
                        {readOnly ? (
                            <span className={`flex items-center gap-2 text-gray-400 ${CM_TYPE.meta} font-black uppercase tracking-widest whitespace-nowrap`}>
                                <window.Icon name="eye" size={14} />
                                {tr('labels.read_only', 'Read-only')}
                            </span>
                        ) : (
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className={`bg-blue-500 hover:bg-blue-600 disabled:opacity-60 disabled:cursor-wait text-white px-10 py-4 rounded-full ${CM_TYPE.meta} font-black uppercase tracking-widest active:scale-95 transition shadow-xl flex items-center gap-2`}
                            >
                                {saving && <window.Icon name="loader" size={14} className="animate-spin" />}
                                {saving ? tr('actions.saving', 'Saving...') : t('actions.synchronize')}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {preview && (
                <window.GlobalModal isOpen={true} onClose={() => setPreview(null)} title={t('labels.attachment_preview')} footer={<button onClick={() => setPreview(null)} className={`bg-black text-white px-8 py-3 rounded-full ${CM_TYPE.meta} font-black uppercase tracking-widest shadow-xl`}>{t('actions.close')}</button>}>
                    <div className="flex items-center justify-center min-h-[300px]">
                        {preview.isVideo
                            ? <video src={preview.src} controls playsInline preload="metadata" className="max-w-full max-h-[70vh] rounded-2xl shadow-lg bg-black" />
                            : <img src={preview.src} alt={preview.name || 'Preview'} className="max-w-full max-h-[70vh] rounded-2xl shadow-lg" />}
                    </div>
                </window.GlobalModal>
            )}
        </div>
    );
};
