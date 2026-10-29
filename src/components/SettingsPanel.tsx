/**
 * Settings, in five groups: Controls · Audio · Accessibility · Display · Data.
 * Opens over the start screen or the pause menu. Every change applies at once and is saved
 * on this device.
 */
import { fullscreenSupported } from '../ui/fullscreen';
import React from 'react';
import { X, Check as CheckIcon } from 'lucide-react';
import { settings, useSettings, savedProgress, SENSITIVITY_RANGE, type ScreenEffects } from '../settings';
import { haptics } from '../game/haptics';
import { useEscape } from '../ui/escape';
import { Overlay } from '../ui/Overlay';

interface SettingsPanelProps {
  onClose: () => void;
  isTouch: boolean;
}

const EFFECTS: Array<{ value: ScreenEffects; label: string }> = [
  { value: 'system', label: 'Match device' },
  { value: 'full', label: 'Full' },
  { value: 'reduced', label: 'Reduced' },
];

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="py-3.5 border-t border-white/10 first:border-t-0 first:pt-0">
    <h3 className="text-2xs font-extrabold uppercase tracking-[0.12em] text-dim mb-2.5">{title}</h3>
    <div className="space-y-3">{children}</div>
  </section>
);

const Slider: React.FC<{
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}> = ({ id, label, value, min, max, step, display, onChange }) => (
  <div>
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <label htmlFor={id} className="text-cream font-semibold">
        {label}
      </label>
      <output htmlFor={id} className="w-[5ch] text-right font-mono text-xs text-cream/80 tabular-nums">
        {display}
      </output>
    </div>
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="mt-1.5 w-full h-6 accent-g-line cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream"
    />
  </div>
);

