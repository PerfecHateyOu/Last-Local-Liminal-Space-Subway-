/**
 * One place for mouse capture (pointer lock) state.
 *
 * The idea (a lock/unlock helper with events, raw mouse input) follows three.js's
 * PointerLockControls; the code here is our own.
 *
 * - isLocked: true while the mouse is captured for looking.
 * - lock(el): asks for raw (unaccelerated) mouse input when the setting is on and the browser
 *   supports it, falling back to a plain lock. Failures (e.g. the browser's re-lock cooldown right
 *   after Esc) raise a "Click to look around" hint instead of being swallowed.
 * - unlock({ quiet }): frees the mouse; a quiet unlock tells listeners not to pause the ride.
 * - subscribe(fn): called on every lock change with { locked, quiet }.
 */
import { settings } from '../settings';

export interface LockChange {
  locked: boolean;
  /** The game freed the mouse itself (route selector, evidence log): don't pause. */
  quiet: boolean;
}

type Listener = (c: LockChange) => void;

class PointerLock {
  private listeners = new Set<Listener>();
  private hintListeners = new Set<() => void>();
  private quietPending = false;
  private started = false;
  /** "Click to look around" is showing (a lock request failed). */
  public hint = false;

  public get isLocked(): boolean {
    return typeof document !== 'undefined' && !!document.pointerLockElement;
  }

  private start() {
    if (this.started || typeof document === 'undefined') return;
    this.started = true;
    document.addEventListener('pointerlockchange', () => {
      const locked = this.isLocked;
      let quiet = false;
      if (!locked && this.quietPending) {
        this.quietPending = false;
        quiet = true;
      }
      if (locked) this.setHint(false);
      this.listeners.forEach((fn) => fn({ locked, quiet }));
    });
    document.addEventListener('pointerlockerror', () => this.setHint(true));
  }

  private setHint(on: boolean) {
    if (this.hint === on) return;
    this.hint = on;
    this.hintListeners.forEach((fn) => fn());
  }

  public subscribe = (fn: Listener) => {
    this.start();
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  public subscribeHint = (fn: () => void) => {
    this.start();
    this.hintListeners.add(fn);
    return () => {
      this.hintListeners.delete(fn);
    };
  };

  /** Hide the hint (e.g. the ride ended or paused). */
  public clearHint() {
    this.setHint(false);
  }

  public lock(el: Element | null | undefined) {
    this.start();
    if (!el || this.isLocked || typeof el.requestPointerLock !== 'function') return;
    const fail = () => {
      if (!this.isLocked) this.setHint(true);
    };
    const plain = () => {
      try {
        const p = el.requestPointerLock() as unknown as Promise<void> | undefined;
        p?.catch?.(fail);
      } catch {
        fail();
      }
    };
    if (!settings.get().rawMouse) return plain();
    let p: Promise<void> | undefined;
    try {
      const req = el as unknown as { requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | undefined };
      p = req.requestPointerLock({ unadjustedMovement: true });
    } catch {
      return plain();
    }
    // Older browsers return nothing and ignore the option: that's a plain lock already.
    // A rejection means raw input isn't available (or the cooldown): try a plain lock once.
    p?.catch?.(() => {
      if (!this.isLocked) plain();
    });
  }

  public unlock(opts: { quiet?: boolean } = {}) {
    this.start();
    if (!this.isLocked) return;
    if (opts.quiet) this.quietPending = true;
    document.exitPointerLock();
  }
}

export const pointerLock = new PointerLock();
