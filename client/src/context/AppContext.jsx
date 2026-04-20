const { createContext, useContext } = React;

// --- Contexts ---
window.ModalContext = createContext();
window.useModals = () => useContext(window.ModalContext);

window.ToastContext = createContext();
window.useToasts = () => useContext(window.ToastContext);

window.JukeboxContext = createContext();
window.useJukebox = () => useContext(window.JukeboxContext);

// --- Shared Constants ---
window.THEMES = [
    { id: 'default', name: 'Default', class: 'theme-default' },
    { id: 'dark', name: 'Dark', class: 'theme-dark' },
    { id: 'darkblue', name: 'Dark Blue', class: 'theme-dark-blue' },
    { id: 'green', name: 'Green', class: 'theme-green' },
    { id: 'ocean', name: 'Ocean Blue', class: 'theme-ocean-blue' }
];

// --- Shared UI Components (Global) ---
window.Icon = ({ name, size = 18, className = "" }) => {
    const ref = React.useRef(null);
    const [ready, setReady] = React.useState(false);

    React.useEffect(() => {
        const timer = setInterval(() => {
            if (window.lucide) {
                setReady(true);
                clearInterval(timer);
            }
        }, 100);
        return () => clearInterval(timer);
    }, []);

    React.useEffect(() => { 
        if (ready && ref.current && window.lucide) {
            try {
                window.lucide.createIcons({ root: ref.current });
            } catch (e) {
                console.error('Lucide error:', e);
            }
        }
    }, [ready, name, size]);

    return (
        <span ref={ref} className={className} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size }}>
            <i data-lucide={name} style={{ width: size, height: size }}></i>
        </span>
    );
};

window.Avatar = ({ label, src, size = "md", active, story, onClick }) => {
    const dim = size === "sm" ? "w-5 h-5 text-[7px]" : size === "lg" ? "w-12 h-12 text-lg" : "w-8 h-8 text-[10px]";
    return (
        <div onClick={onClick} className={`${dim} rounded-full flex items-center justify-center font-bold bg-white border border-gray-100 cursor-pointer overflow-hidden ${story ? 'story-ring' : active ? 'ring-2 ring-blue-500 ring-offset-2' : ''}`}>
            {src ? <img src={src} className="w-full h-full object-cover" /> : <span className="text-black">{label || '?'}</span>}
        </div>
    );
};

window.WYSIWYG = ({ value, onChange, id }) => {
    const editorRef = React.useRef(null);
    const quillRef = React.useRef(null);
    const onChangeRef = React.useRef(onChange);
    
    React.useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

    React.useEffect(() => {
        if (editorRef.current && !quillRef.current) {
            quillRef.current = new Quill(editorRef.current, {
                theme: 'snow',
                placeholder: 'Start writing...',
                modules: { toolbar: [['bold', 'italic'], [{ 'list': 'bullet' }], ['code-block']] }
            });
            quillRef.current.on('text-change', () => {
                const html = quillRef.current.root.innerHTML;
                if (onChangeRef.current) onChangeRef.current(html);
            });
        }
    }, []);

    React.useEffect(() => {
        if (quillRef.current) {
            quillRef.current.root.innerHTML = value || '';
        }
    }, [id]);

    return <div className="editor-wrapper"><div ref={editorRef} style={{ height: '120px' }}></div></div>;
};
