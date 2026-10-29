/**
 * Travel Report / Evaluation Screen for LAST LOCAL
 * Detailed psychological evaluation styled like an authentic NYC transit receipt.
 * Evaluates Sanity Retained, Mask Integrity, Anomaly Accuracy, and reveals endings.
 */
import React from 'react';
import { GameEngine } from '../game/gameState';
import { RunHistoryRecord, StopLogRecord } from '../types';
import { RESTRAINT_RAISE, CHAPTERS } from '../constants';
import { RotateCcw, Camera, Compass, Lock, DoorOpen, BookOpen, Home } from 'lucide-react';
import { PSYCH_CLASS, PSYCH_ENTRIES, PSYCH_IDS, entryState } from '../game/psychLog';
import { polaroidManager } from '../game/polaroidManager';
import { evp } from '../game/evpManager';
import { TapePlayButton } from './TapePlayButton';
import { practice } from '../game/practice';
import { resolveEnding, endingSummary, endingText, loadEndingsArchive, ENDINGS, ENDING_IDS } from '../game/endings';
import { routeText } from '../game/routeText';
import { CaseFilesModal } from './CaseFilesModal';
import { StatusChip } from '../ui/StatusChip';

interface ReportScreenProps {
  engine: GameEngine;
  runs: RunHistoryRecord[];
  /** `looped` is true for "Get back on" after The Eternal Commute. */
  onPlayAgain: (looped?: boolean) => void;
  /** Back to the title screen. */
  onTitle: () => void;
}