const Check: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }> = ({
  label,
  checked,
  onChange,
  hint,
}) => (
  <label className="flex items-start gap-2.5 cursor-pointer text-sm text-cream font-semibold">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-0.5 w-4 h-4 rounded accent-g-line shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream"
    />
    <span>
      {label}
      {hint && <span className="block text-xs font-normal text-dim mt-0.5">{hint}</span>}
    </span>
  </label>
);

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose, isTouch }) => {
  const s = useSettings();
  const [vibrate, setVibrate] = React.useState(haptics.enabled);
  const [confirmErase, setConfirmErase] = React.useState(false);
  const [erased, setErased] = React.useState(false);
  // Counted when the confirmation opens, so it names exactly what will go.
  const saved = React.useMemo(() => savedProgress(), [confirmErase, erased]);
  const canVibrate = isTouch && haptics.supported;
  // Esc closes the panel (Overlay), or first cancels the erase confirmation if it's open.
  useEscape(() => setConfirmErase(false), confirmErase);
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  // One line: what these are, then what they're doing right now.
  const effectsOn = !settings.effectsReduced();
  const effectsNote =
    s.screenEffects === 'system'
      ? `Following your device: ${effectsOn ? 'On' : 'Off'}.`
      : s.screenEffects === 'reduced'
      ? 'Off.'
      : 'Always on.';

  return (
    <Overlay
      onClose={onClose}
      labelledBy="settings-title"
      width="md"
      layer={40}
      backdropClassName="bg-black/70 backdrop-blur-sm"
      testId="settings-panel"
      header={
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-white/10">
          <h2 id="settings-title" className="text-fluid-xl font-black text-cream uppercase tracking-wide">
            Settings
          </h2>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="w-9 h-9 -mr-1.5 flex items-center justify-center rounded-full text-dim hover:text-cream hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      }
      footer={
        <div className="px-5 pt-3 pb-4 border-t border-white/10">
          <button
            autoFocus
            onClick={onClose}
            className="w-full py-3 px-6 rounded bg-g-line hover:bg-g-line-hi text-g-line-ink font-extrabold text-base tracking-wide transition-all active:scale-[0.98]"
          >
            Done
          </button>
        </div>
      }
    >
      <div data-testid="settings-body">
          <Section title="Controls">
            <Slider
              id="set-sens"
              label="Look speed"
              value={s.lookSensitivity}
              min={SENSITIVITY_RANGE[0]}
              max={SENSITIVITY_RANGE[1]}
              step={0.05}
              display={`${s.lookSensitivity.toFixed(2)}×`}
              onChange={(v) => settings.set({ lookSensitivity: v })}
            />
            <Check label="Invert vertical look" checked={s.invertY} onChange={(v) => settings.set({ invertY: v })} />
            {!isTouch && (
              <Check
                label="Raw mouse input"
                hint="Uses your mouse's movement without the system's pointer acceleration, where the browser supports it. Applies the next time the mouse is captured."
                checked={s.rawMouse}
                onChange={(v) => settings.set({ rawMouse: v })}
              />
            )}
            <Check
              label="Smooth walking"
              hint="Walking speeds up and slows down gradually instead of starting and stopping at once. Same top speed."
              checked={s.smoothWalking}
              onChange={(v) => settings.set({ smoothWalking: v })}
            />
            {!isTouch && (
              <Check
                label="Show control hints"
                hint="The key strip along the bottom: all through your first ride, then for the first minute of each ride after."
                checked={s.showHints}
                onChange={(v) => settings.set({ showHints: v })}
              />
            )}
          </Section>

          <Section title="Audio">
            <Slider
              id="set-game-vol"
              label="Game sounds"
              value={s.gameVolume}
              min={0}
              max={1}
              step={0.05}
              display={pct(s.gameVolume)}
              onChange={(v) => settings.set({ gameVolume: v })}
            />
            <Slider
              id="set-music-vol"
              label="Music"
              value={s.musicVolume}
              min={0}
              max={1}
              step={0.05}
              display={pct(s.musicVolume)}
              onChange={(v) => settings.set({ musicVolume: v })}
            />
            <Check
              label="Start rides muted"
              hint={isTouch ? 'Tap the sound button to turn it on.' : 'M turns sound on and off at any time.'}
              checked={s.startMuted}
              onChange={(v) => settings.set({ startMuted: v })}
            />
          </Section>

          <Section title="Accessibility">
            <div>
              <div id="set-effects-label" className="text-sm text-cream font-semibold mb-1.5">
                Screen effects
              </div>
              <div
                role="radiogroup"
                aria-labelledby="set-effects-label"
                aria-describedby="set-effects-note"
                className="grid grid-cols-3 gap-1 p-1 rounded bg-black/40 border border-white/10"
              >
                {EFFECTS.map((o) => {
                  const on = s.screenEffects === o.value;
                  return (
                    <button
                      key={o.value}
                      role="radio"
                      aria-checked={on}
                      onClick={() => settings.set({ screenEffects: o.value })}
                      // Selected reads by shape as well as color: a check, a ring and heavier type.
                      className={`py-2 px-1 rounded text-xs sm:text-sm transition-colors inline-flex items-center justify-center gap-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream ${
                        on
                          ? 'bg-g-line text-g-line-ink font-black ring-2 ring-inset ring-g-line-ink/40'
                          : 'text-cream font-semibold hover:bg-white/10 active:translate-y-px'
                      }`}
                    >
                      {on && <CheckIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
                      {o.label}
                    </button>
                  );
                })}
              </div>
              <p id="set-effects-note" className="mt-1.5 text-xs text-dim leading-snug">
                Screen tearing, breathing and heartbeat line. {effectsNote}
              </p>
            </div>
            {canVibrate && (
              <Check
                label="Vibrate for catches"
                hint="At each stop, a soft pulse for every anomaly you caught on the way in."
                checked={vibrate}
                onChange={(v) => {
                  setVibrate(v);
                  haptics.setEnabled(v);
                }}
              />
            )}
          </Section>

          {fullscreenSupported() && (
            <Section title="Display">
              <Check
                label="Full screen when boarding"
                hint="Hides the browser's bars during the ride. Press Esc (or use the pause menu) to leave."
                checked={s.fullscreenOnBoard}
                onChange={(v) => settings.set({ fullscreenOnBoard: v })}
              />
            </Section>
          )}

          <Section title="Spoilers">
            <Check
              label="Debug overlay (spoilers)"
              hint="Spoiler warning: shows hidden anomalies, sanity and suspicion. It shows during rides while this is on (` hides or shows it on a keyboard). Rides where it's shown are debug runs and save nothing."
              checked={s.debugOverlay}
              onChange={(v) => settings.set({ debugOverlay: v })}
            />
          </Section>

          <Section title="3D Models & Modding">
            <div className="text-xs text-cream leading-relaxed space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-cream">Blender .glb Pipeline</span>
                <span className="font-mono text-2xs text-g-line font-bold uppercase tracking-wider">Active</span>
              </div>
              <p className="text-dim">
                Custom 3D characters in <code className="text-cream/90 bg-white/5 px-1 py-0.5 rounded font-mono">public/models/characters/</code> automatically import into the train with responsive gaze tracking and procedural fallbacks.
              </p>
            </div>
          </Section>

          <Section title="Data">
            {erased ? (
              <p role="status" className="text-sm text-g-line font-semibold">
                Saved progress erased.
              </p>
            ) : !saved.length ? (
              <p className="text-sm text-dim">Nothing saved on this device yet.</p>
            ) : !confirmErase ? (
              <>
                <p className="text-xs text-dim leading-snug mb-2">
                  Your Case Files, endings, tapes, prints, badges and finished rides on this device. Settings are kept.
                </p>
                <button
                  onClick={() => setConfirmErase(true)}
                  className="w-full py-2.5 px-4 rounded border border-bad/70 text-bad-hi hover:bg-bad/10 hover:border-bad-hi active:translate-y-px font-bold text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bad-hi"
                >
                  Erase saved progress
                </button>
              </>
            ) : (
              <div
                role="alertdialog"
                aria-labelledby="erase-confirm-text"
                className="p-3 rounded border border-bad/50 bg-bad/10"
              >
                <div id="erase-confirm-text" className="text-sm text-cream leading-snug">
                  <p>Erase everything saved on this device? This can’t be undone.</p>
                  <ul className="mt-1.5 list-disc pl-5 text-cream/85" data-testid="erase-list">
                    {saved.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  {saved.some((l) => l.includes('finished ride')) && (
                    <p className="mt-1.5 text-xs text-dim">
                      Nightmare mode and chapter select lock again until you finish a ride.
                    </p>
                  )}
                  <p className="mt-1.5 text-xs text-dim">Your settings are kept.</p>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    autoFocus
                    onClick={() => {
                      settings.eraseProgress();
                      setConfirmErase(false);
                      setErased(true);
                    }}
                    className="flex-1 py-2.5 px-4 rounded bg-bad hover:bg-bad-hi active:translate-y-px text-white font-extrabold text-sm transition-colors"
                  >
                    Erase
                  </button>
                  <button
                    onClick={() => setConfirmErase(false)}
                    className="flex-1 py-2.5 px-4 rounded border border-white/20 hover:border-white/40 active:translate-y-px text-cream font-bold text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </Section>
      </div>
    </Overlay>
  );
};
