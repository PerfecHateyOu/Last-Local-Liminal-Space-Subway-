/**
 * The False Stop Trial: starting it, its rounds, its per-frame update, picks and
 * exit. Split out of gameState.ts; GameEngine keeps thin wrappers with the same
 * names, so window.__G and the e2e tests see no change.
 */
import { SAN, SUS } from "../constants";
import { audioEngine } from "../audio/audioEngine";
import { evp } from "./evpManager";
import { routeManager } from "./routeManager";
import { routeText, fillRoute } from "./routeText";
import { shuffle } from "./shuffle";
import type { GameEngine } from "./gameState";
import type { ChoiceItem } from "../types";

export function startTrial(G: GameEngine) {
    evp.lower();
    G.phase = 'trial';
    G.trial = {
      depth: 0,
      need: 2,
      mode: 'paths',
      cyc: 0,
      correct: 0,
      events: [],
      picks: [],
      stopName: routeManager.getStopName(G.seg!.stop),
      stepT: 2,
    };

    G.carBuilder.worldGroup.visible = false;
    G.trialBuilder.group.visible = true;
    G.ty = 0;
    G.tp = 0;
    G.yaw = 0;
    G.pitch = 0;

    audioEngine.setBedLevel(0.05, 0.5);
    newTrialRound(G);
    G.setHint('Find the way back. The signs lie. Watch the lights when the chime plays.', 6.0);
    G.notifyUI();
}

export function newTrialRound(G: GameEngine) {
    const tr = G.trial!;
    const d = tr.depth;
    tr.correct = tr.mode === 'paths' ? Math.floor(Math.random() * 3) : Math.random() < 0.5 ? 0 : 2;

    const rt = routeText();
    const toward = fillRoute('To {terminusSign} trains', rt);
    const signsPool = [
      [toward, 'Exit', fillRoute('To {opposite} trains', rt)],
      [toward, toward, toward],
      // The signs start to fail: the first word's letters swap, and one points at you.
      [toward.replace(/^To (\S)(\S)/, 'To $2$1').replace(/trains$/, 'trians'), 'Ext', 'To You'],
      [rt.origin, rt.origin, rt.origin],
    ];
    const signs = shuffle(signsPool[Math.min(d, 3)]);

    G.trialBuilder.open.forEach((o, i) => {
      const isDoor = tr.mode === 'board' && i !== 1;
      G.trialBuilder.setSignText(o, tr.mode === 'board' ? (i === 1 ? '—' : fillRoute('{terminusSign}-bound {line}', rt)) : signs[i]);
      o.interior.visible = isDoor;
      o.leaves.forEach((l) => {
        l.lg.visible = isDoor;
        l.lg.position.x = l.x0;
      });
      o.openAmt = 0;
      o.target = 0;
      o.flickUntil = -1;
    });

    G.trialBuilder.tileMat.color.setHSL(0.12 - d * 0.03, 0.25 + d * 0.12, 0.9 - d * 0.12);
    tr.cyc = 3.2;

    const pathLabels = [
      ['Left stairs', 'Turnstiles', 'Right stairs'],
      ['Left stairs', 'Middle stairs', 'Right stairs'],
      ['Down', 'Down', 'Down'],
    ];
    const labels = tr.mode === 'paths' ? pathLabels[Math.min(d, 2)] : ['Board the left train', 'Board the right train'];
    const items: ChoiceItem[] =
      tr.mode === 'paths'
        ? labels.map((t, i) => ({ txt: t, val: i }))
        : [{ txt: labels[0], val: 0 }, { txt: labels[1], val: 2 }];

    const win = d === 0 ? Infinity : Math.max(7, 14 - d * 2);
    G.presentChoice({
      items,
      window: win,
      glitch: d * 0.18,
      onPick: (val) => onTrialPick(G, val),
    });
}

export function trialCycle(G: GameEngine) {
    const tr = G.trial!;
    audioEngine.chime();
    tr.events = [];
    if (tr.mode === 'paths') {
      tr.events.push({ at: 0, i: tr.correct, kind: 'flick' });
      [0, 1, 2]
        .filter((i) => i !== tr.correct)
        .forEach((i) => tr.events.push({ at: 0.8 + Math.random() * 2.2, i, kind: 'flick' }));
      if (tr.depth >= 1) {
        const decoy = [0, 1, 2].filter((i) => i !== tr.correct)[Math.floor(Math.random() * 2)];
        tr.events.push({ at: 0.22 + Math.random() * 0.13, i: decoy, kind: 'flick' });
      }
    } else {
      const fake = tr.correct === 0 ? 2 : 0;
      tr.events.push(
        { at: 1.95, i: tr.correct, kind: 'open' },
        { at: 1.15, i: fake, kind: 'open' },
        { at: 3.2, i: 0, kind: 'close' },
        { at: 3.2, i: 2, kind: 'close' }
      );
    }
}