export const ReportScreen: React.FC<ReportScreenProps> = ({ engine, runs, onPlayAgain, onTitle }) => {
  const [showCaseFiles, setShowCaseFiles] = React.useState(false);
  const G = engine;
  const b = G.getBand(13);
  const secret = G.peak === 0;

  // The ending was decided when the ride ended (game/endings.ts).
  const endingDef = G.resolvedEnding ?? resolveEnding(endingSummary(G));
  const endingNarrative = endingText(endingDef).narrative;
  const rt = routeText();
  const endingBadge = endingDef.badge;

  const endingsArchive = loadEndingsArchive();
  const documentedEndingsCount = ENDING_IDS.filter((id) => !!endingsArchive[id]).length;

  const sanityPct = G.getSanityScore();
  const totalAn = G.acc.correct + G.acc.miss;
  const susTop = G.susLog.filter((l) => l.n > 0 || l.reason.startsWith('Concerned')).slice(0, 10);

  // Averages across device runs
  const avgPeak = runs.length ? Math.round(runs.reduce((a, r) => a + r.peak, 0) / runs.length) : 0;
  const runsWithSan = runs.filter((r) => typeof r.sanPct === 'number');
  const avgSan = runsWithSan.length ? Math.round(runsWithSan.reduce((a, r) => a + r.sanPct, 0) / runsWithSan.length) : null;

  // Psychological Log: this ride's anomalies, plus the case file kept across rides.
  const psych = G.psychLog;
  const archive = psych?.archive ?? {};
  const documented = PSYCH_IDS.filter((id) => entryState(archive[id]) === 'documented').length;
  const unconfirmed = PSYCH_IDS.filter((id) => entryState(archive[id]) === 'unconfirmed').length;

  const tellText = (r: StopLogRecord) => {
    let t =
      r.tick === 'doors'
        ? r.paLie
          ? 'The tell: the doors opened early, and the announcement lied.'
          : 'The tell: the doors opened early, with no announcement.'
        : r.tick === 'flicker'
        ? 'The tell: the lights flickered as you pulled in.'
        : '';
    if (r.mislead) t += ' Mom said it was your transfer. She was wrong. The doors weren\u2019t.';
    if (r.bait) t += ' Mom said "This is us." She was wrong. The lights weren\u2019t.';
    return t;
  };

  return (
    <div className="fixed inset-0 z-30 flex justify-center overflow-y-auto safe-pad bg-black/85 backdrop-blur-md">
      <div className="w-full max-w-xl my-auto py-4">
        {/* Paper Receipt / Travel Report Slip with flickering transit signage appearance */}
        <article className="ticket-slip bg-paper text-paper-ink p-5 sm:p-7 rounded-sm shadow-2xl border border-paper-faint transit-sign-flicker relative overflow-hidden">
          {/* Subtle raster scanline overlay */}
          <div className="absolute inset-0 pointer-events-none transit-sign-raster opacity-25" />

          <div className="border-b-2 border-paper-ink pb-3 mb-4 flex items-start justify-between gap-3 relative z-10">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-paper-ink text-cream text-3xs font-mono font-bold tracking-wider mb-1.5">
                <span className="w-3.5 h-3.5 rounded-full bg-g-line text-paper-ink font-black inline-flex items-center justify-center text-4xs">
                  {rt.line}
                </span>
                MTA NYCT // LAST LOCAL RIDE RECORD
              </div>
              <h2 className="text-fluid-2xl font-black uppercase tracking-tight leading-none text-paper-ink">
                Travel Report
              </h2>
              <p className="text-xs sm:text-sm text-paper-dim mt-1 font-semibold">
                {G.isPractice
                  ? `${rt.line} train to ${rt.terminusSign}. Practice run from Chapter ${CHAPTERS[practice.chapter - 1].numeral.split(' ')[1]}.`
                  : `${rt.line} train, ${rt.origin} to ${rt.terminusSign}. Ride #${runs.length}.`}
              </p>
            </div>
            <div className="text-right hidden sm:block">
              <span className="font-mono text-2xs font-bold text-paper-dim uppercase tracking-widest block">
                {G.isPractice || G.isDebugRun ? 'STATUS: NOT FILED' : 'STATUS: FILED'}
              </span>
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full mt-1 ${G.isPractice || G.isDebugRun ? 'bg-paper-faint' : 'bg-g-line shadow-[0_0_8px_rgba(108,190,69,0.8)]'}`}
              />
            </div>
          </div>

          {/* Narrative Outcome */}
          <div className="mb-5 p-3.5 rounded bg-black/5 border-l-4 border-g-line text-sm sm:text-base leading-relaxed relative z-10">
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-paper-ink text-cream font-mono text-2xs font-bold tracking-wider mb-2">
              <Compass className="w-3.5 h-3.5 text-warn" />
              <span>{endingBadge}</span>
            </div>
            <div className="font-semibold text-paper-ink">{endingNarrative}</div>
            {G.isPractice && (
              <p data-testid="practice-note" className="mt-2 text-xs text-paper-dim font-semibold">
                Practice run: nothing from this ride is saved. Endings, badges, Case Files, tapes and prints
                come only from full rides.
              </p>
            )}
            {G.isDebugRun && (
              <p data-testid="debug-run-note" className="mt-2 text-xs text-paper-dim font-semibold">
                Debug run: the spoiler overlay was shown, so nothing from this ride is saved.
              </p>
            )}
          </div>

          {/* One badge row: what kind of ride this was */}
          {(secret || G.nightmare || G.isPractice || G.isDebugRun) && (
            <div className="-mt-2 mb-4 flex flex-wrap gap-2 relative z-10" data-testid="report-badges">
              {secret && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm bg-g-deep text-paper font-mono text-2xs font-black tracking-wider">
                  ★ ZERO SUSPICION RUN
                </span>
              )}
              {G.nightmare && (
                <span data-testid="nightmare-tag" className="inline-flex items-center px-2.5 py-1 rounded-sm bg-[#7a1f14] text-[#ffd9d2] font-mono text-2xs font-bold tracking-wider">
                  NIGHTMARE
                </span>
              )}
              {G.isPractice && (
                <span data-testid="practice-tag" className="inline-flex items-center px-2.5 py-1 rounded-sm bg-paper-dim text-cream font-mono text-2xs font-bold tracking-wider">
                  PRACTICE
                </span>
              )}
              {G.isDebugRun && (
                <span data-testid="debug-run-tag" className="inline-flex items-center px-2.5 py-1 rounded-sm bg-paper-dim text-cream font-mono text-2xs font-bold tracking-wider">
                  DEBUG RUN
                </span>
              )}
            </div>
          )}

          {/* Core Evaluation Pillars: one two-column table, numbers in tabular mono */}
          <dl className="border-t border-paper-ink divide-y divide-paper-faint/60 text-xs sm:text-sm">
            {/* Sanity Retained */}
            <div className="py-2.5 grid grid-cols-[7.5rem_1fr] sm:grid-cols-[10rem_1fr] gap-3 items-baseline">
              <dt className="font-extrabold uppercase text-paper-ink tracking-wide" title="How well you held on, stop by stop: where your sanity sat inside each stop's band, averaged over the ride.">Sanity Retained</dt>
              <dd>
                <span className="font-mono tabular-nums text-base sm:text-lg font-black text-g-deep">{sanityPct}%</span>
                <p className="text-paper-dim text-xs mt-0.5 leading-snug">
                  Average position inside each stop's band (floor 0% to ceiling 100%).
                  <br />
                  Final sanity: <strong>{Math.round(G.san)}</strong> (Band {b[0]}–{b[1]}
                  {G.restraintOK ? ` +${RESTRAINT_RAISE} restraint bonus` : ''}).
                </p>
              </dd>
            </div>

            {/* Mask Integrity */}
            <div className="py-2.5 grid grid-cols-[7.5rem_1fr] sm:grid-cols-[10rem_1fr] gap-3 items-baseline">
              <dt className="font-extrabold uppercase text-paper-ink tracking-wide" title="How well you hid it: the highest your parents' Suspicion got this ride. Lower is better.">Mask Integrity</dt>
              <dd>
                <span className="text-base sm:text-lg font-black">Peak Suspicion: <span className="font-mono tabular-nums">{G.peak}</span></span>
                {secret && <p className="text-g-deep font-bold text-xs mt-0.5">They never suspected a thing.</p>}
                {G.interventions > 0 && (
                  <p className="text-paper-red text-xs font-semibold mt-0.5">
                    Parents intervened {G.interventions} time{G.interventions > 1 ? 's' : ''}.
                  </p>
                )}
                {susTop.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-paper-dim">
                    {susTop.map((l, i) => (
                      <li key={i} className="flex items-start gap-1">
                        <span className="shrink-0 whitespace-nowrap font-mono text-paper-ink font-bold">Stop {l.stop}:</span>
                        <span>{l.reason}</span>
                        {l.n > 0 && <span className="font-bold text-paper-red">(+{l.n})</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>

            {/* Anomaly Accuracy */}
            <div className="py-2.5 grid grid-cols-[7.5rem_1fr] sm:grid-cols-[10rem_1fr] gap-3 items-baseline">
              <dt className="font-extrabold uppercase text-paper-ink tracking-wide" title="Anomalies you flagged or photographed in time, out of all that appeared.">Anomaly Accuracy</dt>
              <dd>
                <span className="text-base sm:text-lg font-black">
                  <span className="font-mono tabular-nums">{G.acc.correct}</span> of <span className="font-mono tabular-nums">{totalAn}</span> Caught
                </span>
                <p className="text-paper-dim text-xs mt-0.5">
                  {G.acc.miss} missed, {G.acc.fp} false flag{G.acc.fp === 1 ? '' : 's'}.
                </p>
              </dd>
            </div>

            {/* Restraint Moment */}
            <div className="py-2.5 grid grid-cols-[7.5rem_1fr] sm:grid-cols-[10rem_1fr] gap-3 items-baseline">
              <dt className="font-extrabold uppercase text-paper-ink tracking-wide">Restraint (Stop 11)</dt>
              <dd className="font-bold">
                <span className={G.restraintOK ? 'text-g-deep' : 'text-paper-red'}>
                  {G.restraintOK ? 'Held (Composure Maintained)' : G.restraintWhy || 'Failed'}
                </span>
              </dd>
            </div>

            {/* False Stop Trials */}
            <div className="py-2.5 grid grid-cols-[7.5rem_1fr] sm:grid-cols-[10rem_1fr] gap-3 items-baseline">
              <dt className="font-extrabold uppercase text-paper-ink tracking-wide">False Stop Trials</dt>
              <dd className="font-semibold text-xs sm:text-sm">
                {G.trials.length > 0
                  ? G.trials.map((t) => `Stop ${t.stop} (${t.depth} loops deep)`).join('; ')
                  : 'None. You never stepped off into a trap.'}
              </dd>
            </div>
          </dl>

          {/* Stop By Stop Log Table */}
          <h3 className="mt-5 mb-2 font-black text-xs sm:text-sm uppercase tracking-wide border-t-2 border-paper-ink pt-3">
            Stop by Stop Record
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-paper-faint text-paper-ink">
                  <th className="py-1.5 pr-2 font-bold">Stop</th>
                  <th className="py-1.5 pr-2 font-bold">Type</th>
                  <th className="py-1.5 pr-2 font-bold">Doors</th>
                  <th className="py-1.5 pr-2 font-bold">Anomalies</th>
                  <th className="py-1.5 text-right font-bold">Sanity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-line">
                {G.stopLog.map((r, i) => {
                  const typeLabel =
                    r.type === 'haven' ? 'Safe Haven' : r.type === 'false' ? 'False Stop' : 'Real Stop';
                  const tell = tellText(r);

                  return (
                    <tr key={i} className="align-top text-2xs sm:text-xs">
                      <td className="py-1.5 pr-2 font-bold whitespace-nowrap">
                        {r.stop}
                        {r.b ? 'b' : ''}. {r.name}
                      </td>
                      <td className="py-1.5 pr-2">
                        <span className="font-semibold">{typeLabel}</span>
                        {tell && (
                          <div className="text-3xs text-paper-dim leading-tight mt-0.5">{tell}</div>
                        )}
                      </td>
                      <td className="py-1.5 pr-2 font-bold whitespace-nowrap">
                        {r.doors ? (
                          <span className={r.correct ? 'text-g-deep' : 'text-paper-red'}>
                            {r.doors === 'stay' ? 'Stayed' : 'Stepped off'}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-1.5 pr-2">
                        {r.anoms.length > 0 || r.fps.length > 0 ? (
                          <div className="space-y-0.5">
                            {r.anoms.map((a, ai) => (
                              <div key={ai} className="leading-tight">
                                <span className={a.hit ? 'text-g-deep font-bold' : 'text-paper-red font-bold'}>
                                  {a.hit ? (a.via === 'photo' ? 'Caught on film' : 'Caught') : 'Missed'}:
                                </span>{' '}
                                {a.desc}
                              </div>
                            ))}
                            {r.fps.map((fp, fi) => (
                              <div key={`fp-${fi}`} className="text-paper-red font-semibold leading-tight">
                                False flag: {fp}
                              </div>
                            ))}
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-1.5 text-right font-mono whitespace-nowrap">
                        {r.san !== undefined ? (
                          <>
                            <span className="font-bold">{r.san}</span>
                            <div className="text-3xs text-paper-dim">
                              {r.lo}–{r.hi}
                            </div>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Psychological Log */}
          <section aria-labelledby="psych-log-h" className="mt-5 border-t-2 border-paper-ink pt-3">
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <h3
                id="psych-log-h"
                className="font-black text-xs sm:text-sm uppercase tracking-wide"
                title="The anomalies you've seen: this ride's, then the whole file kept on this device (the same file as Case Files → Anomalies)."
              >
                Psychological Log
              </h3>
              <span className="font-mono text-2xs sm:text-xs font-bold whitespace-nowrap">
                {documented} / {PSYCH_IDS.length} documented
              </span>
            </div>
            <div
              className="h-1.5 rounded-sm bg-paper-line overflow-hidden flex"
              role="img"
              aria-label={`${documented} of ${PSYCH_IDS.length} documented, ${unconfirmed} unconfirmed`}
            >
              <div className="h-full bg-g-deep" style={{ width: `${(documented / PSYCH_IDS.length) * 100}%` }} />
              <div className="h-full bg-paper-faint" style={{ width: `${(unconfirmed / PSYCH_IDS.length) * 100}%` }} />
            </div>
            <p className="text-3xs sm:text-2xs text-paper-dim mt-1">
              Catch a phenomenon once to document it.{unconfirmed > 0 && ` ${unconfirmed} witnessed but never caught.`}
            </p>

            {/* This ride */}
            <h4 className="mt-3 mb-1 font-extrabold text-2xs uppercase tracking-wide text-paper-dim">This ride</h4>
            {psych && psych.ride.length > 0 ? (
              <ol className="divide-y divide-paper-line text-xs">
                {psych.ride.map((e, i) => {
                  const def = PSYCH_ENTRIES[e.id];
                  return (
                    <li key={i} className="py-1.5 grid grid-cols-[3.25rem_1fr] gap-x-2">
                      <span className="font-mono font-bold text-2xs pt-px">Stop {e.stop}</span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="font-extrabold">{def.title}</span>
                          <span className="font-mono text-3xs text-paper-dim">Class {PSYCH_CLASS[def.tier]}</span>
                          <span className={`font-bold text-3xs uppercase ${e.hit ? 'text-g-deep' : 'text-paper-red'}`}>
                            {e.hit ? 'Caught' : 'Missed'}
                          </span>
                          {e.isNew && (
                            <span className="px-1 rounded-sm bg-paper-ink text-paper font-black text-4xs tracking-wider">
                              NEW
                            </span>
                          )}
                          {e.confirmed && (
                            <span className="px-1 rounded-sm bg-g-deep text-paper font-black text-4xs tracking-wider">
                              CONFIRMED
                            </span>
                          )}
                        </div>
                        <div className="text-3xs sm:text-2xs text-paper-dim leading-snug mt-0.5">{e.desc}</div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-xs text-paper-dim">Nothing happened in front of you this ride. That you know of.</p>
            )}

            {/* Case file across rides */}
            <h4 className="mt-3 mb-1 font-extrabold text-2xs uppercase tracking-wide text-paper-dim">Case file</h4>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
              {PSYCH_IDS.map((id, i) => {
                const def = PSYCH_ENTRIES[id];
                const rec = archive[id];
                const state = entryState(rec);
                const no = String(i + 1).padStart(2, '0');
                return (
                  <li
                    key={id}
                    className={`p-2 rounded-sm border ${
                      state === 'documented'
                        ? 'border-paper-faint bg-black/5'
                        : state === 'unconfirmed'
                        ? 'border-dashed border-paper-faint'
                        : 'border-paper-line text-paper-dim'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-3xs text-paper-dim">No. {no}</span>
                      <span className="font-mono text-3xs text-paper-dim">Class {PSYCH_CLASS[def.tier]}</span>
                    </div>
                    {state === 'redacted' ? (
                      <>
                        <span
                          className="block mt-1 h-3 rounded-sm bg-paper-ink/80"
                          style={{ width: `${45 + ((i * 37) % 40)}%` }}
                          aria-label="Redacted"
                        />
                        <p className="mt-1 text-3xs italic">Not yet witnessed.</p>
                      </>
                    ) : (
                      <>
                        <div className="font-extrabold text-paper-ink mt-0.5">{def.title}</div>
                        {state === 'documented' ? (
                          <p className="text-3xs sm:text-2xs leading-snug mt-0.5">{def.note}</p>
                        ) : (
                          <p className="text-3xs sm:text-2xs leading-snug mt-0.5 italic text-paper-dim">
                            Unconfirmed. You were there; you didn’t catch it.
                          </p>
                        )}
                        <p className="font-mono text-3xs text-paper-dim mt-1">
                          Witnessed {rec!.seen}× · caught {rec!.caught}×
                        </p>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Documented Endings Archive Case File */}
          <section aria-labelledby="endings-archive-h" className="mt-5 border-t-2 border-paper-ink pt-3">
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <h3 id="endings-archive-h" className="font-black text-xs sm:text-sm uppercase tracking-wide flex items-center gap-1.5">
                <Compass className="w-4 h-4 text-paper-ink" />
                Case File: Documented Endings
              </h3>
              <span className="font-mono text-2xs sm:text-xs font-bold whitespace-nowrap text-g-deep">
                {documentedEndingsCount} / {ENDING_IDS.length} documented ({Math.round((documentedEndingsCount / ENDING_IDS.length) * 100)}%)
              </span>
            </div>
            <div
              className="h-1.5 rounded-sm bg-paper-line overflow-hidden flex mb-2"
              role="img"
              aria-label={`${documentedEndingsCount} of ${ENDING_IDS.length} endings documented`}
            >
              <div
                className="h-full bg-g-deep transition-all duration-300"
                style={{ width: `${(documentedEndingsCount / ENDING_IDS.length) * 100}%` }}
              />
            </div>
            <p className="text-3xs sm:text-2xs text-paper-dim mb-3">
              Each ride ends one way. Some ways are harder to find than others.
            </p>

            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {ENDING_IDS.map((id) => {
                const def = ENDINGS[id];
                const rec = endingsArchive[id];
                const isDiscovered = !!rec;
                const isCurrent = endingDef.id === id;

                return (
                  <li
                    key={id}
                    className={`p-2.5 rounded-sm border transition-all ${
                      isCurrent
                        ? 'border-g-deep bg-g-deep/10 ring-1 ring-g-deep'
                        : isDiscovered
                        ? 'border-paper-faint bg-black/5'
                        : 'border-paper-line bg-black/[0.02] text-paper-dim'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="font-mono text-4xs font-bold px-1 py-0.5 rounded bg-paper-ink text-cream">
                        {isDiscovered ? def.badge : '[REDACTED]'}
                      </span>
                      {isCurrent && (
                        <span className="font-mono text-4xs font-black text-g-deep uppercase tracking-wider">
                          THIS RIDE
                        </span>
                      )}
                    </div>

                    {isDiscovered ? (
                      <>
                        <div className="font-extrabold text-paper-ink mt-1">{def.title}</div>
                        <p className="text-3xs sm:text-2xs leading-snug text-paper-dim mt-0.5">
                          {endingText(def).summary}
                        </p>
                        <div className="font-mono text-4xs text-paper-dim mt-1 flex items-center justify-between">
                          <span>Documented {rec.count}×</span>
                          <span className="text-g-deep font-semibold">Filed</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5 mt-1">
                          <Lock className="w-3 h-3 text-paper-dim" />
                          <span className="font-bold text-paper-dim italic">Undocumented Outcome</span>
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Polaroid Photographic Evidence Section */}
          {polaroidManager.photos.length > 0 && (
            <section aria-labelledby="polaroid-evidence-h" className="mt-5 border-t-2 border-paper-ink pt-3">
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <h3 id="polaroid-evidence-h" className="font-black text-xs sm:text-sm uppercase tracking-wide flex items-center gap-1.5">
                  <Camera className="w-4 h-4 text-paper-ink" />
                  Photographic Evidence ({polaroidManager.photos.length})
                </h3>
                <span className="font-mono text-2xs text-g-deep font-bold">
                  {polaroidManager.photos.filter((p) => p.hasAnomalyInFrustum).length} caught on film
                </span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {polaroidManager.photos.slice(0, 8).map((photo) => (
                  <div key={photo.id} className="bg-white p-1.5 pb-2 rounded shadow-sm border border-paper-faint text-4xs">
                    <div className="aspect-square bg-black rounded-xs overflow-hidden relative">
                      <img src={photo.dataUrl} alt="Polaroid print" className="w-full h-full object-cover" />
                      {photo.hasAnomalyInFrustum && <StatusChip state="caught" className="absolute top-0.5 right-0.5 text-4xs! px-1!" />}
                    </div>
                    <div className="mt-1 truncate font-mono font-bold text-gray-800 text-[8px] text-center">
                      {photo.anomalyName || 'Nothing out of place'}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Tapes (EVP recorder) */}
          {evp.tapes.length > 0 && (
            <section aria-labelledby="tapes-h" className="mt-5 border-t-2 border-paper-ink pt-3">
              <h3 id="tapes-h" className="font-black text-xs sm:text-sm uppercase tracking-wide mb-2">
                Tapes ({evp.tapes.length})
              </h3>
              <ul className="space-y-1.5 text-xs">
                {evp.tapes.map((t) => (
                  <li key={t.signalId} className="grid grid-cols-[3.25rem_1fr] gap-x-2">
                    <span className="font-mono font-bold text-2xs">Stop {t.stop}</span>
                    <span>
                      <span className="flex items-center justify-between gap-2">
                        <span>
                          <strong>{t.title}</strong> <span className="font-mono text-3xs text-paper-dim">{t.freq}</span>
                        </span>
                        <TapePlayButton engine={G} tape={t} tone="paper" />
                      </span>
                      <span className="block italic text-paper-dim leading-snug">{t.transcript}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Historical Stats */}
          <div className="mt-4 pt-3 border-t border-paper-faint text-2xs sm:text-xs text-paper-dim">
            Across {runs.length} ride{runs.length === 1 ? '' : 's'} on this device, your average peak suspicion is{' '}
            <strong>{avgPeak}</strong>
            {avgSan !== null && (
              <>
                {' '}and your average sanity retained is <strong>{avgSan}%</strong>
              </>
            )}.
          </div>
        </article>

        {/* Actions: ride again first; the Case Files and the title screen after it */}
        <div className="mt-5 flex flex-col items-stretch gap-2.5 max-w-sm mx-auto">
          {endingDef.id === 'eternal_commute' ? (
            <button
              onClick={() => onPlayAgain(true)}
              className="px-6 py-3.5 rounded bg-g-line hover:bg-g-line-hi text-g-line-ink font-extrabold text-base tracking-wide transition-colors shadow-xl active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream flex items-center justify-center gap-2"
            >
              <DoorOpen className="w-4 h-4" />
              Get back on
            </button>
          ) : (
            <button
              onClick={() => onPlayAgain()}
              className="px-6 py-3.5 rounded bg-g-line hover:bg-g-line-hi text-g-line-ink font-extrabold text-base tracking-wide transition-colors shadow-xl active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Ride Again
            </button>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={() => setShowCaseFiles(true)}
              className="px-4 py-3 rounded border border-white/20 hover:border-white/40 bg-black/40 hover:bg-white/5 text-cream font-bold text-sm transition-colors active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream flex items-center justify-center gap-2"
            >
              <BookOpen className="w-4 h-4 text-g-line" />
              Case Files
            </button>
            <button
              onClick={onTitle}
              className="px-4 py-3 rounded border border-white/20 hover:border-white/40 bg-black/40 hover:bg-white/5 text-cream font-bold text-sm transition-colors active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream flex items-center justify-center gap-2"
            >
              <Home className="w-4 h-4" />
              Title
            </button>
          </div>
        </div>

        {/* Case Files Dossier Modal */}
        {showCaseFiles && (
          <CaseFilesModal engine={engine} onClose={() => setShowCaseFiles(false)} />
        )}
      </div>
    </div>
  );
};
