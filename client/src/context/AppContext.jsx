const { createContext, useContext } = React;

// --- Contexts ---
window.ModalContext = createContext();
window.useModals = () => useContext(window.ModalContext);

window.ToastContext = createContext();
window.useToasts = () => useContext(window.ToastContext);

window.JukeboxContext = createContext();
window.useJukebox = () => useContext(window.JukeboxContext);

window.TranslationContext = createContext();
window.useTranslation = () => useContext(window.TranslationContext);

// --- Shared Constants ---
// `dark` is part of the theme now. It used to live as a hardcoded id list
// (`['dark','darkblue',...].includes(theme)`) copied into five components, so a
// new theme silently rendered white text on a white bar until every copy was
// found. The palette itself lives in index.html; see `.theme-*` there.
window.THEMES = [
    { id: 'default', name: 'Default', class: 'theme-default', dark: false },
    { id: 'dark', name: 'Dark', class: 'theme-dark', dark: true },
    { id: 'darkblue', name: 'Dark Blue', class: 'theme-dark-blue', dark: true },
    { id: 'green', name: 'Green', class: 'theme-green', dark: true },
    { id: 'ocean', name: 'Ocean Blue', class: 'theme-ocean-blue', dark: true }
];

// Every header in the app asks this for its class strings. Anything that has to
// stay legible against the header colour belongs here rather than in a component
// — that is what kept drifting: back buttons carried `hover:bg-black/5`, which is
// invisible on the four dark themes, and idle tabs sat at `opacity-40`, below a
// readable contrast on any of them.
window.getHeaderTheme = (id) => {
    const theme = window.THEMES.find(t => t.id === id) || window.THEMES[0];
    const dark = !!theme.dark;
    const focus = dark
        ? 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80'
        : 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
    return {
        id: theme.id,
        name: theme.name,
        isDark: dark,
        // The bar itself.
        nav: `${theme.class} theme-chrome`,
        // Surfaces outside the bar that share its palette.
        surface: `${theme.class} theme-surface`,
        // The same palette, translucent — for containers whose own children carry
        // the solid fills (board stages holding task cards).
        surfaceSoft: `${theme.class} theme-surface-soft`,
        // Outline for a surface. A white column on a white page has no edge at
        // all, and on the dark themes a dark border is equally invisible, so the
        // colour flips with the theme. Width stays 1px in every state — going to
        // 2px on drag would shift the column's contents by a pixel.
        surfaceBorder: dark
            ? 'border border-white/20 hover:border-white/35'
            : 'border border-gray-200 hover:border-gray-300',
        surfaceBorderDragging: dark ? 'border border-white/60' : 'border border-blue-500',
        // Text.
        title: dark ? 'text-white' : 'text-black',
        muted: dark ? 'text-white/70' : 'text-gray-500',
        // Transparent button; only shows a wash on hover.
        ghost: `${dark ? 'text-white hover:bg-white/10' : 'text-black hover:bg-black/5'} ${focus}`,
        // Always-tinted icon button.
        chip: `${dark ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-black/5 hover:bg-black/10 text-black'} ${focus}`,
        // Icon-only control sitting on a surface (column headers).
        surfaceIcon: dark
            ? 'text-white/70 hover:text-white hover:bg-white/10'
            : 'text-gray-400 hover:text-gray-800 hover:bg-black/5',
        // Destructive variant. A separate string rather than `surfaceIcon` plus a
        // red override: both would emit a `hover:text-*` and which one won would
        // depend on Tailwind's output order, not on the class list.
        surfaceIconDanger: dark
            ? 'text-white/70 hover:text-red-400 hover:bg-red-400/10'
            : 'text-gray-400 hover:text-red-500 hover:bg-red-500/10',
        // Segmented tab control.
        track: dark ? 'bg-white/10' : 'bg-black/5',
        tabActive: 'bg-white text-black shadow-md ring-1 ring-black/5',
        tabIdle: dark ? 'text-white/70 hover:text-white' : 'text-gray-500 hover:text-black',
        focus,
    };
};

// --- Shared UI Components (Global) ---
// Lucide converts an <i data-lucide="…"> placeholder by *replacing* it with an
// <svg>. That is incompatible with React owning the placeholder: after the first
// conversion React's node is detached, so a later `name` change writes the new
// attribute to a node that is no longer on the page and the old glyph sticks —
// visible whenever an icon toggles (lock/unlock) or when a sibling is added or
// removed and React reuses a node for a different icon.
//
// So React owns only the empty host span; the placeholder is created and
// converted imperatively inside it, out of React's reach.
window.Icon = ({ name, size = 18, className = "" }) => {
    const ref = React.useRef(null);
    const [ready, setReady] = React.useState(!!window.lucide);

    React.useEffect(() => {
        if (window.lucide) return;
        const timer = setInterval(() => {
            if (window.lucide) {
                setReady(true);
                clearInterval(timer);
            }
        }, 100);
        return () => clearInterval(timer);
    }, []);

    React.useEffect(() => {
        const host = ref.current;
        if (!ready || !host || !window.lucide) return;
        try {
            host.textContent = '';
            const placeholder = document.createElement('i');
            placeholder.setAttribute('data-lucide', name);
            placeholder.style.width = `${size}px`;
            placeholder.style.height = `${size}px`;
            host.appendChild(placeholder);
            window.lucide.createIcons({ root: host });
        } catch (e) {
            console.error('Lucide error for icon:', name, e);
        }
    }, [ready, name, size]);

    return (
        <span
            ref={ref}
            className={`${className} pointer-events-none`}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size }}
        />
    );
};

// Box sizes are unchanged from the original ternary — every avatar stack in the
// app is laid out against them. Only the initials scale moved: `sm` was 7px,
// below the 9px floor the rest of the UI uses, and `lg` was the only one on a
// named Tailwind step (`text-lg`) instead of an explicit pixel value.
const AVATAR_SIZES = {
    sm: 'w-5 h-5 text-[9px]',
    md: 'w-8 h-8 text-[11px]',
    lg: 'w-12 h-12 text-[16px]',
};

window.Avatar = ({ label, src, size = "md", active, onClick }) => {
    const dim = AVATAR_SIZES[size] || AVATAR_SIZES.md;
    return (
        <div onClick={onClick} className={`${dim} rounded-full flex items-center justify-center font-bold bg-white border border-gray-100 cursor-pointer overflow-hidden ${active ? 'ring-2 ring-blue-500 ring-offset-2' : ''}`}>
            {src ? <img src={src} alt={label || ''} className="w-full h-full object-cover" /> : <span className="text-black">{label || '?'}</span>}
        </div>
    );
};

window.WYSIWYG = ({ value, onChange, id, onBlur, autoFocus = false }) => {
    const editorRef = React.useRef(null);
    const quillRef = React.useRef(null);
    const onChangeRef = React.useRef(onChange);
    const onBlurRef = React.useRef(onBlur);
    
    React.useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
    React.useEffect(() => { onBlurRef.current = onBlur; }, [onBlur]);

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
            quillRef.current.on('selection-change', (range, oldRange) => {
                if (!range && oldRange && onBlurRef.current) onBlurRef.current();
            });
        }
    }, []);

    React.useEffect(() => {
        if (quillRef.current) {
            quillRef.current.root.innerHTML = value || '';
        }
    }, [id]);

    React.useEffect(() => {
        if (autoFocus && quillRef.current) {
            requestAnimationFrame(() => quillRef.current.focus());
        }
    }, [autoFocus]);

    return <div className="editor-wrapper"><div ref={editorRef} style={{ height: '120px' }}></div></div>;
};
