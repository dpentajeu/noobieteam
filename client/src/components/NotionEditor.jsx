const React = window.React;

// Notion-style writing surface for the Docs page, built on Tiptap.
//
// Tiptap ships as ES modules and this app has no bundler, so index.html imports
// it from an ESM CDN inside a module script and parks it on window.TipTap. That
// load is async, hence the readiness promise this component awaits before it
// touches the library.
//
// Documents are stored as plain HTML, the same as before the editor changed, so
// every existing renderer (the public docs page, the reading view) keeps working
// without a migration.

const SLASH_COMMANDS = [
    { id: 'text', icon: 'type', label: 'Text', hint: 'Plain paragraph', run: c => c.setParagraph() },
    { id: 'h1', icon: 'heading-1', label: 'Heading 1', hint: 'Big section heading', run: c => c.setNode('heading', { level: 1 }) },
    { id: 'h2', icon: 'heading-2', label: 'Heading 2', hint: 'Medium section heading', run: c => c.setNode('heading', { level: 2 }) },
    { id: 'h3', icon: 'heading-3', label: 'Heading 3', hint: 'Small section heading', run: c => c.setNode('heading', { level: 3 }) },
    { id: 'bullet', icon: 'list', label: 'Bulleted list', hint: 'Simple bulleted list', run: c => c.toggleBulletList() },
    { id: 'ordered', icon: 'list-ordered', label: 'Numbered list', hint: 'List with numbering', run: c => c.toggleOrderedList() },
    { id: 'todo', icon: 'square-check', label: 'To-do list', hint: 'Track tasks with checkboxes', run: c => c.toggleTaskList() },
    { id: 'table', icon: 'table', label: 'Table', hint: 'Insert a 3×3 table', run: c => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }) },
    { id: 'image', icon: 'image', label: 'Image', hint: 'Upload a picture', upload: true },
    { id: 'quote', icon: 'quote', label: 'Quote', hint: 'Capture a quotation', run: c => c.toggleBlockquote() },
    { id: 'code', icon: 'code', label: 'Code block', hint: 'Monospaced code with copy button', run: c => c.toggleCodeBlock() },
    { id: 'divider', icon: 'minus', label: 'Divider', hint: 'Visually separate blocks', run: c => c.setHorizontalRule() },
];


