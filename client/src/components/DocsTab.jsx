const React = window.React;

// NoobieDocs — the GitBook-style documentation page.
//
// This surface owns text documents only. API endpoints live on their own
// Postman-style page, so the only place `type` is inspected here is the filter
// that drops API entries out of the tree.
window.DocsTab = ({ workspaceId, user, onLogActivity }) => {
    const { t } = window.useTranslation();
    const { showConfirm, showPrompt } = window.useModals();
    const { showToast } = window.useToasts();

    const [docs, setDocs] = React.useState([]);
    const [folders, setFolders] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [selectedDocId, setSelectedDocId] = React.useState(null);
    const [selectedFolderId, setSelectedFolderId] = React.useState(null);
    const [expandedFolders, setExpandedFolders] = React.useState({});
    const [query, setQuery] = React.useState('');
    const [isEditing, setIsEditing] = React.useState(false);
    const [showMobileSidebar, setShowMobileSidebar] = React.useState(false);
    const [selectedDocIds, setSelectedDocIds] = React.useState(new Set());
    const [showBulkMove, setShowBulkMove] = React.useState(false);

    const idOf = (o) => (o ? (o.id || o._id) : null);

    React.useEffect(() => {
        setLoading(true);
        Promise.all([
            fetch(`/api/workspaces/${workspaceId}/docs`).then(r => r.ok ? r.json() : []),
            fetch(`/api/workspaces/${workspaceId}/folders`).then(r => r.ok ? r.json() : [])
        ])
            .then(([d, f]) => {
                setDocs(Array.isArray(d) ? d : []);
                setFolders(Array.isArray(f) ? f : []);
            })
            .catch(err => { console.error('Docs load error:', err); })
            .finally(() => setLoading(false));
    }, [workspaceId]);

    // --- Data shaping -----------------------------------------------------
    const textDocs = docs.filter(d => d.type !== 'API');
    const stripHtml = (html) => (html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
    const q = query.trim().toLowerCase();
    const docMatches = (doc) => !q
        || (doc.title || '').toLowerCase().includes(q)
        || stripHtml(doc.content).toLowerCase().includes(q);
    const visibleDocs = textDocs.filter(docMatches);

    // Mirror of ApisTab: a folder belongs to this page because it is declared a
    // DOCS collection, not because of what is inside it. Folders written before
    // the kind migration have no `kind` and fall back to the schema default,
    // which is DOCS — so they keep showing up here exactly as they did.
    const isDocsFolder = (folder) => (folder.kind || 'DOCS') === 'DOCS';

    const rootFolders = folders.filter(f => !f.parentId && isDocsFolder(f));
    const subfoldersOf = (folderId) => folders.filter(f => f.parentId === folderId);
    const docsIn = (folderId) => visibleDocs.filter(d => d.folderId === folderId);
    const rootDocs = visibleDocs.filter(d => !d.folderId);

    // While searching, a folder earns its place in the tree only if it (or one of
    // its subfolders) still holds a match — otherwise the result list is buried
    // under empty folders.
    const folderMatches = (folder) => {
        const folderId = idOf(folder);
        if (!q) return true;
        if ((folder.name || '').toLowerCase().includes(q)) return true;
        if (docsIn(folderId).length > 0) return true;
        return subfoldersOf(folderId).some(sub => docsIn(idOf(sub)).length > 0 || (sub.name || '').toLowerCase().includes(q));
    };

    const activeDoc = selectedDocId ? textDocs.find(d => idOf(d) === selectedDocId) : null;
    const activeFolder = !activeDoc && selectedFolderId ? folders.find(f => idOf(f) === selectedFolderId) : null;
    const activeDocFolder = activeDoc && activeDoc.folderId ? folders.find(f => idOf(f) === activeDoc.folderId) : null;
    const activeDocParent = activeDocFolder && activeDocFolder.parentId ? folders.find(f => idOf(f) === activeDocFolder.parentId) : null;

    // `parentId` is writable through the API, so a chain that loops back on
    // itself (A -> B -> A) is representable in the data. Walking it by recursion
    // never terminates: the stack overflows and takes the whole tab down with a
    // blank screen. Walk iteratively and stop the first time a folder repeats,
    // treating that folder as the root. A dangling parent still yields null,
    // exactly as before.
    const getRootFolder = (folderId) => {
        if (!folderId) return null;
        let current = folders.find(x => idOf(x) === folderId);
        if (!current) return null;
        const seen = new Set([idOf(current)]);
        while (current.parentId) {
            const parent = folders.find(x => idOf(x) === current.parentId);
            if (!parent) return null;
            if (seen.has(idOf(parent))) return current;
            seen.add(idOf(parent));
            current = parent;
        }
        return current;
    };

    // --- Mutations --------------------------------------------------------
    const toggleFolder = (folderId) => setExpandedFolders(prev => ({ ...prev, [folderId]: !prev[folderId] }));

    const addFolder = () => {
        showPrompt(t('actions.new_folder'), t('labels.enter_folder_name'), async (name) => {
            if (!name) return;
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const res = await fetch(`/api/workspaces/${workspaceId}/folders`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, slug })
            });
            if (!res.ok) return showToast(t('alerts.error'), 'error');
            const saved = await res.json();
            const savedId = idOf(saved);
            setFolders(prev => [...prev, { ...saved, id: savedId }]);
            setExpandedFolders(prev => ({ ...prev, [savedId]: true }));
            setSelectedFolderId(savedId);
            setSelectedDocId(null);
            onLogActivity?.('Created folder', 'folder', name);
            showToast(t('alerts.folder_created'));
        });
    };

    const deleteFolder = (folderId) => {
        showConfirm(t('actions.destroy_folder'), t('alerts.confirm_destroy_folder'), async () => {
            const target = folders.find(f => idOf(f) === folderId);
            await fetch(`/api/folders/${folderId}`, { method: 'DELETE' });
            setFolders(prev => prev.filter(f => idOf(f) !== folderId));
            setDocs(prev => prev.map(d => d.folderId === folderId ? { ...d, folderId: null } : d));
            if (selectedFolderId === folderId) setSelectedFolderId(null);
            onLogActivity?.('Deleted folder', 'folder', target?.name);
            showToast(t('alerts.folder_destroyed'));
        });
    };

    const renameFolder = (folderId, name) => {
        setFolders(prev => prev.map(f => idOf(f) === folderId ? { ...f, name } : f));
    };

    const saveFolder = (folderId, patch) => fetch(`/api/folders/${folderId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch)
    });

    // New pages land in whatever the sidebar is currently pointed at, so the
    // document appears where the user was already looking.
    const addDoc = () => {
        const targetFolderId = activeDoc ? (activeDoc.folderId || null) : selectedFolderId;
        showPrompt(t('actions.new_document'), t('labels.enter_title'), async (title) => {
            if (!title) return;
            const res = await fetch(`/api/workspaces/${workspaceId}/docs`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, type: 'TEXT', content: '', folderId: targetFolderId })
            });
            if (!res.ok) return showToast(t('alerts.error'), 'error');
            const saved = await res.json();
            const savedId = idOf(saved);
            setDocs(prev => [...prev, { ...saved, id: savedId }]);
            setSelectedDocId(savedId);
            setIsEditing(true);
            if (targetFolderId) setExpandedFolders(prev => ({ ...prev, [targetFolderId]: true }));
            onLogActivity?.('Created document', 'doc', title);
            showToast(t('alerts.document_initialized'));
        });
    };

    // --- Import .md / .docx -----------------------------------------------
    const importInputRef = React.useRef(null);
    const [importing, setImporting] = React.useState(null);

    // Mammoth is ~600 KB and only matters to someone importing a Word file, so
    // it is fetched on first use instead of on every page load.
    const loadMammoth = () => {
        if (window.mammoth) return Promise.resolve(window.mammoth);
        if (!window.__mammothLoading) {
            window.__mammothLoading = new Promise((resolve, reject) => {
                const tag = document.createElement('script');
                tag.src = 'https://unpkg.com/mammoth@1.12.0/mammoth.browser.min.js';
                tag.onload = () => resolve(window.mammoth);
                tag.onerror = () => reject(new Error('Could not load the .docx converter.'));
                document.head.appendChild(tag);
            });
        }
        return window.__mammothLoading;
    };

    const uploadDataUri = async (dataUri, name) => {
        const blob = await (await fetch(dataUri)).blob();
        const form = new FormData();
        form.append('file', blob, name);
        const res = await fetch('/api/upload?category=doc_media', { method: 'POST', body: form });
        if (!res.ok) throw new Error('Image upload failed.');
        const { path } = await res.json();
        return window.getImageUrl(path);
    };

    // Word files carry their images inline. Storing them as data URIs would bloat
    // every document read, so each one is uploaded and replaced with its URL.
    const docxToHtml = async (file) => {
        const mammoth = await loadMammoth();
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.convertToHtml(
            { arrayBuffer },
            {
                convertImage: mammoth.images.imgElement(async (image) => {
                    const base64 = await image.read('base64');
                    const src = await uploadDataUri(`data:${image.contentType};base64,${base64}`, `docx-image.${(image.contentType || 'image/png').split('/')[1]}`);
                    return { src };
                })
            }
        );
        return result.value;
    };

    // The first heading is the document's real title far more often than the
    // filename is, so it is promoted and removed from the body.
    const splitTitle = (html, fallback) => {
        const probe = document.createElement('div');
        probe.innerHTML = html;
        const first = probe.firstElementChild;
        if (first && /^H[12]$/.test(first.tagName) && first.textContent.trim()) {
            const title = first.textContent.trim();
            first.remove();
            return { title, html: probe.innerHTML };
        }
        return { title: fallback, html };
    };

    const importFiles = async (fileList) => {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        const targetFolderId = activeDoc ? (activeDoc.folderId || null) : selectedFolderId;
        let lastId = null;
        let failures = 0;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            setImporting({ name: file.name, index: i + 1, total: files.length });
            try {
                const base = file.name.replace(/\.[^.]+$/, '');
                const isDocx = /\.docx$/i.test(file.name);
                const raw = isDocx ? await docxToHtml(file) : window.markdownToHtml(await file.text());
                const { title, html } = splitTitle(raw, base);

                const res = await fetch(`/api/workspaces/${workspaceId}/docs`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title, type: 'TEXT', content: html, folderId: targetFolderId })
                });
                if (!res.ok) throw new Error('Save failed.');
                const saved = await res.json();
                const savedId = idOf(saved);
                setDocs(prev => [...prev, { ...saved, id: savedId }]);
                lastId = savedId;
                onLogActivity?.('Imported document', 'doc', title);
            } catch (err) {
                console.error('Import failed for', file.name, err);
                failures += 1;
                showToast(`${file.name}: ${err.message}`, 'error');
            }
        }

        setImporting(null);
        if (targetFolderId) setExpandedFolders(prev => ({ ...prev, [targetFolderId]: true }));
        if (lastId) {
            setSelectedDocId(lastId);
            setIsEditing(false);
            const ok = files.length - failures;
            showToast(t('alerts.docs_imported', { count: ok }) || `${ok} document(s) imported.`);
        }
    };

    // --- Export a folder as a .md zip ---------------------------------------
    const [exporting, setExporting] = React.useState(false);

    const loadJSZip = () => {
        if (window.JSZip) return Promise.resolve(window.JSZip);
        if (!window.__jszipLoading) {
            window.__jszipLoading = new Promise((resolve, reject) => {
                const tag = document.createElement('script');
                tag.src = 'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js';
                tag.onload = () => resolve(window.JSZip);
                tag.onerror = () => reject(new Error('Could not load the zip builder.'));
                document.head.appendChild(tag);
            });
        }
        return window.__jszipLoading;
    };

    const slugify = (name) => (String(name || '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60)) || 'untitled';

    // A folder becomes a directory, each document a file. The title is written
    // back as a leading `# heading`, which is exactly what the importer promotes
    // to a title — so an exported zip re-imports with its names intact.
    const buildEntries = (folder) => {
        const entries = [];
        const walk = (prefix, current) => {
            if (current) {
                const readme = window.htmlToMarkdown(current.description || '').trim();
                if (readme) entries.push({ path: `${prefix}README.md`, text: `# ${current.name}\n\n${readme}\n` });
            }
            const used = new Set();
            // Export the real contents, never the search-filtered view.
            const list = current
                ? textDocs.filter(d => d.folderId === idOf(current))
                : textDocs.filter(d => !d.folderId);
            list.forEach(doc => {
                const base = slugify(doc.title);
                let name = base;
                let n = 2;
                while (used.has(name)) name = `${base}-${n++}`;
                used.add(name);
                const body = window.htmlToMarkdown(doc.content || '').trim();
                entries.push({
                    path: `${prefix}${name}.md`,
                    text: `# ${doc.title || t('labels.untitled')}\n\n${body}\n`
                });
            });
            const subs = current ? subfoldersOf(idOf(current)) : rootFolders;
            subs.forEach(sub => walk(`${prefix}${slugify(sub.name)}/`, sub));
        };
        walk('', folder);
        return entries;
    };

    const downloadBlob = (blob, filename) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };

    // The folder currently in context: the one selected in the sidebar, or the
    // one holding the open document. Root documents belong to no folder, so
    // there is nothing to export in that case and the button stays disabled.
    const exportScope = activeFolder
        || (activeDoc && activeDoc.folderId ? folders.find(f => idOf(f) === activeDoc.folderId) : null)
        || (selectedFolderId ? folders.find(f => idOf(f) === selectedFolderId) : null)
        || null;

    const exportFolder = async () => {
        if (!exportScope) return showToast(t('alerts.select_folder_to_export'), 'error');
        const entries = buildEntries(exportScope);
        if (!entries.length) return showToast(t('alerts.nothing_to_export'), 'error');

        setExporting(true);
        try {
            const JSZip = await loadJSZip();
            const zip = new JSZip();
            entries.forEach(e => zip.file(e.path, e.text));
            const blob = await zip.generateAsync({ type: 'blob' });
            downloadBlob(blob, `${slugify(exportScope.name)}.zip`);
            onLogActivity?.('Exported folder', 'folder', exportScope.name);
            showToast(t('alerts.docs_exported', { count: entries.length }));
        } catch (err) {
            console.error('Export failed:', err);
            showToast(err.message, 'error');
        } finally {
            setExporting(false);
        }
    };

    // Single document, straight to a .md file — no zip involved.
    const exportDoc = (doc) => {
        if (!doc) return;
        const body = window.htmlToMarkdown(doc.content || '').trim();
        const text = `# ${doc.title || t('labels.untitled')}\n\n${body}\n`;
        downloadBlob(new Blob([text], { type: 'text/markdown;charset=utf-8' }), `${slugify(doc.title)}.md`);
        onLogActivity?.('Exported document', 'doc', doc.title);
    };

    const updateDoc = async (docId, patch) => {
        if (!docId) return;
        setDocs(prev => prev.map(d => idOf(d) === docId ? { ...d, ...patch } : d));
        await fetch(`/api/docs/${docId}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch)
        });
    };

    const deleteDoc = (docId) => {
        showConfirm(t('actions.destroy_document'), t('alerts.confirm_destroy_document'), async () => {
            const target = docs.find(d => idOf(d) === docId);
            await fetch(`/api/docs/${docId}`, { method: 'DELETE' });
            setDocs(prev => prev.filter(d => idOf(d) !== docId));
            if (selectedDocId === docId) setSelectedDocId(null);
            onLogActivity?.('Deleted document', 'doc', target?.title);
            showToast(t('alerts.document_destroyed'));
        });
    };

    const moveToFolder = async (docId, folderId) => {
        const doc = docs.find(d => idOf(d) === docId);
        const folderName = folderId ? folders.find(f => idOf(f) === folderId)?.name : null;
        setDocs(prev => prev.map(d => idOf(d) === docId ? { ...d, folderId } : d));
        await fetch(`/api/docs/${docId}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId })
        });
        onLogActivity?.(
            folderName ? `Moved document to folder "${folderName}"` : 'Moved document out of folder',
            'doc',
            doc?.title
        );
        showToast(t('alerts.document_moved'));
    };

    // Public docs are scoped to a root folder, so a single document is reached
    // through a ?doc= deep link on that folder's page.
    const publicUrlFor = (doc) => {
        const root = getRootFolder(doc?.folderId);
        if (!root) return null;
        return `${window.location.origin}/docs/${workspaceId}/${root.slug || idOf(root)}?doc=${idOf(doc)}`;
    };

    const copyDocLink = async (doc) => {
        const link = publicUrlFor(doc);
        if (!link) return showToast(t('alerts.move_to_folder_to_share'));
        const ok = await window.copyText(link);
        showToast(ok ? t('alerts.copied_to_clipboard') : t('alerts.copy_failed'), ok ? 'success' : 'error');
    };

    const openPublicPage = (doc) => {
        const link = publicUrlFor(doc);
        if (!link) return showToast(t('alerts.move_to_folder_to_share'));
        window.open(link, '_blank');
    };

    const toggleDocPassword = (doc) => {
        const docId = idOf(doc);
        if (doc.passwordProtected) {
            showConfirm(t('actions.remove_password'), t('alerts.remove_password_confirm'), async () => {
                setDocs(prev => prev.map(d => idOf(d) === docId ? { ...d, passwordProtected: false } : d));
                await fetch(`/api/docs/${docId}`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: '' })
                });
                showToast(t('alerts.password_removed'));
            });
        } else {
            showPrompt(t('actions.protect_document'), t('alerts.set_password_prompt'), async (pw) => {
                if (!pw) return;
                setDocs(prev => prev.map(d => idOf(d) === docId ? { ...d, passwordProtected: true } : d));
                await fetch(`/api/docs/${docId}`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw })
                });
                showToast(t('alerts.password_set'));
            }, true);
        }
    };

    const toggleDocSelection = (docId, e) => {
        e.stopPropagation();
        setSelectedDocIds(prev => {
            const next = new Set(prev);
            if (next.has(docId)) next.delete(docId); else next.add(docId);
            return next;
        });
    };

    const bulkDelete = () => {
        if (selectedDocIds.size === 0) return;
        showConfirm(t('actions.bulk_erase'), t('alerts.bulk_erase_confirm', { count: selectedDocIds.size }), async () => {
            const arr = Array.from(selectedDocIds);
            const targets = docs.filter(d => arr.includes(idOf(d)));
            await fetch('/api/docs/bulk', {
                method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docIds: arr })
            });
            setDocs(prev => prev.filter(d => !arr.includes(idOf(d))));
            if (selectedDocId && arr.includes(selectedDocId)) setSelectedDocId(null);
            setSelectedDocIds(new Set());
            targets.forEach(doc => onLogActivity?.('Deleted document', 'doc', doc.title));
            showToast(t('alerts.docs_erased', { count: arr.length }));
        });
    };

    // `docIds` lets a drag drop move exactly what was dragged; the bulk bar
    // omits it and moves the current checkbox selection instead.
    const bulkMove = async (targetFolderId, docIds) => {
        const arr = docIds || Array.from(selectedDocIds);
        if (arr.length === 0) return;
        const targets = docs.filter(d => arr.includes(idOf(d)));
        const folderName = targetFolderId ? folders.find(f => idOf(f) === targetFolderId)?.name : null;
        await fetch('/api/docs/bulk-move', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ docIds: arr, folderId: targetFolderId })
        });
        setDocs(prev => prev.map(d => arr.includes(idOf(d)) ? { ...d, folderId: targetFolderId } : d));
        targets.forEach(doc => onLogActivity?.(
            folderName ? `Moved document to folder "${folderName}"` : 'Moved document out of folder', 'doc', doc.title
        ));
        setSelectedDocIds(new Set());
        setShowBulkMove(false);
        showToast(t('alerts.docs_moved', { count: arr.length }));
    };

    // --- Reading-view decorations ----------------------------------------
    // Copy buttons and table scroll boxes are grafted onto the rendered HTML
    // after each paint rather than baked into the stored content, so the public
    // page and this one stay identical — see window.enhanceDocContent.
    const previewRef = React.useRef(null);
    const previewHtml = activeDoc ? (activeDoc.content || '') : (activeFolder ? (activeFolder.description || '') : '');
    React.useEffect(() => {
        if (isEditing) return;
        window.enhanceDocContent(previewRef.current, {
            copy: t('actions.copy') || 'Copy',
            copied: t('actions.copied') || 'Copied',
        });
    }, [previewHtml, isEditing, selectedDocId, selectedFolderId]);

    // --- Drag documents between folders ------------------------------------
    // Native HTML5 drag rather than the board's react-beautiful-dnd: the drop
    // targets here are folder rows, including collapsed ones and nested
    // subfolders, which a list-oriented library does not model.
    const dragIdsRef = React.useRef([]);
    const expandTimerRef = React.useRef(null);
    const [dragging, setDragging] = React.useState(false);
    const [dropTarget, setDropTarget] = React.useState(null); // folder id, or 'root'

    const clearDrag = () => {
        if (expandTimerRef.current) { clearTimeout(expandTimerRef.current); expandTimerRef.current = null; }
        dragIdsRef.current = [];
        setDragging(false);
        setDropTarget(null);
    };

    // A drag that ends outside the sidebar — dropped on the page, cancelled with
    // Escape, or released over a non-zone — never reaches the row's own dragend,
    // which would leave the row faded and the root zone stuck open.
    React.useEffect(() => {
        const reset = () => { if (dragIdsRef.current.length) clearDrag(); };
        window.addEventListener('dragend', reset);
        window.addEventListener('drop', reset);
        return () => {
            window.removeEventListener('dragend', reset);
            window.removeEventListener('drop', reset);
        };
    }, []);

    const onDocDragStart = (e, docId) => {
        // Dragging a checked row carries the whole selection; dragging any
        // other row moves just that document.
        const ids = selectedDocIds.has(docId) && selectedDocIds.size > 1
            ? Array.from(selectedDocIds)
            : [docId];
        dragIdsRef.current = ids;
        setDragging(true);
        e.dataTransfer.effectAllowed = 'move';
        // Firefox refuses to start a drag without payload on the transfer.
        e.dataTransfer.setData('text/plain', ids.join(','));
    };

    // `targetId` is a folder id, or null for the root level.
    const onDropZoneOver = (e, targetId, key) => {
        if (!dragIdsRef.current.length) return;
        e.preventDefault();
        // Zones nest (a subfolder sits inside its parent's block). dragover
        // bubbles, so without this the outer zone would claim the drop.
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        if (dropTarget === key) return;
        setDropTarget(key);
        // Hovering a collapsed folder opens it, so a document can be dropped
        // straight onto a subfolder without a separate click.
        if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
        if (targetId && !expandedFolders[targetId]) {
            expandTimerRef.current = setTimeout(() => {
                setExpandedFolders(prev => ({ ...prev, [targetId]: true }));
            }, 600);
        }
    };

    // dragleave also fires when the cursor crosses into a child element, which
    // would make the highlight flicker; relatedTarget tells the two apart.
    const onDropZoneLeave = (e, key) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        setDropTarget(prev => (prev === key ? null : prev));
    };

    const onDropZoneDrop = (e, targetId) => {
        e.preventDefault();
        e.stopPropagation();
        const ids = dragIdsRef.current;
        clearDrag();
        const moving = ids.filter(id => {
            const doc = docs.find(d => idOf(d) === id);
            return doc && (doc.folderId || null) !== (targetId || null);
        });
        if (!moving.length) return;
        if (moving.length === 1) moveToFolder(moving[0], targetId);
        else bulkMove(targetId, moving);
        if (targetId) setExpandedFolders(prev => ({ ...prev, [targetId]: true }));
        setSelectedDocIds(new Set());
    };

    const dropRing = 'ring-2 ring-[#0A84FF] ring-inset bg-[#EAF3FF]';

    // --- Render helpers ---------------------------------------------------
    const rowBase = 'flex items-center gap-1.5 px-2 py-1.5 rounded-[7px] text-[12.8px] cursor-pointer select-none transition-colors group';
    const rowIdle = 'text-[#171719] hover:bg-[#F0F0F2]';
    const rowActive = 'bg-[#EAF3FF] text-[#0670DE] font-semibold';
    const iconBtn = 'p-1 rounded text-[#A5A5AA] hover:text-[#0A84FF] transition-colors';

    // Plain render functions, not components. Declaring a component inside the
    // render body gives it a new identity on every state change, so React
    // unmounts and remounts the whole tree — which, mid-drag, destroys the
    // element being dragged and cancels the drag outright.
    const renderDocRow = (doc, depth = 0) => {
        const docId = idOf(doc);
        const isActive = selectedDocId === docId;
        const isChecked = selectedDocIds.has(docId);
        const anySelected = selectedDocIds.size > 0;
        const isDragged = dragging && dragIdsRef.current.includes(docId);
        return (
            <div
                key={docId}
                draggable
                onDragStart={(e) => onDocDragStart(e, docId)}
                onDragEnd={clearDrag}
                onClick={(e) => {
                    if (anySelected) return toggleDocSelection(docId, e);
                    setSelectedDocId(docId);
                    setSelectedFolderId(doc.folderId || null);
                    setIsEditing(false);
                    setShowMobileSidebar(false);
                }}
                className={`${rowBase} ${isDragged ? 'opacity-40' : ''} ${isActive ? rowActive : isChecked ? 'bg-[#EEF2FF] text-[#171719]' : rowIdle}`}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
            >
                <span
                    onClick={(e) => toggleDocSelection(docId, e)}
                    className={`w-3.5 h-3.5 rounded-[4px] border flex items-center justify-center flex-shrink-0 transition ${isChecked ? 'bg-[#0A84FF] border-[#0A84FF] text-white' : 'border-[#DEDEDE] opacity-0 group-hover:opacity-100'}`}
                >
                    {isChecked && <window.Icon name="check" size={9} />}
                </span>
                <window.Icon name="file-text" size={15} className={isActive ? 'text-[#0A84FF]' : 'text-[#A5A5AA]'} />
                <span className="flex-1 truncate">{doc.title || t('labels.untitled')}</span>
                {doc.passwordProtected && <window.Icon name="lock" size={11} className="text-[#A5A5AA] flex-shrink-0" />}
                <span className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                    <button onClick={(e) => { e.stopPropagation(); copyDocLink(doc); }} className={iconBtn} title={t('actions.copy_link')}>
                        <window.Icon name="link" size={12} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); deleteDoc(docId); }} className="p-1 rounded text-[#A5A5AA] hover:text-[#E5484D] transition-colors" title={t('actions.destroy_document')}>
                        <window.Icon name="trash-2" size={12} />
                    </button>
                </span>
            </div>
        );
    };

    // `ancestors` carries the folders already on the path from the root. A
    // parentId loop would otherwise recurse forever here too, the same way it
    // did in getRootFolder — this time inside React's render.
    const renderFolderRow = (folder, depth = 0, ancestors = []) => {
        const folderId = idOf(folder);
        if (ancestors.includes(folderId)) return null;
        const isExpanded = !!expandedFolders[folderId] || !!q;
        const isActive = !selectedDocId && selectedFolderId === folderId;
        const subs = subfoldersOf(folderId).filter(folderMatches);
        const own = docsIn(folderId);
        const isDropTarget = dropTarget === `folder:${folderId}`;
        return (
            // The whole block is the drop zone, so a document can be dropped on
            // the folder's row or anywhere in its open contents.
            <div
                key={folderId}
                className={`mb-0.5 rounded-[7px] ${isDropTarget ? 'bg-[#EAF3FF]' : ''}`}
                onDragOver={(e) => onDropZoneOver(e, folderId, `folder:${folderId}`)}
                onDragLeave={(e) => onDropZoneLeave(e, `folder:${folderId}`)}
                onDrop={(e) => onDropZoneDrop(e, folderId)}
            >
                <div
                    onClick={() => {
                        toggleFolder(folderId);
                        setSelectedFolderId(folderId);
                        setSelectedDocId(null);
                        setIsEditing(false);
                    }}
                    className={`${rowBase} ${isDropTarget ? dropRing : isActive ? rowActive : rowIdle}`}
                    style={{ paddingLeft: `${8 + depth * 14}px` }}
                >
                    <window.Icon
                        name="chevron-right"
                        size={12}
                        className={`text-[#A5A5AA] flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    />
                    <window.Icon name={isExpanded ? 'folder-open' : 'folder'} size={15} className="text-[#9AA0A6] flex-shrink-0" />
                    <span className="flex-1 truncate">{folder.name}</span>
                    <span className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                        <button
                            onClick={(e) => { e.stopPropagation(); window.open(`/docs/${workspaceId}/${folder.slug || folderId}`, '_blank'); }}
                            className={iconBtn}
                            title={t('actions.open_public_page')}
                        >
                            <window.Icon name="external-link" size={12} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); deleteFolder(folderId); }} className="p-1 rounded text-[#A5A5AA] hover:text-[#E5484D] transition-colors" title={t('actions.destroy_folder')}>
                            <window.Icon name="trash-2" size={12} />
                        </button>
                    </span>
                </div>
                {isExpanded && (
                    <div>
                        {subs.map(sub => renderFolderRow(sub, depth + 1, [...ancestors, folderId]))}
                        {own.map(doc => renderDocRow(doc, depth + 1))}
                        {subs.length === 0 && own.length === 0 && (
                            <div className="text-[11px] text-[#A5A5AA] italic py-1" style={{ paddingLeft: `${22 + depth * 14}px` }}>
                                {t('labels.empty')}
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    if (loading) {
        return <div className="p-10 text-center text-[#6E6E73] animate-pulse">{t('labels.loading_documentation')}</div>;
    }

    const visibleRootFolders = rootFolders.filter(folderMatches);
    const nothingToShow = visibleRootFolders.length === 0 && rootDocs.length === 0;

    return (
        <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-white text-[#171719] animate-fade-in">
            {/* Sidebar */}
            <aside className={`${showMobileSidebar ? 'fixed inset-0 z-50 flex w-full' : 'hidden'} md:flex md:w-[272px] md:flex-shrink-0 bg-[#FAFAFA] border-r border-[#ECECEC] flex-col min-h-0`}>
                <div className="px-3.5 pt-3.5 pb-2.5 flex flex-col gap-2.5">
                    <div className="flex items-start justify-between">
                        <div>
                            <div className="text-[13px] font-bold leading-tight">{t('labels.documentation')}</div>
                            <div className="font-mono text-[11px] text-[#A5A5AA] mt-0.5">
                                {t('labels.docs_short')} · {textDocs.length} {textDocs.length === 1 ? t('labels.document') : t('labels.documents')}
                            </div>
                        </div>
                        {showMobileSidebar && (
                            <button onClick={() => setShowMobileSidebar(false)} className="md:hidden p-1.5 text-[#6E6E73] hover:bg-[#F0F0F2] rounded-md">
                                <window.Icon name="x" size={18} />
                            </button>
                        )}
                    </div>
                    <div className="flex gap-1.5">
                        <button
                            onClick={addFolder}
                            className="flex-1 flex items-center justify-center gap-1.5 border border-[#DEDEDE] bg-white rounded-[6px] px-2.5 py-[7px] text-[12.5px] font-semibold hover:border-[#0A84FF] hover:bg-[#EAF3FF] hover:text-[#0670DE] transition-colors"
                        >
                            <window.Icon name="plus" size={14} /> {t('actions.new_folder')}
                        </button>
                        <button
                            onClick={() => importInputRef.current && importInputRef.current.click()}
                            disabled={!!importing}
                            className="flex items-center justify-center border border-[#DEDEDE] bg-white rounded-[6px] px-2.5 py-[7px] text-[#6E6E73] hover:border-[#0A84FF] hover:text-[#0A84FF] transition-colors disabled:opacity-50"
                            title={t('actions.import_documents')}
                        >
                            <window.Icon name={importing ? 'loader' : 'upload'} size={14} className={importing ? 'animate-spin' : ''} />
                        </button>
                        <button
                            onClick={exportFolder}
                            disabled={exporting || !exportScope}
                            className="flex items-center justify-center border border-[#DEDEDE] bg-white rounded-[6px] px-2.5 py-[7px] text-[#6E6E73] hover:border-[#0A84FF] hover:text-[#0A84FF] transition-colors disabled:opacity-40 disabled:hover:border-[#DEDEDE] disabled:hover:text-[#6E6E73]"
                            title={exportScope ? `${t('actions.export_folder')}: ${exportScope.name}` : t('alerts.select_folder_to_export')}
                        >
                            <window.Icon name={exporting ? 'loader' : 'download'} size={14} className={exporting ? 'animate-spin' : ''} />
                        </button>
                        <button
                            onClick={addDoc}
                            className="flex items-center justify-center gap-1.5 bg-[#0A84FF] border border-[#0A84FF] text-white rounded-[6px] px-2.5 py-[7px] text-[12.5px] font-semibold hover:bg-[#0670DE] transition-colors"
                            title={t('actions.new_document')}
                        >
                            <window.Icon name="file-plus" size={14} />
                        </button>
                        <input
                            ref={importInputRef}
                            type="file"
                            multiple
                            accept=".md,.markdown,.txt,.docx"
                            className="hidden"
                            onChange={e => { importFiles(e.target.files); e.target.value = ''; }}
                        />
                    </div>
                    {importing && (
                        <div className="flex items-center gap-2 text-[11.5px] text-[#6E6E73] bg-white border border-[#ECECEC] rounded-[6px] px-2.5 py-1.5">
                            <window.Icon name="loader" size={12} className="animate-spin flex-shrink-0" />
                            <span className="truncate">
                                {t('labels.importing')} {importing.index}/{importing.total} · {importing.name}
                            </span>
                        </div>
                    )}
                </div>

                <div className="mx-3.5 mb-1.5 flex items-center gap-[7px] bg-white border border-[#ECECEC] rounded-[6px] px-2.5 py-1.5">
                    <window.Icon name="search" size={14} className="text-[#A5A5AA] flex-shrink-0" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder={t('labels.search_docs')}
                        className="w-full bg-transparent border-none outline-none text-[12.5px] placeholder:text-[#A5A5AA]"
                    />
                    {query && (
                        <button onClick={() => setQuery('')} className="text-[#A5A5AA] hover:text-[#171719]">
                            <window.Icon name="x" size={12} />
                        </button>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto px-2 pb-4 pt-0.5">
                    {visibleRootFolders.map(folder => renderFolderRow(folder))}

                    {/* Root level. Stays mounted during a drag even when empty,
                        so a document inside a folder has somewhere to go back to. */}
                    {(rootDocs.length > 0 || dragging) && (
                        <div
                            onDragOver={(e) => onDropZoneOver(e, null, 'root')}
                            onDragLeave={(e) => onDropZoneLeave(e, 'root')}
                            onDrop={(e) => onDropZoneDrop(e, null)}
                            className={`mt-3 pt-3 border-t border-[#ECECEC] rounded-[7px] ${dropTarget === 'root' ? dropRing : ''}`}
                        >
                            <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#A5A5AA] px-2 pb-1.5">
                                {t('labels.root_documents')}
                            </p>
                            {rootDocs.map(doc => renderDocRow(doc))}
                            {rootDocs.length === 0 && (
                                <p className="text-[11px] text-[#A5A5AA] italic px-2 pb-2">
                                    {t('labels.drop_here_to_move_out') || 'Drop here to move out of a folder'}
                                </p>
                            )}
                        </div>
                    )}

                    {nothingToShow && (
                        <p className="text-[12px] text-[#A5A5AA] italic text-center px-4 mt-8 leading-relaxed">
                            {q ? t('labels.no_results') : t('labels.no_documentation_found')}
                        </p>
                    )}
                </div>
            </aside>

            {/* Bulk action bar */}
            {selectedDocIds.size > 0 && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur shadow-[0_6px_24px_rgba(0,0,0,0.12)] border border-[#DEDEDE] rounded-full px-5 py-2.5 flex items-center gap-3 z-[2000] animate-fade-in">
                    <span className="text-[12px] font-bold">{t('labels.selected_count', { count: selectedDocIds.size })}</span>
                    <div className="h-4 w-px bg-[#ECECEC]" />
                    <div className="relative">
                        <button onClick={() => setShowBulkMove(!showBulkMove)} className="flex items-center gap-1.5 text-[#0A84FF] hover:bg-[#EAF3FF] px-2.5 py-1.5 rounded-md text-[12px] font-semibold transition-colors">
                            <window.Icon name="folder-input" size={14} /> {t('actions.move_selected')}
                        </button>
                        {showBulkMove && (
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 max-h-64 overflow-y-auto bg-white border border-[#ECECEC] shadow-[0_6px_24px_rgba(0,0,0,0.08)] rounded-xl py-1">
                                <button onClick={() => bulkMove(null)} className="w-full text-left px-3.5 py-2 text-[12px] font-semibold text-[#6E6E73] hover:bg-[#FAFAFA] flex items-center gap-2 border-b border-[#ECECEC]">
                                    <window.Icon name="log-out" size={13} /> {t('labels.root')}
                                </button>
                                {/* Docs folders only. An API collection is not listed
                                    here: this tab does not render API-kind folders, and
                                    the API tab renders only API endpoints, so a document
                                    moved into one would disappear from both. */}
                                {folders.filter(isDocsFolder).map(f => (
                                    <button key={idOf(f)} onClick={() => bulkMove(idOf(f))} className="w-full text-left px-3.5 py-2 text-[12px] font-semibold text-[#6E6E73] hover:bg-[#FAFAFA] flex items-center gap-2">
                                        <window.Icon name="folder" size={13} /> {f.name}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <button onClick={bulkDelete} className="flex items-center gap-1.5 text-[#E5484D] hover:bg-[#FDEDEE] px-2.5 py-1.5 rounded-md text-[12px] font-semibold transition-colors">
                        <window.Icon name="trash-2" size={14} /> {t('actions.delete_selected')}
                    </button>
                    <div className="h-4 w-px bg-[#ECECEC]" />
                    <button onClick={() => { setSelectedDocIds(new Set()); setShowBulkMove(false); }} className="text-[#A5A5AA] hover:bg-[#F0F0F2] p-1.5 rounded-full transition-colors">
                        <window.Icon name="x" size={15} />
                    </button>
                </div>
            )}

            {/* Main content */}
            <main className="flex-1 flex flex-col min-w-0 bg-white">
                {activeDoc ? (
                    <React.Fragment>
                        <div className="flex items-start justify-between gap-4 px-5 md:px-8 py-4 border-b border-[#ECECEC] flex-shrink-0">
                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5 text-[12px] text-[#A5A5AA] mb-1.5 flex-wrap">
                                    <button onClick={() => setShowMobileSidebar(true)} className="md:hidden text-[#6E6E73] mr-1">
                                        <window.Icon name="menu" size={16} />
                                    </button>
                                    {activeDocParent && (
                                        <React.Fragment>
                                            <button onClick={() => { setSelectedDocId(null); setSelectedFolderId(idOf(activeDocParent)); }} className="hover:text-[#0A84FF] transition-colors">{activeDocParent.name}</button>
                                            <window.Icon name="chevron-right" size={10} />
                                        </React.Fragment>
                                    )}
                                    {activeDocFolder && (
                                        <React.Fragment>
                                            <button onClick={() => { setSelectedDocId(null); setSelectedFolderId(idOf(activeDocFolder)); }} className="hover:text-[#0A84FF] transition-colors">{activeDocFolder.name}</button>
                                            <window.Icon name="chevron-right" size={10} />
                                        </React.Fragment>
                                    )}
                                    <span className="truncate">{activeDoc.title || t('labels.untitled')}</span>
                                </div>
                                {isEditing ? (
                                    <input
                                        value={activeDoc.title || ''}
                                        onChange={e => updateDoc(idOf(activeDoc), { title: e.target.value })}
                                        className="text-[20px] font-extrabold tracking-[-0.01em] bg-transparent outline-none border-b border-dashed border-[#DEDEDE] focus:border-[#0A84FF] w-full max-w-md"
                                    />
                                ) : (
                                    <h1 className="text-[20px] font-extrabold tracking-[-0.01em] truncate">{activeDoc.title || t('labels.untitled')}</h1>
                                )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                <button
                                    onClick={() => toggleDocPassword(activeDoc)}
                                    className={`border rounded-[6px] p-[7px] transition-colors ${activeDoc.passwordProtected ? 'border-[#0A84FF] text-[#0A84FF] bg-[#EAF3FF]' : 'border-[#DEDEDE] text-[#6E6E73] hover:border-[#0A84FF]'}`}
                                    title={activeDoc.passwordProtected ? t('actions.remove_password') : t('actions.protect_document')}
                                >
                                    <window.Icon name={activeDoc.passwordProtected ? 'lock' : 'lock-open'} size={13} />
                                </button>
                                <button onClick={() => copyDocLink(activeDoc)} className="border border-[#DEDEDE] rounded-[6px] p-[7px] text-[#6E6E73] hover:border-[#0A84FF] transition-colors" title={t('actions.copy_link')}>
                                    <window.Icon name="link" size={13} />
                                </button>
                                <button onClick={() => exportDoc(activeDoc)} className="border border-[#DEDEDE] rounded-[6px] p-[7px] text-[#6E6E73] hover:border-[#0A84FF] transition-colors" title={t('actions.export_markdown')}>
                                    <window.Icon name="download" size={13} />
                                </button>
                                <button
                                    onClick={() => setIsEditing(!isEditing)}
                                    className={`flex items-center gap-1.5 border rounded-[6px] px-3 py-[7px] text-[12.5px] font-semibold transition-colors ${isEditing ? 'border-[#0A84FF] bg-[#EAF3FF] text-[#0670DE]' : 'border-[#DEDEDE] hover:border-[#0A84FF]'}`}
                                >
                                    <window.Icon name={isEditing ? 'check' : 'pencil'} size={13} />
                                    <span className="hidden sm:inline">{isEditing ? t('actions.done_editing') : t('actions.edit_document')}</span>
                                </button>
                                <button
                                    onClick={() => openPublicPage(activeDoc)}
                                    className="flex items-center gap-1.5 bg-[#0A84FF] border border-[#0A84FF] text-white rounded-[6px] px-3 py-[7px] text-[12.5px] font-semibold hover:bg-[#0670DE] transition-colors"
                                >
                                    <window.Icon name="globe" size={13} />
                                    <span className="hidden sm:inline">{t('actions.open_public_page')}</span>
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto">
                            {isEditing ? (
                                <div className="max-w-[720px] mx-auto px-5 md:px-8 py-7 pb-20">
                                    <window.NotionEditor
                                        key={idOf(activeDoc)}
                                        initialContent={activeDoc.content}
                                        editable={true}
                                        onChange={(html) => updateDoc(idOf(activeDoc), { content: html })}
                                    />
                                </div>
                            ) : stripHtml(activeDoc.content).trim() ? (
                                <div ref={previewRef} className="nd-doc-body readme-preview ql-editor max-w-[680px] mx-auto px-5 md:px-8 py-7 pb-20" dangerouslySetInnerHTML={{ __html: window.sanitizeHtml(activeDoc.content) }} />
                            ) : (
                                <div className="max-w-[680px] mx-auto px-5 md:px-8 py-16 text-center">
                                    <div className="w-14 h-14 rounded-xl bg-[#FAFAFA] border border-dashed border-[#DEDEDE] flex items-center justify-center mx-auto mb-4">
                                        <window.Icon name="file-text" size={22} className="text-[#A5A5AA]" />
                                    </div>
                                    <p className="text-[13px] font-semibold text-[#6E6E73]">{t('labels.no_content_yet')}</p>
                                    <p className="text-[12.5px] text-[#A5A5AA] mt-1.5">{t('labels.document_empty_hint')}</p>
                                    <button onClick={() => setIsEditing(true)} className="mt-5 inline-flex items-center gap-1.5 bg-[#0A84FF] text-white rounded-[6px] px-3.5 py-2 text-[12.5px] font-semibold hover:bg-[#0670DE] transition-colors">
                                        <window.Icon name="pencil" size={13} /> {t('actions.edit_document')}
                                    </button>
                                </div>
                            )}
                        </div>
                    </React.Fragment>
                ) : activeFolder ? (
                    <React.Fragment>
                        <div className="flex items-start justify-between gap-4 px-5 md:px-8 py-4 border-b border-[#ECECEC] flex-shrink-0">
                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5 text-[12px] text-[#A5A5AA] mb-1.5">
                                    <button onClick={() => setShowMobileSidebar(true)} className="md:hidden text-[#6E6E73] mr-1">
                                        <window.Icon name="menu" size={16} />
                                    </button>
                                    <span>{t('labels.folder_overview')}</span>
                                </div>
                                <input
                                    value={activeFolder.name || ''}
                                    onChange={e => renameFolder(idOf(activeFolder), e.target.value)}
                                    onBlur={() => saveFolder(idOf(activeFolder), { name: activeFolder.name })}
                                    className="text-[20px] font-extrabold tracking-[-0.01em] bg-transparent outline-none border-b border-dashed border-transparent hover:border-[#DEDEDE] focus:border-[#0A84FF] w-full max-w-md"
                                />
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                <button
                                    onClick={() => setIsEditing(!isEditing)}
                                    className={`flex items-center gap-1.5 border rounded-[6px] px-3 py-[7px] text-[12.5px] font-semibold transition-colors ${isEditing ? 'border-[#0A84FF] bg-[#EAF3FF] text-[#0670DE]' : 'border-[#DEDEDE] hover:border-[#0A84FF]'}`}
                                >
                                    <window.Icon name={isEditing ? 'check' : 'pencil'} size={13} />
                                    <span className="hidden sm:inline">{isEditing ? t('actions.done_editing') : t('actions.edit_readme')}</span>
                                </button>
                                {!activeFolder.parentId && (
                                    <button
                                        onClick={() => window.open(`/docs/${workspaceId}/${activeFolder.slug || idOf(activeFolder)}`, '_blank')}
                                        className="flex items-center gap-1.5 bg-[#0A84FF] border border-[#0A84FF] text-white rounded-[6px] px-3 py-[7px] text-[12.5px] font-semibold hover:bg-[#0670DE] transition-colors"
                                    >
                                        <window.Icon name="globe" size={13} />
                                        <span className="hidden sm:inline">{t('actions.open_public_page')}</span>
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto">
                            {isEditing ? (
                                <div className="max-w-[720px] mx-auto px-5 md:px-8 py-7 pb-20">
                                    <window.NotionEditor
                                        key={idOf(activeFolder)}
                                        initialContent={activeFolder.description || ''}
                                        editable={true}
                                        onChange={(html) => {
                                            setFolders(prev => prev.map(f => idOf(f) === idOf(activeFolder) ? { ...f, description: html } : f));
                                            saveFolder(idOf(activeFolder), { description: html });
                                        }}
                                    />
                                </div>
                            ) : (
                                <div className="max-w-[680px] mx-auto px-5 md:px-8 py-7 pb-20">
                                    {stripHtml(activeFolder.description).trim() ? (
                                        <div ref={previewRef} className="nd-doc-body readme-preview ql-editor" dangerouslySetInnerHTML={{ __html: window.sanitizeHtml(activeFolder.description) }} />
                                    ) : (
                                        <div className="py-10 text-center">
                                            <div className="w-14 h-14 rounded-xl bg-[#FAFAFA] border border-dashed border-[#DEDEDE] flex items-center justify-center mx-auto mb-4">
                                                <window.Icon name="book-open" size={22} className="text-[#A5A5AA]" />
                                            </div>
                                            <p className="text-[13px] font-semibold text-[#6E6E73]">{t('labels.readme_empty')}</p>
                                            <p className="text-[12.5px] text-[#A5A5AA] mt-1.5">{t('labels.readme_empty_folder_hint')}</p>
                                        </div>
                                    )}

                                    {(docsIn(idOf(activeFolder)).length > 0 || subfoldersOf(idOf(activeFolder)).length > 0) && (
                                        <div className="mt-10 pt-6 border-t border-[#ECECEC]">
                                            <h3 className="text-[11px] font-bold uppercase tracking-[0.04em] text-[#A5A5AA] mb-3">{t('labels.in_this_section')}</h3>
                                            <div className="space-y-1.5">
                                                {subfoldersOf(idOf(activeFolder)).map(sub => (
                                                    <button
                                                        key={idOf(sub)}
                                                        onClick={() => { setSelectedFolderId(idOf(sub)); setExpandedFolders(prev => ({ ...prev, [idOf(sub)]: true })); }}
                                                        className="w-full flex items-center gap-2.5 px-3.5 py-3 rounded-[10px] border border-[#ECECEC] hover:border-[#0A84FF] hover:bg-[#EAF3FF]/40 transition-colors text-left"
                                                    >
                                                        <window.Icon name="folder" size={15} className="text-[#9AA0A6] flex-shrink-0" />
                                                        <span className="text-[13px] font-semibold truncate">{sub.name}</span>
                                                        <span className="ml-auto text-[11px] font-mono text-[#A5A5AA] flex-shrink-0">{docsIn(idOf(sub)).length}</span>
                                                    </button>
                                                ))}
                                                {docsIn(idOf(activeFolder)).map(doc => (
                                                    <button
                                                        key={idOf(doc)}
                                                        onClick={() => { setSelectedDocId(idOf(doc)); setIsEditing(false); }}
                                                        className="w-full flex items-center gap-2.5 px-3.5 py-3 rounded-[10px] border border-[#ECECEC] hover:border-[#0A84FF] hover:bg-[#EAF3FF]/40 transition-colors text-left"
                                                    >
                                                        <window.Icon name="file-text" size={15} className="text-[#A5A5AA] flex-shrink-0" />
                                                        <span className="text-[13px] font-semibold truncate">{doc.title || t('labels.untitled')}</span>
                                                        {doc.passwordProtected && <window.Icon name="lock" size={11} className="text-[#A5A5AA] ml-auto flex-shrink-0" />}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </React.Fragment>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
                        <button onClick={() => setShowMobileSidebar(true)} className="md:hidden absolute top-4 left-4 text-[#6E6E73]">
                            <window.Icon name="menu" size={18} />
                        </button>
                        <window.Icon name="book-open" size={48} className="text-[#ECECEC] mb-5" />
                        <h3 className="text-[16px] font-bold text-[#6E6E73]">{t('labels.no_document_selected')}</h3>
                        <p className="text-[12.5px] text-[#A5A5AA] mt-1.5 max-w-xs">{t('labels.select_or_create_document')}</p>
                        <button onClick={addDoc} className="mt-6 inline-flex items-center gap-1.5 bg-[#0A84FF] text-white rounded-[6px] px-3.5 py-2 text-[12.5px] font-semibold hover:bg-[#0670DE] transition-colors">
                            <window.Icon name="plus" size={13} /> {t('actions.new_document')}
                        </button>
                    </div>
                )}
            </main>
        </div>
    );
};
