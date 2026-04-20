window.FloatingJukebox = () => {
    const { url, isMinimized, setUrl, setMinimized } = window.useJukebox();
    const [input, setInput] = React.useState('');
    const vId = window.extractYoutubeId(url);
    const pId = window.extractPlaylistId(url);

    if (!url && !isMinimized) {
        return (
            <div className="jukebox-floating jukebox-maximized bg-white p-6 rounded-[2rem] shadow-2xl border border-gray-100 animate-pop text-black">
                <div className="flex justify-between items-center mb-4">
                    <h4 className="text-[8px] font-black uppercase tracking-[0.2em] text-gray-400">Project Audio</h4>
                    <button onClick={() => setMinimized(true)} className="p-1.5 hover:bg-gray-50 rounded-full transition"><window.Icon name="minus" size={14}/></button>
                </div>
                <div className="flex gap-2">
                    <input className="flex-1 p-3 bg-gray-50 rounded-xl text-[10px] border border-gray-100 outline-none focus:ring-1 focus:ring-black text-black" placeholder="YouTube URL..." value={input} onChange={e => setInput(e.target.value)} />
                    <button onClick={() => setUrl(input)} className="p-3 bg-black text-white rounded-xl active:scale-95 transition shadow-lg shadow-gray-200"><window.Icon name="play" size={18}/></button>
                </div>
            </div>
        );
    }

    if (isMinimized) {
        return (
            <button onClick={() => setMinimized(false)} className="jukebox-floating jukebox-minimized bg-black text-white flex items-center justify-center shadow-2xl hover:scale-110 active:scale-90 transition animate-pop">
                <window.Icon name="music" size={20} />
            </button>
        );
    }

    return (
        <div className="jukebox-floating jukebox-maximized bg-black overflow-hidden flex flex-col animate-pop">
            <div className="p-3 flex justify-between items-center bg-gray-900/90 text-white">
                <span className="text-[8px] font-black uppercase tracking-[0.2em] opacity-50">Audio Streaming</span>
                <div className="flex gap-1.5">
                    <button onClick={() => setUrl('')} className="p-1.5 hover:bg-white/10 rounded-lg transition"><window.Icon name="refresh-cw" size={12}/></button>
                    <button onClick={() => setMinimized(true)} className="p-1.5 hover:bg-white/10 rounded-lg transition"><window.Icon name="minus" size={12}/></button>
                </div>
            </div>
            <div className="aspect-video bg-black relative">
                {pId || vId ? (
                    <window.ReactPlayer 
                        url={url} 
                        width="100%" 
                        height="100%" 
                        playing={false}
                        muted={false}
                        controls={true} 
                        config={{ youtube: { playerVars: { origin: window.location.origin } } }}
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-white text-xs">Invalid YouTube URL</div>
                )}
            </div>
        </div>
    );
};