export function updateTrial(G: GameEngine, dt: number) {
    const tr = G.trial;
    if (!tr || !G.trialBuilder.group.visible) return;

    tr.cyc += dt;
    if (tr.cyc >= 3.6) {
      tr.cyc -= 3.6;
      trialCycle(G);
    }

    tr.events.forEach((e) => {
      if (!e.done && tr.cyc >= e.at) {
        e.done = true;
        const o = G.trialBuilder.open[e.i];
        if (e.kind === 'flick') o.flickUntil = G.GT + 0.14;
        else if (e.kind === 'open') o.target = 1;
        else o.target = 0;
      }
    });

    G.trialBuilder.open.forEach((o) => {
      const off = G.GT < o.flickUntil;
      o.lmat.color.set(off ? 0x111111 : 0xfff2d6);
      o.pl.intensity = off ? 0 : 0.9;
      o.openAmt += (o.target - o.openAmt) * (1 - Math.exp(-9 * dt));
      o.leaves.forEach((l) => (l.lg.position.x = l.x0 + l.s * 0.75 * o.openAmt));
    });

    tr.stepT -= dt;
    if (tr.depth >= 1 && tr.stepT <= 0) {
      tr.stepT = (1.2 + Math.random() * 2.3) / tr.depth;
      audioEngine.step();
    }

    G.camera.position.copy(G.trialEyePos);
    if (G.camera.aspect < 1) G.camera.position.z = 3.3;
    G.camera.rotation.z = Math.sin(G.GT * 0.7) * 0.012 * tr.depth;
}

export function onTrialPick(G: GameEngine, val: any) {
    const tr = G.trial!;
    const ok = val === tr.correct;
    tr.picks.push({ mode: tr.mode, ok });

    G.sched(0.7, () => {
      if (tr.mode === 'paths') {
        if (ok) {
          tr.need--;
          G.setSub(
            tr.need > 0 ? '<em>The stairs go down to another platform.</em>' : '<em>You come out at the platform edge. Two trains are coming.</em>',
            3.0
          );
          if (tr.need <= 0) tr.mode = 'board';
        } else {
          tr.depth++;
          tr.need = Math.min(tr.need + 1, 3);
          G.setSub('<em>The stairs bring you back up onto the same platform. It\u2019s quieter now.</em>', 3.2);
        }
      } else {
        if (ok) {
          exitTrial(G, true);
          return;
        }
        tr.depth++;
        tr.mode = 'paths';
        tr.need = 1;
        G.setSub('<em>The doors close on nothing. You\u2019re back on the stairs.</em>', 3.2);
      }

      if (tr.depth >= 4) {
        exitTrial(G, false);
        return;
      }
      newTrialRound(G);
    });
}

export function exitTrial(G: GameEngine, clean: boolean) {
    const tr = G.trial!;
    G.trials.push({ stop: G.seg!.stop, depth: tr.depth, clean });

    G.sched(0.2, () => {
      G.trialBuilder.group.visible = false;
      G.carBuilder.worldGroup.visible = true;
      G.ty = 0;
      G.tp = -0.05;
      G.yaw = 0;
      G.pitch = -0.05;
      G.prevDir = null;
      G.angVel = 0;
      G.snapArc = 0;
      G.snapPeak = 0;
      G.snapCd = 1.5;

      G.addSus(SUS.falsePos, `Walked off the train at ${routeManager.getStopName(G.seg!.stop)}`, G.carBuilder.parents[0]);
      G.phase = 'stop';
      G.trial = null;
      G.addSanity(SAN.trial, 'Returned from a False Stop Trial');
      G.harder = 3;

      audioEngine.setBedLevel(1.0, 1.0);
      G.setSub(
        clean
          ? '<b>Mom:</b> Where did you go?! You can\u2019t just walk off like that!'
          : '<em>You don\u2019t remember getting back on.</em> <b>Mom:</b> Oh my god. Where were you?',
        3.4
      );
      G.sched(3.6, () => G.say(1, 'Sit. Stay where we can see you.', 2.6));
      G.sched(6.4, () => G.departNext());
    });
}
