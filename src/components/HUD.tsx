/**
 * HUD Component for LAST LOCAL
 * Authentic NYC subway graphic aesthetic: reticle with flag progress ring,
 * dynamic MTA route bullet, car consist position, gangway door prompt,
 * Polaroid camera & album buttons, PA banner, and subtitles.
 *
 * No backdrop-filter blur here: these panels sit over the live 3D view, and a blur behind each
 * one is recomputed every frame (it roughly halved the frame rate in profiling). Slightly more
 * opaque backgrounds keep them readable instead. Short-lived dialogs may still blur.
 */
import React from 'react';
import { GameEngine } from '../game/gameState';
import { STOPS, TIER_NAMES, CFG } from '../constants';
import { Volume2, VolumeX, Pause, Camera, Image as ImageIcon, DoorOpen, GitBranch, Mic, Maximize2, Minimize2 } from 'lucide-react';
import { fullscreenSupported, toggleFullscreen, useFullscreen } from '../ui/fullscreen';
import { HeartbeatTrace } from './HeartbeatTrace';
import { MoveStick } from './MoveStick';
import { routeManager } from '../game/routeManager';
import { polaroidManager } from '../game/polaroidManager';
import { evp } from '../game/evpManager';
import { EvpRecorder } from './EvpRecorder';
import { AnalogRollsign } from './AnalogRollsign';
import { hintStrip } from '../ui/controls';
import { useSettings } from '../settings';
import { modelLoader } from '../graphics/modelLoader';

/** Seconds the key hints stay up on rides after your first. */
const HINT_SECONDS = 60;

/** The HUD's one glass surface over the 3D view. No backdrop blur (see the note at the top). */
const GLASS = 'bg-black/60 border border-white/10 shadow-lg';
/** A tool button: a 40px circle (44px on touch) that widens for a label. Add `flex` (or a
 * responsive display) at the call site. */
const TOOL =
  'h-10 min-w-10 touch:h-11 touch:min-w-11 px-0 items-center justify-center gap-1.5 rounded-full border text-xs font-semibold transition-colors active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream';

interface HUDProps {
  engine: GameEngine;
  onPause: () => void;
  onToggleMute: () => void;
  isMuted: boolean;
  onFlagDown: () => void;
  onFlagUp: () => void;
  onToggleCamera?: () => void;
  onToggleAlbum?: () => void;
  onOpenRouteSelector?: () => void;
}