window.NotionEditor = ({ initialContent, editable = true, onChange, placeholder }) => {
    const holderRef = React.useRef(null);
    const wrapRef = React.useRef(null);
    const editorRef = React.useRef(null);
    const fileInputRef = React.useRef(null);
    const onChangeRef = React.useRef(onChange);
    const flushRef = React.useRef(null);

    const [ready, setReady] = React.useState(false);
    const [loadError, setLoadError] = React.useState(null);
    const [uploading, setUploading] = React.useState(false);
    const [slash, setSlash] = React.useState({ open: false, query: '', top: 0, left: 0 });
    const [active, setActive] = React.useState(0);
    const [bubble, setBubble] = React.useState({ open: false, top: 0, left: 0 });
    const [inTable, setInTable] = React.useState(false);
    const [, forceRender] = React.useReducer(x => x + 1, 0);

    React.useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

    // Documents written by the previous editor come in two shapes this one has
    // to neutralise: a Delta JSON string (very old records), and "<p><br></p>",
    // which Quill used for an empty document. Tiptap parseswhen that <br> into a
    // real hard break, so the document is no longer empty — the placeholder
    // never shows and every such page opens with a stray blank line.
    const startingContent = React.useMemo(() => {
        const raw = (initialContent || '').trim();
        if (!raw || raw.startsWith('[')) return '';
        const probe = document.createElement('div');
        probe.innerHTML = raw;
        const hasContent = probe.textContent.trim() || probe.querySelector('img, table, hr, pre, li');
        return hasContent ? raw : '';
    }, [initialContent]);
    const startingContentRef = React.useRef(startingContent);

    const filtered = React.useMemo(() => {
        const q = slash.query.trim().toLowerCase();
        if (!q) return SLASH_COMMANDS;
        return SLASH_COMMANDS.filter(c => c.label.toLowerCase().includes(q) || c.id.includes(q));
    }, [slash.query]);

    const filteredRef = React.useRef(filtered);
    const activeRef = React.useRef(0);
    const slashRef = React.useRef(slash);
    React.useEffect(() => { filteredRef.current = filtered; }, [filtered]);
    React.useEffect(() => { activeRef.current = active; }, [active]);
    React.useEffect(() => { slashRef.current = slash; }, [slash]);

    // --- image upload -----------------------------------------------------
    const uploadImage = React.useCallback(async (file) => {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/upload?category=doc_media', { method: 'POST', body: form });
        if (!res.ok) {
            const detail = await res.json().catch(() => null);
            throw new Error((detail && detail.error) || 'Upload failed.');
        }
        const { path } = await res.json();
        return window.getImageUrl ? window.getImageUrl(path) : `/media/${path}`;
    }, []);

    const insertImageFiles = React.useCallback(async (files) => {
        const editor = editorRef.current;
        const images = Array.from(files || []).filter(f => f.type.startsWith('image/'));
        if (!editor || images.length === 0) return;
        setUploading(true);
        try {
            for (const file of images) {
                const src = await uploadImage(file);
                editor.chain().focus().setImage({ src, alt: file.name }).run();
            }
        } catch (err) {
            console.error('Image upload failed:', err);
            if (window.NTToast) window.NTToast(err.message);
            else alert(err.message);
        } finally {
            setUploading(false);
        }
    }, [uploadImage]);

    const closeSlash = React.useCallback(() => {
        setSlash(s => (s.open ? { ...s, open: false, query: '' } : s));
        setActive(0);
    }, []);

    // Every slash command first deletes the "/query" that summoned the menu.
    const runCommand = React.useCallback((cmd) => {
        const editor = editorRef.current;
        const state = slashRef.current;
        if (!editor || !cmd) return;
        const to = editor.state.selection.from;
        const from = Math.max(0, to - (state.query.length + 1));
        const chain = editor.chain().focus().deleteRange({ from, to });
        closeSlash();
        if (cmd.upload) {
            chain.run();
            if (fileInputRef.current) fileInputRef.current.click();
            return;
        }
        cmd.run(chain).run();
    }, [closeSlash]);

    const runCommandRef = React.useRef(runCommand);
    React.useEffect(() => { runCommandRef.current = runCommand; }, [runCommand]);

    React.useEffect(() => {
        let cancelled = false;
        if (!window.__tiptapReady) { setLoadError(new Error('Tiptap loader missing.')); return; }
        window.__tiptapReady.then(() => { if (!cancelled) setReady(true); })
            .catch(err => { if (!cancelled) setLoadError(err); });
        return () => { cancelled = true; };
    }, []);

    React.useEffect(() => {
        if (!ready || !holderRef.current || editorRef.current) return;
        const T = window.TipTap;

        // Coordinates for the floating menus, relative to the wrapper they live in.
        const localCoords = (pos) => {
            const box = wrapRef.current.getBoundingClientRect();
            const at = editorRef.current.view.coordsAtPos(pos);
            return { top: at.bottom - box.top + 6, left: at.left - box.left };
        };

        let timer = null;
        let pending = null;
        const scheduleChange = (html) => {
            pending = html;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                if (pending !== null && onChangeRef.current) onChangeRef.current(pending);
                pending = null;
            }, 400);
        };
        flushRef.current = () => {
            if (timer) { clearTimeout(timer); timer = null; }
            if (pending !== null && onChangeRef.current) onChangeRef.current(pending);
            pending = null;
        };

        const syncSlash = (editor) => {
            const { from, empty } = editor.state.selection;
            if (!empty) return closeSlash();
            const before = editor.state.doc.textBetween(Math.max(0, from - 60), from, '\n', '\n');
            // Only a slash at a word boundary opens the menu, so URLs stay intact.
            const match = /(?:^|\s)\/([^\s/]*)$/.exec(before);
            if (!match) return closeSlash();
            const query = match[1];
            const coords = localCoords(from);
            setSlash({ open: true, query, top: coords.top, left: coords.left });
            setActive(0);
        };

        const syncBubble = (editor) => {
            const selection = editor.state.selection;
            const { empty, from, to } = selection;
            // Text marks are meaningless for a selected image or other atom, and
            // a code block deliberately takes no formatting.
            const isNode = !!selection.node;
            if (empty || isNode || editor.isActive('codeBlock')) {
                return setBubble(b => (b.open ? { ...b, open: false } : b));
            }
            const box = wrapRef.current.getBoundingClientRect();
            const start = editor.view.coordsAtPos(from);
            const end = editor.view.coordsAtPos(to);
            setBubble({
                open: true,
                top: Math.max(0, Math.min(start.top, end.top) - box.top - 46),
                left: Math.max(0, (start.left + end.left) / 2 - box.left - 120),
            });
        };

        const editor = new T.Editor({
            element: holderRef.current,
            editable,
            content: startingContentRef.current,
            extensions: [
                T.StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
                T.TaskList,
                T.TaskItem.configure({ nested: true }),
                T.Table.configure({ resizable: true }),
                T.TableRow,
                T.TableHeader,
                T.TableCell,
                T.Image.configure({ inline: false, allowBase64: false }),
                T.Placeholder.configure({
                    placeholder: ({ node }) => (node.type.name === 'paragraph'
                        ? (placeholder || "Type '/' for commands, or write in markdown…")
                        : ''),
                    showOnlyWhenEditable: true,
                }),
            ],
            editorProps: {
                attributes: { class: 'nd-editor-content' },
                handlePaste: (view, event) => {
                    const clip = event.clipboardData;
                    if (!clip) return false;
                    const files = Array.from(clip.files || []).filter(f => f.type.startsWith('image/'));
                    if (files.length) { event.preventDefault(); insertImageFiles(files); return true; }
                    const text = clip.getData('text/plain');
                    const html = clip.getData('text/html');
                    // A rich clipboard already carries structure; only rescue plain text.
                    if (!text || html || !window.looksLikeMarkdown(text)) return false;
                    event.preventDefault();
                    editorRef.current.chain().focus().insertContent(window.markdownToHtml(text)).run();
                    return true;
                },
                handleDrop: (view, event) => {
                    const files = Array.from((event.dataTransfer && event.dataTransfer.files) || [])
                        .filter(f => f.type.startsWith('image/'));
                    if (!files.length) return false;
                    event.preventDefault();
                    insertImageFiles(files);
                    return true;
                },
            },
            onUpdate: ({ editor: ed }) => {
                scheduleChange(ed.getHTML());
                syncSlash(ed);
                // A table command can leave the caret where it was, so no
                // selection update fires and the toolbar would blink out after
                // its own button was pressed.
                setInTable(ed.isActive('table'));
                forceRender();
            },
            onSelectionUpdate: ({ editor: ed }) => {
                syncSlash(ed);
                syncBubble(ed);
                setInTable(ed.isActive('table'));
                forceRender();
            },
            onBlur: () => { if (flushRef.current) flushRef.current(); },
        });
        editorRef.current = editor;

        // The slash menu owns Enter/arrows while it is open, and it has to win
        // before ProseMirror's own keymap sees the key.
        const onKeyDown = (e) => {
            if (!slashRef.current.open) return;
            const list = filteredRef.current;
            if (e.key === 'Escape') { e.preventDefault(); closeSlash(); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % Math.max(list.length, 1)); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + list.length) % Math.max(list.length, 1)); return; }
            if (e.key === 'Enter' || e.key === 'Tab') {
                if (!list.length) { closeSlash(); return; }
                e.preventDefault();
                e.stopPropagation();
                runCommandRef.current(list[activeRef.current]);
            }
        };
        editor.view.dom.addEventListener('keydown', onKeyDown, true);

        return () => {
            editor.view.dom.removeEventListener('keydown', onKeyDown, true);
            if (flushRef.current) flushRef.current();
            editor.destroy();
            editorRef.current = null;
        };
    }, [ready]);

    React.useEffect(() => {
        if (editorRef.current) editorRef.current.setEditable(editable);
    }, [editable]);

    React.useEffect(() => () => { if (flushRef.current) flushRef.current(); }, []);

    const editor = editorRef.current;
    const chain = () => editor.chain().focus();

    const MarkButton = ({ icon, title, isActive, onClick }) => (
        <button
            type="button"
            title={title}
            onMouseDown={e => e.preventDefault()}
            onClick={onClick}
            className={`w-7 h-7 rounded-[6px] flex items-center justify-center transition-colors ${isActive ? 'bg-[#0A84FF] text-white' : 'text-[#E8E8EA] hover:bg-[#2C2C31]'}`}
        >
            <window.Icon name={icon} size={13} />
        </button>
    );

    const TableButton = ({ icon, title, onClick }) => (
        <button
            type="button"
            title={title}
            onMouseDown={e => e.preventDefault()}
            onClick={onClick}
            className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[#6E6E73] hover:bg-[#EAF3FF] hover:text-[#0A84FF] transition-colors"
        >
            <window.Icon name={icon} size={13} />
        </button>
    );

    if (loadError) {
        return (
            <div className="border border-[#FDEDEE] bg-[#FDEDEE] text-[#E5484D] rounded-[10px] p-4 text-[12.5px] font-semibold">
                The editor could not load. Check your connection and reload the page.
            </div>
        );
    }

    return (
        <div ref={wrapRef} className="nd-editor relative">
            {/* Table controls, shown only while the caret sits inside a table.
                Rendered ahead of the content so `sticky` pins it to the top of
                the scrolling document rather than trailing below it. */}
            {ready && editor && inTable && (
                <div className="sticky top-0 z-30 mb-2 flex flex-wrap items-center gap-0.5 bg-white border border-[#ECECEC] rounded-[10px] px-1.5 py-1 shadow-sm w-fit">
                    <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#A5A5AA] px-1.5">Table</span>
                    <TableButton icon="between-horizontal-start" title="Add row above" onClick={() => chain().addRowBefore().run()} />
                    <TableButton icon="between-horizontal-end" title="Add row below" onClick={() => chain().addRowAfter().run()} />
                    <TableButton icon="between-vertical-start" title="Add column left" onClick={() => chain().addColumnBefore().run()} />
                    <TableButton icon="between-vertical-end" title="Add column right" onClick={() => chain().addColumnAfter().run()} />
                    <span className="w-px h-4 bg-[#ECECEC] mx-1" />
                    <TableButton icon="merge" title="Merge or split cells" onClick={() => chain().mergeOrSplit().run()} />
                    <TableButton icon="panel-top" title="Toggle header row" onClick={() => chain().toggleHeaderRow().run()} />
                    <span className="w-px h-4 bg-[#ECECEC] mx-1" />
                    <TableButton icon="rows-3" title="Delete row" onClick={() => chain().deleteRow().run()} />
                    <TableButton icon="columns-3" title="Delete column" onClick={() => chain().deleteColumn().run()} />
                    <button
                        type="button"
                        title="Delete table"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => chain().deleteTable().run()}
                        className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[#A5A5AA] hover:bg-[#FDEDEE] hover:text-[#E5484D] transition-colors"
                    >
                        <window.Icon name="trash-2" size={13} />
                    </button>
                </div>
            )}

            <div ref={holderRef} />

            {!ready && (
                <div className="text-[12.5px] text-[#A5A5AA] animate-pulse py-4">Loading editor…</div>
            )}

            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={e => { insertImageFiles(e.target.files); e.target.value = ''; }}
            />

            {uploading && (
                <div className="absolute top-0 right-0 flex items-center gap-2 bg-white border border-[#ECECEC] rounded-full px-3 py-1.5 shadow-sm text-[11.5px] font-semibold text-[#6E6E73]">
                    <window.Icon name="loader" size={12} className="animate-spin" /> Uploading…
                </div>
            )}

            {/* Selection toolbar. */}
            {ready && editor && bubble.open && (
                <div
                    className="absolute z-40 flex items-center gap-0.5 bg-[#171719] rounded-[8px] px-1.5 py-1 shadow-[0_6px_24px_rgba(0,0,0,0.28)]"
                    style={{ top: bubble.top, left: bubble.left }}
                >
                    <MarkButton icon="bold" title="Bold" isActive={editor.isActive('bold')} onClick={() => chain().toggleBold().run()} />
                    <MarkButton icon="italic" title="Italic" isActive={editor.isActive('italic')} onClick={() => chain().toggleItalic().run()} />
                    <MarkButton icon="underline" title="Underline" isActive={editor.isActive('underline')} onClick={() => chain().toggleUnderline().run()} />
                    <MarkButton icon="strikethrough" title="Strikethrough" isActive={editor.isActive('strike')} onClick={() => chain().toggleStrike().run()} />
                    <MarkButton icon="code" title="Inline code" isActive={editor.isActive('code')} onClick={() => chain().toggleCode().run()} />
                    <span className="w-px h-4 bg-[#3A3A3D] mx-1" />
                    <MarkButton icon="heading-1" title="Heading 1" isActive={editor.isActive('heading', { level: 1 })} onClick={() => chain().toggleHeading({ level: 1 }).run()} />
                    <MarkButton icon="heading-2" title="Heading 2" isActive={editor.isActive('heading', { level: 2 })} onClick={() => chain().toggleHeading({ level: 2 }).run()} />
                    <MarkButton icon="list" title="Bulleted list" isActive={editor.isActive('bulletList')} onClick={() => chain().toggleBulletList().run()} />
                    <MarkButton icon="quote" title="Quote" isActive={editor.isActive('blockquote')} onClick={() => chain().toggleBlockquote().run()} />
                    <MarkButton
                        icon="link"
                        title="Link"
                        isActive={editor.isActive('link')}
                        onClick={() => {
                            if (editor.isActive('link')) return chain().unsetLink().run();
                            const url = window.prompt('Link URL');
                            if (url) chain().setLink({ href: url }).run();
                        }}
                    />
                </div>
            )}

            {/* Slash menu. */}
            {ready && slash.open && (
                <div
                    className="absolute z-50 w-72 max-h-72 overflow-y-auto bg-white border border-[#ECECEC] rounded-[10px] shadow-[0_6px_24px_rgba(0,0,0,0.12)] py-1.5"
                    style={{ top: slash.top, left: slash.left }}
                    onMouseDown={e => e.preventDefault()}
                >
                    <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-[#A5A5AA]">
                        {slash.query ? `“${slash.query}”` : 'Blocks'}
                    </div>
                    {filtered.length === 0 && (
                        <div className="px-3 py-2 text-[12.5px] text-[#A5A5AA]">No matching block.</div>
                    )}
                    {filtered.map((cmd, i) => (
                        <button
                            key={cmd.id}
                            type="button"
                            onMouseEnter={() => setActive(i)}
                            onClick={() => runCommand(cmd)}
                            className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${i === active ? 'bg-[#EAF3FF]' : 'hover:bg-[#FAFAFA]'}`}
                        >
                            <span className={`w-7 h-7 rounded-[6px] border flex items-center justify-center flex-shrink-0 ${i === active ? 'border-[#0A84FF] text-[#0A84FF]' : 'border-[#ECECEC] text-[#6E6E73]'}`}>
                                <window.Icon name={cmd.icon} size={14} />
                            </span>
                            <span className="min-w-0">
                                <span className="block text-[12.8px] font-semibold text-[#171719] truncate">{cmd.label}</span>
                                <span className="block text-[11px] text-[#A5A5AA] truncate">{cmd.hint}</span>
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
