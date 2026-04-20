window.GlobalModal = ({ isOpen, onClose, title, children, footer }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[4000] flex items-center justify-center p-4 glass-blur animate-fade-in text-black">
            <div className="bg-white w-full max-w-md rounded-[2rem] shadow-2xl border border-gray-100 overflow-hidden animate-pop">
                <div className="p-4 border-b border-gray-50 flex justify-between items-center bg-gray-50/50">
                    <h3 className="text-lg font-black text-black tracking-tight">{title}</h3>
                    <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-full transition text-gray-400"><window.Icon name="x" size={18} /></button>
                </div>
                <div className="p-6 text-xs text-gray-600 font-medium leading-relaxed">{children}</div>
                {footer && <div className="p-4 border-t border-gray-50 flex justify-end gap-2 bg-gray-50/30">{footer}</div>}
            </div>
        </div>
    );
};
