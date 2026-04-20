window.Toast = ({ message, onRemove }) => {
    React.useEffect(() => {
        const timer = setTimeout(onRemove, 3500);
        return () => clearTimeout(timer);
    }, []);
    return (
        <div className="toast-item bg-white border border-gray-100 p-3 rounded-2xl shadow-xl flex items-center gap-3 animate-slide-in text-black">
            <div className="w-8 h-8 bg-emerald-50 text-emerald-500 rounded-xl flex items-center justify-center shadow-inner">
                <window.Icon name="sparkles" size={16} />
            </div>
            <div>
                <p className="text-xs font-black text-gray-800 tracking-tight">{message}</p>
                <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">System Broadcast</p>
            </div>
        </div>
    );
};
