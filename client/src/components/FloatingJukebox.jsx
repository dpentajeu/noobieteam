/**
 * FloatingJukebox: fixed-position YouTube / audio panel with drag, edge snap, and smooth fly animation.
 * Position is persisted under localStorage key `nt_jukebox_pos`.
 */
(function () {
    const MARGIN = 16;
    /** Must match `.jukebox-minimized` width/height in `client/index.html`. */
    const JUKEBOX_MINIMIZED_PX = 56;
    const DRAG_THRESHOLD_SQ = 36;
    const SNAP_MS = 520;
    const SNAP_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

    /**
     * Returns the top-left position that docks this rectangle to the nearest viewport edge
     * (top, bottom, left, or right), keeping the box fully inside the screen along that edge.
     */
    function snapToNearestEdge(left, top, w, h) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const cx = left + w / 2;
        const cy = top + h / 2;
        const dTop = cy;
        const dBottom = vh - cy;
        const dLeft = cx;
        const dRight = vw - cx;
        const m = MARGIN;
        const minD = Math.min(dTop, dBottom, dLeft, dRight);
        let nx = left;
        let ny = top;
        if (minD === dTop) {
            ny = m;
            nx = Math.min(Math.max(m, left), vw - w - m);
        } else if (minD === dBottom) {
            ny = vh - h - m;
            nx = Math.min(Math.max(m, left), vw - w - m);
        } else if (minD === dLeft) {
            nx = m;
            ny = Math.min(Math.max(m, top), vh - h - m);
        } else {
            nx = vw - w - m;
            ny = Math.min(Math.max(m, top), vh - h - m);
        }
        return { x: nx, y: ny };
    }

    /**
     * Clamps top-left (left, top) so a w×h rectangle stays fully inside the viewport with MARGIN.
     */
    function clampPos(left, top, w, h) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const m = MARGIN;
        return {
            x: Math.min(Math.max(m, left), vw - w - m),
            y: Math.min(Math.max(m, top), vh - h - m),
        };
    }

    /** Loads last saved jukebox position from localStorage, or null if missing/invalid. */
    function readStoredPos() {
        try {
            const raw = localStorage.getItem('nt_jukebox_pos');
            if (!raw) return null;
            const p = JSON.parse(raw);
            if (typeof p.x === 'number' && typeof p.y === 'number') return { x: p.x, y: p.y };
        } catch (_) {}
        return null;
    }

    /** Default placement: bottom-right for a typical maximized jukebox size. */
    function defaultBottomRight() {
        const w = 320;
        const h = 220;
        return clampPos(window.innerWidth - w - MARGIN, window.innerHeight - h - MARGIN, w, h);
    }

    window.FloatingJukebox = () => {
        const { url, isMinimized, setUrl, setMinimized } = window.useJukebox();
        const { t } = window.useTranslation ? window.useTranslation() : { t: (k) => k };
        const [input, setInput] = React.useState('');
        const vId = window.extractYoutubeId(url);
        const pId = window.extractPlaylistId(url);

        const rootRef = React.useRef(null);
        const snapTargetRef = React.useRef(null);
        const snapRafIdsRef = React.useRef([]);
        const snapFlyBackupRef = React.useRef(null);
        const layoutRefitRafIdsRef = React.useRef([]);
        const snapFlyingRef = React.useRef(false);
        const [pos, setPos] = React.useState(() => readStoredPos() || defaultBottomRight());
        const [isDragging, setIsDragging] = React.useState(false);
        const [snapFlying, setSnapFlying] = React.useState(false);

        React.useEffect(() => {
            snapFlyingRef.current = snapFlying;
        }, [snapFlying]);

        /**
         * Minimize without the “collapse to top-left” illusion: place the 56×56 circle so its center
         * matches the maximized panel’s center (clamped to viewport), then minimize. Refit/snap then
         * flies the circle to the nearest edge from that centered origin.
         */
        const minimizeFromPanelCenter = React.useCallback(() => {
            const el = rootRef.current;
            if (el) {
                const r = el.getBoundingClientRect();
                const cx = r.left + r.width / 2;
                const cy = r.top + r.height / 2;
                const sz = JUKEBOX_MINIMIZED_PX;
                setPos(clampPos(cx - sz / 2, cy - sz / 2, sz, sz));
            }
            setMinimized(true);
        }, [setMinimized]);

        /** Updates React state and persists the given top-left position. */
        const persistPos = React.useCallback((next) => {
            setPos(next);
            try {
                localStorage.setItem('nt_jukebox_pos', JSON.stringify(next));
            } catch (_) {}
        }, []);

        /**
         * Aborts an in-flight “fly to edge” animation and optional layout refit rAFs.
         * If a snap was animating, syncs `pos` from the live DOM box so state matches what the user sees.
         */
        const cancelSnapFly = React.useCallback(() => {
            snapRafIdsRef.current.forEach((id) => cancelAnimationFrame(id));
            snapRafIdsRef.current = [];
            layoutRefitRafIdsRef.current.forEach((id) => cancelAnimationFrame(id));
            layoutRefitRafIdsRef.current = [];
            if (snapFlyBackupRef.current != null) {
                clearTimeout(snapFlyBackupRef.current);
                snapFlyBackupRef.current = null;
            }
            const el = rootRef.current;
            if (el && (snapFlyingRef.current || snapTargetRef.current)) {
                const b = el.getBoundingClientRect();
                setPos({ x: b.left, y: b.top });
            }
            snapTargetRef.current = null;
            setSnapFlying(false);
        }, []);

        /**
         * Animates `left`/`top` from the current DOM box to `snapped` using CSS transitions.
         * Uses two rAF ticks so the browser applies `transition` before the destination position.
         */
        const flyToSnap = React.useCallback(
            (snapped) => {
                const el = rootRef.current;
                if (!el) {
                    persistPos(snapped);
                    return;
                }
                const box = el.getBoundingClientRect();
                const curX = box.left;
                const curY = box.top;
                if (Math.hypot(snapped.x - curX, snapped.y - curY) < 1.5) {
                    cancelSnapFly();
                    persistPos(snapped);
                    return;
                }
                snapTargetRef.current = snapped;
                setSnapFlying(true);
                const id1 = requestAnimationFrame(() => {
                    const id2 = requestAnimationFrame(() => {
                        snapRafIdsRef.current = snapRafIdsRef.current.filter((id) => id !== id1 && id !== id2);
                        setPos(snapped);
                    });
                    snapRafIdsRef.current.push(id2);
                });
                snapRafIdsRef.current.push(id1);

                if (snapFlyBackupRef.current != null) {
                    clearTimeout(snapFlyBackupRef.current);
                }
                snapFlyBackupRef.current = setTimeout(() => {
                    snapFlyBackupRef.current = null;
                    if (!snapTargetRef.current) return;
                    const target = snapTargetRef.current;
                    snapTargetRef.current = null;
                    setSnapFlying(false);
                    try {
                        localStorage.setItem('nt_jukebox_pos', JSON.stringify(target));
                    } catch (_) {}
                }, SNAP_MS + 120);
            },
            [persistPos, cancelSnapFly]
        );

        /** Completes a snap animation: clears backup timer, saves storage, clears flying state. */
        const finishSnapFly = React.useCallback(() => {
            if (snapFlyBackupRef.current != null) {
                clearTimeout(snapFlyBackupRef.current);
                snapFlyBackupRef.current = null;
            }
            if (!snapTargetRef.current) return;
            const target = snapTargetRef.current;
            snapTargetRef.current = null;
            setSnapFlying(false);
            try {
                localStorage.setItem('nt_jukebox_pos', JSON.stringify(target));
            } catch (_) {}
        }, []);

        /** Fires when the root’s `left` transition ends after a programmatic snap (ignores bubbled child events). */
        const handleSnapTransitionEnd = React.useCallback(
            (e) => {
                if (e.target !== e.currentTarget) return;
                if (e.propertyName !== 'left') return;
                finishSnapFly();
            },
            [finishSnapFly]
        );

        /**
         * After size/mode changes (minimize, maximize, new video URL), reclamps to the viewport
         * for the *new* width/height then flies to the nearest edge. Uses double rAF so layout
         * (e.g. 56×56 vs 320×player height) is stable before measuring — fixes overflow when minimizing.
         */
        const scheduleRefitAndSnapToEdge = React.useCallback(() => {
            layoutRefitRafIdsRef.current.forEach((id) => cancelAnimationFrame(id));
            layoutRefitRafIdsRef.current = [];
            cancelSnapFly();
            const outer = requestAnimationFrame(() => {
                const inner = requestAnimationFrame(() => {
                    layoutRefitRafIdsRef.current = layoutRefitRafIdsRef.current.filter((id) => id !== outer && id !== inner);
                    const el = rootRef.current;
                    if (!el) return;
                    const box = el.getBoundingClientRect();
                    if (box.width < 4 || box.height < 4) return;
                    const cur = clampPos(box.left, box.top, box.width, box.height);
                    const snapped = snapToNearestEdge(cur.x, cur.y, box.width, box.height);
                    flyToSnap(snapped);
                });
                layoutRefitRafIdsRef.current.push(inner);
            });
            layoutRefitRafIdsRef.current.push(outer);
        }, [cancelSnapFly, flyToSnap]);

        React.useLayoutEffect(() => {
            scheduleRefitAndSnapToEdge();
        }, [url, isMinimized, scheduleRefitAndSnapToEdge]);

        React.useEffect(() => {
            const onResize = () => scheduleRefitAndSnapToEdge();
            window.addEventListener('resize', onResize);
            return () => window.removeEventListener('resize', onResize);
        }, [scheduleRefitAndSnapToEdge]);

        /**
         * Pointer drag: move jukebox while moving; on release, snap to nearest edge and fly there.
         * Optional `onClickIfNoDrag` (minimized button) runs only if movement stayed below threshold.
         */
        const startWindowDrag = React.useCallback(
            (e, { onClickIfNoDrag } = {}) => {
                if (e.button !== 0) return;
                cancelSnapFly();
                const el = rootRef.current;
                if (!el) return;
                const r = el.getBoundingClientRect();
                const start = {
                    clientX: e.clientX,
                    clientY: e.clientY,
                    origX: r.left,
                    origY: r.top,
                    dragged: false,
                };

                const onMove = (ev) => {
                    const dx = ev.clientX - start.clientX;
                    const dy = ev.clientY - start.clientY;
                    if (!start.dragged && dx * dx + dy * dy < DRAG_THRESHOLD_SQ) return;
                    if (!start.dragged) {
                        start.dragged = true;
                        setIsDragging(true);
                    }
                    const el2 = rootRef.current;
                    if (!el2) return;
                    const { width, height } = el2.getBoundingClientRect();
                    const next = clampPos(start.origX + dx, start.origY + dy, width, height);
                    setPos(next);
                };

                const onUp = () => {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    window.removeEventListener('pointercancel', onUp);
                    const el2 = rootRef.current;
                    if (start.dragged && el2) {
                        setIsDragging(false);
                        const box = el2.getBoundingClientRect();
                        const snapped = snapToNearestEdge(box.left, box.top, box.width, box.height);
                        flyToSnap(snapped);
                    } else if (!start.dragged && typeof onClickIfNoDrag === 'function') {
                        onClickIfNoDrag();
                    }
                };

                window.addEventListener('pointermove', onMove, { passive: true });
                window.addEventListener('pointerup', onUp);
                window.addEventListener('pointercancel', onUp);
            },
            [flyToSnap, cancelSnapFly]
        );

        React.useEffect(() => {
            return () => {
                layoutRefitRafIdsRef.current.forEach((id) => cancelAnimationFrame(id));
                layoutRefitRafIdsRef.current = [];
                cancelSnapFly();
            };
        }, [cancelSnapFly]);

        const rootStyle = {
            left: pos.x,
            top: pos.y,
            transform: isDragging ? 'translateZ(0)' : undefined,
            willChange: isDragging || snapFlying ? 'left, top' : 'auto',
            transition: isDragging
                ? 'none'
                : snapFlying
                  ? `left ${SNAP_MS}ms ${SNAP_EASE}, top ${SNAP_MS}ms ${SNAP_EASE}, box-shadow 0.28s ease`
                  : 'box-shadow 0.25s ease, opacity 0.2s ease',
        };

        const dragHandleClass =
            'cursor-grab active:cursor-grabbing select-none touch-none';

        if (!url && !isMinimized) {
            return (
                <div
                    ref={rootRef}
                    className="jukebox-floating jukebox-maximized bg-white p-6 rounded-[2rem] shadow-2xl border border-gray-100 animate-pop text-black"
                    style={rootStyle}
                    onTransitionEnd={handleSnapTransitionEnd}
                >
                    <div className={`flex justify-between items-center mb-4 ${dragHandleClass}`} onPointerDown={(e) => startWindowDrag(e)}>
                        <h4 className="text-[8px] font-black uppercase tracking-[0.2em] text-gray-400 flex-1 min-w-0 pr-2">
                            {t('labels.project_audio')}
                        </h4>
                        <button
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={minimizeFromPanelCenter}
                            className="p-1.5 hover:bg-gray-50 rounded-full transition shrink-0"
                        >
                            <window.Icon name="minus" size={14} />
                        </button>
                    </div>
                    <div className="flex gap-2">
                        <input
                            className="flex-1 p-3 bg-gray-50 rounded-xl text-[10px] border border-gray-100 outline-none focus:ring-1 focus:ring-black text-black"
                            placeholder={t('labels.youtube_url') || 'YouTube URL...'}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                        />
                        <button
                            type="button"
                            onClick={() => setUrl(input)}
                            className="p-3 bg-black text-white rounded-xl active:scale-95 transition shadow-lg shadow-gray-200"
                        >
                            <window.Icon name="play" size={18} />
                        </button>
                    </div>
                </div>
            );
        }

        if (isMinimized) {
            return (
                <div
                    ref={rootRef}
                    className="jukebox-floating jukebox-minimized shadow-2xl"
                    style={rootStyle}
                    onTransitionEnd={handleSnapTransitionEnd}
                >
                    <button
                        type="button"
                        onPointerDown={(e) =>
                            startWindowDrag(e, {
                                onClickIfNoDrag: () => setMinimized(false),
                            })
                        }
                        className="w-full h-full bg-black text-white flex items-center justify-center hover:scale-110 active:scale-90 transition animate-pop rounded-[inherit] overflow-hidden"
                    >
                        <window.Icon name="music" size={20} />
                    </button>
                </div>
            );
        }

        return (
            <div
                ref={rootRef}
                className="jukebox-floating jukebox-maximized bg-black overflow-hidden flex flex-col animate-pop"
                style={rootStyle}
                onTransitionEnd={handleSnapTransitionEnd}
            >
                <div
                    className={`p-3 flex justify-between items-center bg-gray-900/90 text-white ${dragHandleClass}`}
                    onPointerDown={(e) => startWindowDrag(e)}
                >
                    <span className="text-[8px] font-black uppercase tracking-[0.2em] opacity-50 flex-1 min-w-0 pr-2">
                        {t('labels.audio_streaming')}
                    </span>
                    <div className="flex gap-1.5 shrink-0" onPointerDown={(e) => e.stopPropagation()}>
                        <button type="button" onClick={() => setUrl('')} className="p-1.5 hover:bg-white/10 rounded-lg transition">
                            <window.Icon name="refresh-cw" size={12} />
                        </button>
                        <button type="button" onClick={minimizeFromPanelCenter} className="p-1.5 hover:bg-white/10 rounded-lg transition">
                            <window.Icon name="minus" size={12} />
                        </button>
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
                        <div className="w-full h-full flex items-center justify-center text-white text-xs">{t('alerts.invalid_youtube_url')}</div>
                    )}
                </div>
            </div>
        );
    };
})();