export const HUD: React.FC<HUDProps> = ({
  engine,
  onPause,
  onToggleMute,
  isMuted,
  onFlagDown,
  onFlagUp,
  onToggleCamera,
  onToggleAlbum,
  onOpenRouteSelector,
}) => {
  const full = useFullscreen();
  // Publish the top bar's height (--hud-h) so cards that dock under it (the practice stretch's
  // coach) never cover it, whether it's one row (wide) or two (portrait phones).
  const topBarRef = React.useRef<HTMLDivElement>(null);
  const hudShown = engine.phase !== 'menu' && engine.phase !== 'end';
  React.useLayoutEffect(() => {
    const el = topBarRef.current;
    if (!el) return;
    const publish = () => {
      if (!el.offsetHeight) return; // hidden (viewfinder up): keep the last value
      document.documentElement.style.setProperty('--hud-h', `${el.offsetTop + el.offsetHeight}px`);
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hudShown]);
  // Key hints: on for the whole of your first ride (nothing finished on this device yet), and for
  // the first minute of later rides; then they fade. Settings can turn them off.
  const { showHints } = useSettings();
  const rideStartGT = React.useRef(0);
  const firstRide = React.useMemo(() => {
    rideStartGT.current = engine.GT;
    try {
      return (JSON.parse(localStorage.getItem('gtrain-runs') || '[]') as unknown[]).length === 0;
    } catch {
      return true;
    }
  }, [hudShown]); // eslint-disable-line react-hooks/exhaustive-deps
  const hintAge = engine.GT - rideStartGT.current;
  const hintsOn = showHints && (firstRide || hintAge < HINT_SECONDS + 1.5);
  const hintsFading = !firstRide && hintAge >= HINT_SECONDS;
  // The HUD only re-renders on game events, so wake it when the hints should fade, then go.
  const [, wake] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (!hudShown || firstRide || !showHints || hintAge >= HINT_SECONDS + 1.5) return;
    const t = setTimeout(wake, Math.max(0.1, (hintAge < HINT_SECONDS ? HINT_SECONDS : HINT_SECONDS + 1.5) - hintAge) * 1000);
    return () => clearTimeout(t);
  });
  const canFull = fullscreenSupported();
  const G = engine;
  if (G.phase === 'menu' || G.phase === 'end') return null;

  const currentRoute = routeManager.activeRoute;
  const nextStopName = G.seg
    ? G.seg.b
      ? routeManager.getStopName(6)
      : routeManager.getStopName(G.seg.stop)
    : routeManager.getStopName(2);

  const isRestraint = !!G.restraint;
  const isTrial = G.phase === 'trial';

  // Flag hold progress ring calculation
  const flagProgRatio = Math.max(0, Math.min(1, G.flagLock ? 1 : G.flagProg / CFG.flagHold));
  const dashOffset = 88 * (1 - flagProgRatio);
  const isNoted = G.GT - G.notedT < 0.6;

  // Choice options
  const choice = G.choice;
  const showChoices = !!choice;

  const b = G.getBand(G.bandStop);

  // Consist Car Label
  const carName =
    G.isCrossingGangway
      ? 'GANGWAY COUPLING'
      : G.currentCarIndex === 0
      ? 'CAR A (LEAD)'
      : G.currentCarIndex === 2
      ? 'CAR C (REAR)'
      : 'CAR B (MID)'; // the same letters as the Evidence Log, the viewfinder and the Case Files

  return (
    <div
      className="fixed pointer-events-none select-none z-20"
      // Inside the safe area: in full screen (or from the home screen) the view runs under notches.
      style={{
        top: 'env(safe-area-inset-top, 0px)',
        right: 'env(safe-area-inset-right, 0px)',
        bottom: 'env(safe-area-inset-bottom, 0px)',
        left: 'env(safe-area-inset-left, 0px)',
      }}
    >
      {/* Chapter Transition Rollsign */}
      <AnalogRollsign engine={G} />

      {/* Central Reticle */}
      {!isTrial && !polaroidManager.isViewfinderOpen && (
        <div
          className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[38px] h-[38px] transition-opacity duration-300 ${
            isNoted ? 'scale-110' : ''
          }`}
        >
          <svg className="w-full h-full -rotate-90" viewBox="0 0 38 38">
            <circle
              cx="19"
              cy="19"
              r="14"
              fill="none"
              stroke={isNoted ? '#ffffff' : currentRoute.bulletColor}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray="88"
              style={{ strokeDashoffset: `${dashOffset}` }}
            />
          </svg>
          <div className="absolute left-1/2 top-1/2 w-1.5 h-1.5 -ml-[3px] -mt-[3px] rounded-full bg-cream/80" />
        </div>
      )}

      {/*
        Top zone of the HUD grid: the station card (left) and the tools (right), one row from
        768px; below that the tools take the first row and the card the second. Glass over the
        scene: one surface (GLASS), one radius, one shadow. Hidden under the camera viewfinder,
        which has its own Album and Lower buttons along the top. Dims when you're idle (hud-dim).
      */}
      <div
        ref={topBarRef}
        data-testid="hud-top"
        className={`hud-dim absolute inset-x-3 min-[360px]:inset-x-4 top-3 sm:top-4 ${polaroidManager.isViewfinderOpen ? 'hidden' : 'grid'} grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] items-start gap-2 pointer-events-none`}
      >
        {/* Station card: where you're going, then chapter and car, then your heartbeat */}
        <button
          type="button"
          onClick={onOpenRouteSelector}
          title="Switch route line (L)"
          aria-label={`${currentRoute.id} train, next stop ${nextStopName}. Switch route line`}
          aria-keyshortcuts="L"
          data-testid="hud-route-panel"
          className={`${GLASS} order-last md:order-none justify-self-start min-w-0 max-w-full md:max-w-[24rem] flex flex-col items-stretch gap-1 px-3 pt-2 pb-1.5 rounded-xl text-left cursor-pointer pointer-events-auto transition-colors hover:border-white/25 active:translate-y-px transit-sign-flicker-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream`}
        >
          <span className="flex items-center gap-2 min-w-0 text-sm">
            <span
              className="shrink-0 w-6 h-6 rounded-full font-extrabold flex items-center justify-center text-xs shadow"
              style={{ backgroundColor: currentRoute.bulletColor, color: currentRoute.bulletTextColor }}
            >
              {currentRoute.id}
            </span>
            <span className="shrink-0 text-dim">Next:</span>
            <b className="min-w-0 truncate text-cream font-bold tracking-tight">{nextStopName}</b>
          </span>
          <span
            data-testid="chapter-badge"
            className="pl-8 min-w-0 truncate font-mono text-3xs font-bold tracking-[0.14em] uppercase text-cream/75"
          >
            CH. {['I', 'II', 'III'][G.currentChapter.index - 1]}
            <span className="hidden xl:inline">
              {' · '}
              {routeManager.routeId !== 'G' && G.currentChapter.titleOffG ? G.currentChapter.titleOffG : G.currentChapter.title}
            </span>
            {' · '}
            {carName.replace(/ \(.*\)$/, '')}
          </span>
          <span className="pl-8 block" aria-hidden="true">
            <HeartbeatTrace engine={G} width={132} height={12} />
          </span>
        </button>

        {/* Tools: gameplay (Camera, Recorder, Evidence, Route) | system (Sound, Full screen, Pause).
            40px circles (44px on touch); only Camera and Evidence carry labels, on wide screens. */}
        <div className="justify-self-end shrink-0 flex items-center gap-1 min-[360px]:gap-1.5 pointer-events-auto">
          <button
            onClick={onToggleCamera}
            // While an answer or the restraint needs you, the camera can't come up; pressing it says why.
            title={G.handsBusy && !polaroidManager.isViewfinderOpen ? `Camera: ${G.handsBusy}` : 'Camera (C)'}
            aria-label="Polaroid Camera"
            aria-keyshortcuts="C"
            aria-pressed={polaroidManager.isViewfinderOpen}
            aria-disabled={(!!G.handsBusy && !polaroidManager.isViewfinderOpen) || undefined}
            className={`flex ${TOOL} lg:px-3 ${
              polaroidManager.isViewfinderOpen
                ? 'bg-bad text-white border-bad-hi'
                : G.handsBusy
                ? `${GLASS} text-cream opacity-40 cursor-not-allowed`
                : `${GLASS} text-cream hover:bg-black/80`
            }`}
          >
            <Camera className="w-4 h-4 text-warn" />
            <span className="hidden lg:inline">Camera</span>
            <kbd className="hidden lg:inline text-3xs opacity-70 bg-white/10 px-1 py-0.5 rounded font-mono">C</kbd>
          </button>

          {/* Dad's tape recorder (once he's given it to you) */}
          {evp.hasRecorder && (
            <button
              onClick={() => G.toggleRecorder()}
              title={G.handsBusy && !evp.raised ? `Recorder: ${G.handsBusy}` : 'Tape recorder (R)'}
              aria-label="Recorder"
              aria-keyshortcuts="R"
              aria-pressed={evp.raised}
              aria-disabled={(!!G.handsBusy && !evp.raised) || undefined}
              className={`flex ${TOOL} ${
                evp.raised
                  ? 'bg-[#5a2a24] text-white border-bad-hi/60'
                  : G.handsBusy
                  ? `${GLASS} text-cream opacity-40 cursor-not-allowed`
                  : `${GLASS} text-cream hover:bg-black/80`
              }`}
            >
              <Mic className="w-4 h-4 text-bad-pale" />
            </button>
          )}

          {/* The evidence log (prints and tapes): one name everywhere, "Evidence" on buttons */}
          <button
            onClick={onToggleAlbum}
            title="Evidence log (Tab)"
            aria-label="Evidence Log"
            aria-pressed={polaroidManager.isAlbumOpen}
            className={`flex ${TOOL} px-2.5 lg:px-3 ${
              polaroidManager.isAlbumOpen ? 'bg-warn text-[#1a1205] border-warn-hi' : `${GLASS} text-cream hover:bg-black/80`
            }`}
          >
            <ImageIcon className="w-4 h-4 text-g-line" />
            <span className="hidden lg:inline">Evidence</span>
            <span className="text-3xs bg-white/10 px-1 py-0.5 rounded font-mono tabular-nums">{polaroidManager.photos.length}</span>
          </button>

          <button
            onClick={onOpenRouteSelector}
            title="Route lines (L)"
            aria-label="Route Lines"
            aria-keyshortcuts="L"
            className={`flex ${TOOL} ${GLASS} text-cream hover:bg-black/80`}
          >
            <GitBranch className="w-4 h-4 text-dim" />
          </button>

          <span className="mx-0.5 w-px h-6 bg-white/15" aria-hidden="true" />

          <button
            onClick={onToggleMute}
            title={isMuted ? 'Sound off (M)' : 'Sound on (M)'}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
            aria-keyshortcuts="M"
            className={`flex ${TOOL} hover:bg-black/80 ${isMuted ? 'bg-black/60 border-warn/60 shadow-lg text-warn' : `${GLASS} text-cream`}`}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          {/* Full screen (wide screens; phones go full screen on boarding, or from the pause menu) */}
          {canFull && (
            <button
              onClick={toggleFullscreen}
              aria-label={full ? 'Exit full screen' : 'Full screen'}
              title={full ? 'Exit full screen' : 'Full screen'}
              className={`hidden lg:flex ${TOOL} ${GLASS} text-cream hover:bg-black/80`}
            >
              {full ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          )}

          <button
            onClick={onPause}
            title="Pause (Esc or P)"
            aria-label="Pause"
            aria-keyshortcuts="Escape P"
            className={`flex ${TOOL} ${GLASS} text-cream hover:bg-black/80`}
          >
            <Pause className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Inter-Car Gangway Door Open Prompt */}
      {G.nearGangwayDoor && (
        <div className="absolute left-1/2 top-56 sm:top-44 -translate-x-1/2 pointer-events-auto">
          <button
            onClick={() => G.interactGangwayDoor()}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/85 border border-g-line text-cream font-bold text-xs sm:text-sm tracking-wide shadow-2xl hover:bg-black transition-all active:scale-95 animate-bounce"
          >
            <DoorOpen className="w-4 h-4 text-g-line" />
            <span>PUSH GANGWAY DOOR</span>
            <span className="text-3xs bg-g-line/30 text-g-line px-1.5 py-0.5 rounded font-mono">
              [E]
            </span>
          </button>
        </div>
      )}

      {/* Subway PA Announcement LED Display */}
      {G.paText && (
        <div className="absolute left-1/2 top-28 sm:top-16 -translate-x-1/2 max-w-[min(90vw,640px)] px-4 py-2 rounded bg-[#120d05] border border-warn/60 text-warn text-center font-bold text-sm sm:text-base tracking-wide shadow-[0_0_18px_rgba(227,168,58,0.25)] transit-sign-flicker relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none transit-sign-raster opacity-30" />
          <span className="inline-block w-2 h-2 rounded-full bg-warn mr-2 animate-ping" />
          <span className="relative z-10">{G.paText}</span>
        </div>
      )}

      {/* Contextual Hint */}
      {G.hintText && G.GT < G.hintUntil && (
        <div className="absolute left-1/2 top-40 sm:top-28 -translate-x-1/2 max-w-[90vw] px-3.5 py-1.5 rounded bg-black/80 border border-white/10 text-cream text-xs sm:text-sm text-center shadow-md transit-sign-flicker-subtle">
          {G.hintText}
        </div>
      )}

      {/* Subtitles (Conversations, Parent Reactions) */}
      {G.subHtml && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 max-w-[min(92vw,680px)] px-4 py-2.5 rounded bg-black/80 border border-white/10 text-center text-sm sm:text-base text-cream leading-relaxed shadow-lg transit-sign-flicker-subtle transition-all duration-300 ${
            showChoices ? 'bottom-28 touch:bottom-56 short-land:bottom-28' : isRestraint ? 'bottom-32' : 'bottom-16'
          }`}
          dangerouslySetInnerHTML={{ __html: G.subHtml }}
        />
      )}

      {/* Choice Buttons Bar (Doors & Mask Checks). Touch: full-width stacked buttons, at least
          48px tall, clear of the home indicator. Keyboard: side by side, each with its key cap. */}
      {showChoices && choice && (
        <div
          data-testid="choice-bar"
          className="absolute left-1/2 bottom-[max(1.25rem,env(safe-area-inset-bottom))] -translate-x-1/2 w-[min(calc(100vw-2rem-env(safe-area-inset-left)-env(safe-area-inset-right)),760px)] flex flex-wrap touch:flex-col short-land:flex-row gap-2.5 touch:gap-2 pointer-events-auto p-2 rounded-lg bg-black/85 border border-white/15 shadow-2xl transit-sign-flicker"
        >
          {/* Progress Time Bar */}
          {isFinite(choice.window) && (
            <div className="w-full h-1 bg-white/15 rounded-full overflow-hidden mb-1">
              <div
                className="h-full bg-warn transition-all duration-100 ease-linear"
                style={{ width: `${Math.max(0, Math.min(100, (choice.left / choice.window) * 100))}%` }}
              />
            </div>
          )}

          {choice.items.map((item, idx) => (
            <button
              key={idx}
              onClick={() => G.pickChoiceIndex(idx)}
              className="flex-1 min-w-[160px] touch:w-full short-land:w-auto short-land:min-w-0 touch:min-h-12 min-h-[46px] flex items-center gap-3 px-3.5 py-2.5 rounded bg-[#151916] hover:bg-[#202722] border border-white/15 hover:border-g-line text-left text-sm sm:text-base text-cream transition-colors active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream"
            >
              {!G.isTouch && (
                <kbd className="shrink-0 w-6 h-6 rounded bg-black/70 border border-white/25 border-b-2 text-cream/80 flex items-center justify-center text-xs font-mono font-bold">
                  {idx + 1}
                </kbd>
              )}
              <span className="flex-1 font-medium">{item.txt}</span>
            </button>
          ))}
        </div>
      )}

      {/* Touch: walking stick (bottom left), where the keyboard hints sit on desktop. Hidden at
          the same times WASD is ignored: answer prompts and the restraint. The camera viewfinder
          covers the screen edges, so the touch controls step aside while it's up. */}
      {G.isTouch &&
        !showChoices &&
        !polaroidManager.isViewfinderOpen &&
        !isRestraint &&
        !G.paused &&
        (G.phase === 'ride' || G.phase === 'stop' || G.phase === 'haven' || G.phase === 'intro') && (
          <MoveStick engine={G} />
        )}

      {/* Key hints (keyboard only): the first ride, and the first minute of later rides, then they
          fade. Settings → Controls → Show control hints turns them off. One list: ui/controls.ts. */}
      {!G.isTouch && hintsOn && (
        <div className="hud-dim absolute left-4 bottom-5 hidden md:block pointer-events-none">
          <div
            data-testid="hint-strip"
            className={`flex items-center gap-2 text-2xs text-cream/80 font-mono ${GLASS} px-3 py-1.5 rounded-xl transition-opacity duration-1000 calm:transition-none ${
              hintsFading ? 'opacity-0' : 'opacity-100'
            }`}
          >
            {/* The essentials. The gangway door shows its own [E] prompt when you're at one. */}
            {hintStrip(evp.hasRecorder).map((h, i) => (
              <React.Fragment key={h.id}>
                {i > 0 && <span className="text-white/30">•</span>}
                <span>
                  [{h.key}] {h.label}
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* The recorder takes the Flag button's place while it's up (hands busy). */}
      {evp.raised && !showChoices && <EvpRecorder engine={G} />}

      {/* Hold / Flag Button (Bottom Right). The ring fills clockwise while held; a short pulse when
          a flag registers (every flag the same: it never says whether you were right). */}
      {!showChoices && !evp.raised && !(G.isTouch && polaroidManager.isViewfinderOpen) && (
        <div className="absolute right-4 bottom-5 pointer-events-auto">
          <button
            onPointerDown={(e) => {
              e.preventDefault();
              onFlagDown();
            }}
            onPointerUp={onFlagUp}
            onPointerCancel={onFlagUp}
            onContextMenu={(e) => e.preventDefault()}
            aria-label={isRestraint ? 'Hold: don’t let go' : 'Flag: hold to catch'}
            className={`relative flex flex-col items-center justify-center rounded-full border transition-[transform,background-color,border-color] duration-200 active:scale-95 shadow-xl ${
              isNoted ? 'scale-110 calm:scale-100' : ''
            } ${
              isRestraint
                ? 'w-24 h-24 sm:w-28 sm:h-28 bg-warn/20 hover:bg-warn/30 border-warn text-warn'
                : G.flagHeld
                ? 'w-20 h-20 sm:w-22 sm:h-22 bg-g-line/30 border-g-line text-cream'
                : 'w-20 h-20 sm:w-22 sm:h-22 bg-black/65 hover:bg-black/80 border-white/30 text-cream'
            }`}
          >
            {!isRestraint && (
              <svg className="absolute -inset-1 w-[calc(100%+0.5rem)] h-[calc(100%+0.5rem)] -rotate-90 pointer-events-none" viewBox="0 0 100 100" aria-hidden="true">
                <circle
                  cx="50"
                  cy="50"
                  r="47"
                  fill="none"
                  stroke={isNoted ? '#ffffff' : currentRoute.bulletColor}
                  strokeWidth="4"
                  strokeLinecap="round"
                  pathLength={100}
                  strokeDasharray="100"
                  style={{ strokeDashoffset: 100 * (1 - flagProgRatio), opacity: flagProgRatio > 0 ? 1 : 0 }}
                />
              </svg>
            )}
            <span className="font-extrabold tracking-wider text-xs sm:text-sm">{isRestraint ? 'HOLD' : 'FLAG'}</span>
            <small className={`text-3xs font-semibold ${isRestraint ? 'text-warn-hi' : 'text-cream/80'}`}>
              {isRestraint ? "don't let go" : 'hold to catch'}
            </small>
          </button>
        </div>
      )}

      {/* Spoilers Debug Overlay (development builds only; compiled out of production) */}
      {import.meta.env.DEV && G.debug && (
        <div className="absolute left-4 top-16 p-3 rounded bg-black/85 border border-g-line/40 text-g-line font-mono text-2xs leading-relaxed max-w-sm pointer-events-auto z-30">
          <div className="font-bold border-b border-white/10 pb-1 mb-1 text-white">
            DEBUG: Stop {G.seg ? `${G.seg.stop}${G.seg.b ? 'b' : ''}` : '1'} ({G.phase}) | TS: {G.ts.toFixed(1)}s
          </div>
          <div>Service: LAST LOCAL | Line: {currentRoute.name} [{currentRoute.id}]</div>
          <div>Car: {carName} | Pos: ({G.eyePos.x.toFixed(1)}, {G.eyePos.z.toFixed(1)})</div>
          <div>Sanity: {G.san.toFixed(0)} (Band: {b[0]}–{b[1]}) | Tier: {TIER_NAMES[G.tier]}</div>
          <div>Suspicion: {G.sus} (Peak: {G.peak})</div>
          <div>Gaze: {G.gazeTid || '—'} ({G.dwell.toFixed(1)}s)</div>
          <div>Photos: {polaroidManager.photos.length} prints ({polaroidManager.remainingFilm} film left)</div>
          <div>Active Anomalies: {G.active.filter(a => a.at !== null).length} / {G.active.length}</div>
          <div>Blender GLB: {modelLoader.getSummary().loaded.length} loaded, {modelLoader.getSummary().fallback.length} fallback</div>
        </div>
      )}
    </div>
  );
};
