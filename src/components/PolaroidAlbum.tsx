/**
 * Polaroid Evidence Photo Album
 * Slide-out retro photo drawer. During the ride the prints are still developing (blank frames,
 * no captions), so the album never tells the player what a shot caught. They develop after
 * the ride; the report shows them.
 */
import React, { useState } from 'react';
import { polaroidManager } from '../game/polaroidManager';
import { evp } from '../game/evpManager';
import type { GameEngine } from '../game/gameState';
import { TapePlayButton } from './TapePlayButton';
import { Overlay } from '../ui/Overlay';
import { StatusChip } from '../ui/StatusChip';
import { PolaroidPhoto } from '../types';
import { X, Image as ImageIcon, Sparkles, ZoomIn, Mic } from 'lucide-react';

interface PolaroidAlbumProps {
  onClose: () => void;
  /** Needed to play tapes; without it the Tapes tab shows transcripts only. */
  engine?: GameEngine;
}

export const PolaroidAlbum: React.FC<PolaroidAlbumProps> = ({ onClose, engine }) => {
  const [selectedPhoto, setSelectedPhoto] = useState<PolaroidPhoto | null>(null);
  const [filter, setFilter] = useState<'all' | 'anomalies' | 'carA' | 'carB' | 'carC'>('all');
  const [tab, setTab] = useState<'prints' | 'tapes'>('prints');
  // Esc closes an enlarged print first, then the log (rather than pausing the ride behind it):
  // each is an Overlay, and the topmost one gets the key.
  const tapes = evp.tapes;

  const photos = polaroidManager.photos;
  const developed = photos.length > 0 && photos.every((p) => p.developed);

  const filteredPhotos = photos.filter((p) => {
    if (filter === 'anomalies') return p.hasAnomalyInFrustum;
    if (filter === 'carA') return p.carIndex === 0;
    if (filter === 'carB') return p.carIndex === 1;
    if (filter === 'carC') return p.carIndex === 2;
    return true;
  });

  return (
    <>
    <Overlay
      onClose={onClose}
      labelledBy="evidence-title"
      width="4xl"
      layer={50}
      panelClassName="bg-[#141715] border border-white/15 rounded-xl text-cream select-none"
      bodyClassName="bg-panel p-4 sm:p-6"
      testId="evidence-log"
      header={
        <>
        {/* Header Bar */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-white/10 flex items-center justify-between bg-[#191d1a]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-warn/15 border border-warn/30 flex items-center justify-center text-warn">
              <ImageIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 id="evidence-title" className="font-bold text-base sm:text-lg text-cream tracking-tight">Evidence Log</h2>
              <p className="text-xs text-dim">
                {developed
                  ? `${photos.length} prints • ${photos.filter((p) => p.hasAnomalyInFrustum).length} caught something`
                  : `${photos.length} print${photos.length === 1 ? '' : 's'} • they develop after the ride`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              aria-label="Close Album"
              className="w-9 h-9 rounded-lg bg-black/50 border border-white/10 hover:bg-black/80 flex items-center justify-center text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Polaroids / Tapes */}
        <div role="tablist" aria-label="Evidence" className="px-4 sm:px-6 pt-2.5 bg-panel flex gap-1 text-xs font-bold tracking-wider">
          {(
            [
              ['prints', `POLAROIDS (${photos.length})`],
              ['tapes', `TAPES (${tapes.length})`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`px-3 py-2 rounded-t border-b-2 ${tab === k ? 'text-cream border-warn' : 'text-dim border-transparent hover:text-cream'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Filter Navigation Bar */}
        {tab === 'prints' && (
        <div className="px-4 sm:px-6 py-2.5 bg-panel border-b border-white/5 flex flex-wrap gap-2 text-xs">
          <button
            onClick={() => setFilter('all')}
            aria-pressed={filter === 'all'}
            className={`px-3 py-1.5 rounded-full font-medium transition-colors ${
              filter === 'all'
                ? 'bg-cream text-black font-semibold'
                : 'bg-white/5 hover:bg-white/10 text-dim'
            }`}
          >
            All Prints ({photos.length})
          </button>

{developed && (
          <button
            onClick={() => setFilter('anomalies')}
            aria-pressed={filter === 'anomalies'}
            className={`px-3 py-1.5 rounded-full font-medium transition-colors flex items-center gap-1.5 ${
              filter === 'anomalies'
                ? 'bg-red-600 text-white font-semibold'
                : 'bg-red-950/40 hover:bg-red-900/40 text-red-300 border border-red-500/20'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Anomalies Only ({photos.filter((p) => p.hasAnomalyInFrustum).length})</span>
          </button>
          )}

          <button
            onClick={() => setFilter('carA')}
            aria-pressed={filter === 'carA'}
            className={`px-3 py-1.5 rounded-full font-medium transition-colors ${
              filter === 'carA'
                ? 'bg-cream text-black font-semibold'
                : 'bg-white/5 hover:bg-white/10 text-dim'
            }`}
          >
            Car A (Lead)
          </button>

          <button
            onClick={() => setFilter('carB')}
            aria-pressed={filter === 'carB'}
            className={`px-3 py-1.5 rounded-full font-medium transition-colors ${
              filter === 'carB'
                ? 'bg-cream text-black font-semibold'
                : 'bg-white/5 hover:bg-white/10 text-dim'
            }`}
          >
            Car B (Mid)
          </button>

          <button
            onClick={() => setFilter('carC')}
            aria-pressed={filter === 'carC'}
            className={`px-3 py-1.5 rounded-full font-medium transition-colors ${
              filter === 'carC'
                ? 'bg-cream text-black font-semibold'
                : 'bg-white/5 hover:bg-white/10 text-dim'
            }`}
          >
            Car C (Rear)
          </button>
        </div>

        )}
        </>
      }
    >
        {tab === 'tapes' ? (
          <div role="tabpanel">
            {tapes.length === 0 ? (
              <div className="py-16 text-center text-dim">
                <Mic className="w-8 h-8 mx-auto opacity-40 mb-3" />
                <p className="text-sm font-medium">No tapes yet.</p>
                <p className="text-xs text-dim mt-1">
                  {evp.hasRecorder
                    ? `${engine?.isTouch ? 'Tap the recorder' : 'Press R'} to raise it, tune slowly, and hold record when something comes through.`
                    : 'You don\u2019t have anything to record with.'}
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {tapes.map((t) => (
                  <li key={t.signalId} className="p-3 rounded border border-sepia bg-film-ink">
                    <div className="flex items-center justify-between gap-3 font-mono text-2xs text-faint">
                      <span className="font-bold text-cream text-xs">{t.title}</span>
                      <span className="flex items-center gap-2">
                        <span>
                          Stop {t.stop} · {t.freq}
                        </span>
                        {engine && <TapePlayButton engine={engine} tape={t} />}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm italic text-film-2 leading-snug">{t.transcript}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
        <div role="tabpanel">
          {filteredPhotos.length === 0 ? (
            <div className="py-16 text-center flex flex-col items-center justify-center text-dim">
              <ImageIcon className="w-8 h-8 opacity-40 mb-3" aria-hidden="true" />
              <p className="text-sm font-medium">{photos.length ? 'No prints from this car.' : 'No Polaroids yet.'}</p>
              {!photos.length && (
                <p className="text-xs text-dim mt-1">{engine?.isTouch ? 'Tap Camera' : 'Press C'} on the train to take one.</p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 sm:gap-6">
              {filteredPhotos.map((photo) => (
                <div
                  key={photo.id}
                  onClick={() => setSelectedPhoto(photo)}
                  className="group relative cursor-pointer bg-film p-2.5 pb-4 rounded shadow-lg border border-black/30 hover:scale-[1.03] transition-all duration-200 text-black flex flex-col"
                >
                  {/* Square Print Image */}
                  <div className="relative aspect-square w-full bg-[#181816] rounded-sm overflow-hidden border border-black/20">
                    {photo.developed ? (
                      <img
                        src={photo.dataUrl}
                        alt="Polaroid Evidence"
                        className="w-full h-full object-cover filter contrast-105"
                      />
                    ) : (
                      <UndevelopedPrint />
                    )}

                    {/* Status (developed prints only), the same chip as the Case Files */}
                    {photo.developed && (
                      <StatusChip tone="dark" state={photo.hasAnomalyInFrustum ? 'caught' : 'nothing'} className="absolute top-1.5 right-1.5 shadow" />
                    )}

                    {/* Hover Zoom Prompt */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                      <ZoomIn className="w-6 h-6" />
                    </div>
                  </div>

                  {/* Caption Strip */}
                  <div className="mt-2 text-center">
                    <div className="text-2xs font-bold font-mono truncate text-gray-800">
                      {photo.developed ? photo.anomalyName || 'Nothing out of place' : 'Developing…'}
                    </div>
                    <div className="text-4xs font-mono text-paper-dim">
                      Car {photo.carIndex === 0 ? 'A (Lead)' : photo.carIndex === 2 ? 'C (Rear)' : 'B (Mid)'} • Line {photo.routeId}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}
    </Overlay>

      {/* Single Photo Inspection Lightbox Modal */}
      {selectedPhoto && (
        <Overlay
          onClose={() => setSelectedPhoto(null)}
          labelledBy="print-title"
          width="lg"
          layer={60}
          sheet={false}
          backdropClassName="bg-black/90 backdrop-blur-lg"
          panelClassName="bg-film text-black border border-black/30"
          bodyClassName="p-4 pb-6"
          testId="print-lightbox"
        >
            {/* Close button: on the print, so it's on screen whatever the print's size */}
            <button
              onClick={() => setSelectedPhoto(null)}
              aria-label="Close photo"
              className="absolute top-2 right-2 z-10 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Print Photo */}
            <div className="relative aspect-square w-full max-w-[60dvh] mx-auto bg-[#181816] rounded overflow-hidden border border-black/25">
              {selectedPhoto.developed ? (
                <img
                  src={selectedPhoto.dataUrl}
                  alt="Selected Evidence"
                  className="w-full h-full object-cover filter contrast-110"
                />
              ) : (
                <UndevelopedPrint large />
              )}
            </div>

            {/* Inspection Technical Details */}
            <div className="mt-4 font-mono">
              <div className="flex items-center justify-between pb-2 border-b border-black/15">
                <span id="print-title" className="font-bold text-sm tracking-tight text-gray-900">
                  {selectedPhoto.developed ? selectedPhoto.anomalyName || 'NOTHING OUT OF PLACE' : 'STILL DEVELOPING'}
                </span>
                {selectedPhoto.developed && (
                  <StatusChip tone="dark" state={selectedPhoto.hasAnomalyInFrustum ? 'caught' : 'nothing'} />
                )}
              </div>

              <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs text-gray-700">
                <div>
                  <span className="text-paper-dim text-3xs block">CONSIST CAR LOCATION</span>
                  <span className="font-semibold">
                    {selectedPhoto.carIndex === 0
                      ? 'Car A (Lead)'
                      : selectedPhoto.carIndex === 2
                      ? 'Car C (Rear)'
                      : 'Car B (Mid)'}
                  </span>
                </div>
                <div>
                  <span className="text-paper-dim text-3xs block">MTA TRANSIT LINE</span>
                  <span className="font-semibold">{selectedPhoto.routeId} Line</span>
                </div>
              </div>

              <p className="mt-3 text-xs text-paper-dim leading-relaxed bg-black/5 p-2.5 rounded border border-black/10">
                {selectedPhoto.developed
                  ? selectedPhoto.description || 'Evidentiary photo captured on Polaroid 600 emulsion.'
                  : 'Polaroid 600 prints take their time. This one will be ready at the end of the ride.'}
              </p>
            </div>
        </Overlay>
      )}
    </>
  );
};

/** A print that hasn't developed yet: the grey-green of fresh Polaroid emulsion, nothing else. */
const UndevelopedPrint: React.FC<{ large?: boolean }> = ({ large }) => (
  <div
    className="w-full h-full flex items-center justify-center"
    style={{ background: 'radial-gradient(circle at 40% 35%, #4a4a42 0%, #34352f 55%, #26272233 100%), #2b2c27' }}
    aria-label="Undeveloped print"
  >
    <span className={`font-mono tracking-[0.3em] text-white/25 ${large ? 'text-xs' : 'text-[8px]'}`}>DEVELOPING</span>
  </div>
);
