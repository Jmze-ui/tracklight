// node test.js — exercises the replayer core embedded in index.html
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const core = html.match(/<script type="text\/plain" id="core">([\s\S]*?)<\/script>/)[1];
const { parseMod, ModReplayer, makeDemo, TABLES, applyOp, writeMod, decodeWav, toSample8, encodeWav8,
  noteIndex, patSetNote, patSetNibble, patClearField, patClear, patCopy, patPaste, patShift, patTranspose, cellOff, computeLength, pickNext, spectrumBands, meterLevel, mergePrefs, PREF_DEFAULTS, THEMES, midiNoteIndex, midiTarget, orderRegion, regionSpan, swingTemplate, grooveTemplate, grooveMultipliers, parseSteps, fileKind, sortEntries, sampleNameFromFile, decodeIff8svx, encodeIff8svx, decodeSample, placeCard, bytesToB64, b64ToBytes, makeProject, readProject, sanitizeProjectState, projectFileName, buildPlayerHtml } =
  new Function(core + '; return { parseMod, ModReplayer, makeDemo, TABLES, applyOp, writeMod, decodeWav, toSample8, encodeWav8, noteIndex, patSetNote, patSetNibble, patClearField, patClear, patCopy, patPaste, patShift, patTranspose, cellOff, computeLength, pickNext, spectrumBands, meterLevel, mergePrefs, PREF_DEFAULTS, THEMES, midiNoteIndex, midiTarget, orderRegion, regionSpan, swingTemplate, grooveTemplate, grooveMultipliers, parseSteps, fileKind, sortEntries, sampleNameFromFile, decodeIff8svx, encodeIff8svx, decodeSample, placeCard, bytesToB64, b64ToBytes, makeProject, readProject, sanitizeProjectState, projectFileName, buildPlayerHtml };')();

let fail = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fail = 1; };

const mod = parseMod(makeDemo());
ok(mod.nch === 4 && mod.songLen === 8 && mod.patterns.length === 4, 'demo parses as 4ch, 8 orders, 4 patterns');
ok(mod.samples[3].looped && !mod.samples[0].looped, 'loop flags read from sample headers');
ok(TABLES[8][0] === 856 && TABLES[9][0] === 850 && TABLES[0][0] === 907, 'finetune tables match ProTracker anchors');

const r = new ModReplayer(mod, 44100);
const L = new Float32Array(441000), R = new Float32Array(441000);
r.render(L, R, L.length);
const peak = L.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
ok(peak > 0.05 && peak <= 1.0 && L.every(Number.isFinite), 'renders audible, finite, unclipped audio (peak ' + peak.toFixed(2) + ')');
ok(r.order > 0, '10 s of audio advances past order 0 (order ' + r.order + ')');

const e = new ModReplayer(mod, 44100); e.loop = false;
let frames = 0; const b = new Float32Array(4096);
while (!e.ended && frames < 44100 * 300) { e.render(b, b, 4096); frames += 4096; }
ok(e.ended && frames / 44100 > 50, 'non-loop playback ends after one pass (' + (frames / 44100).toFixed(1) + ' s)');

// 15-sample layout: same song with the 31-sample header cut down to 15 samples and no tag
const src = new Uint8Array(makeDemo());
const old = new Uint8Array(600 + 4 * 1024 + (src.length - 1084 - 4 * 1024));
old.set(src.subarray(0, 20 + 15 * 30));
old[470] = src[950]; old[471] = 120;
old.set(src.subarray(952, 952 + 128), 472);
old.set(src.subarray(1084), 600);
const m15 = parseMod(old.buffer);
ok(m15.tag === 'NST15' && m15.nch === 4 && m15.songLen === 8 && m15.samples.length === 31, '15-sample file detected and padded to 31 slots');
ok(m15.samples[3].looped && m15.samples[3].len === 64 && m15.samples[20].len === 0, '15-sample loops and data read correctly');
const r15 = new ModReplayer(m15, 44100), a = new Float32Array(441000), b2 = new Float32Array(441000);
r15.render(a, b2, a.length);
ok(a.every(Number.isFinite) && a.some(v => Math.abs(v) > 0.05) && r15.order > 0, '15-sample module plays and advances');
let threw = false; try { parseMod(new Uint8Array(2000).buffer); } catch (e) { threw = true; }
ok(threw, 'garbage is still rejected');

// Soundtracker effects: 1xy arpeggio (not slide-up) and 2xy bend; auto-detect from usage
const stBytes = new Uint8Array(old);
for (let o = 600; o < 600 + 4 * 1024; o += 4) if ((stBytes[o + 2] & 15) === 4) { stBytes[o + 2] &= 0xF0; stBytes[o + 3] = 0; } // drop vibrato: not in Soundtracker
stBytes[600 + (0 * 4 + 2) * 4 + 2] = (stBytes[600 + (0 * 4 + 2) * 4 + 2] & 0xF0) | 0x01;
stBytes[600 + (0 * 4 + 2) * 4 + 3] = 0x37;
const mst = parseMod(stBytes.buffer);
ok(mst.autoST === true && m15.autoST === false, 'auto-detect: 1xy-only 15-sample file is Soundtracker; arp-only demo with 0xy stays ProTracker');
const rs = new ModReplayer(mst, 44100); rs.readRow();
const bass = rs.ch[2];
ok(bass.cmd === 0 && bass.param === 0x37, 'ST 1xy maps to arpeggio');
const rp = new ModReplayer(mst, 44100); rp.fx = 'pt'; rp.readRow();
ok(rp.ch[2].cmd === 1 && rp.ch[2].param === 0x37, 'ProTracker override keeps 1xy as slide up');

// sample editor
const mk = (arr, extra) => Object.assign({ data: Int8Array.from(arr), len: arr.length, ls: 0, le: 0, looped: false }, extra);
let es = mk([10, 20, 30, 40, 50, 60]);
applyOp(es, 'reverse', 0, 0);
ok(Array.from(es.data).join() === '60,50,40,30,20,10', 'reverse whole sample');
es = mk([10, 20, 30, 40, 50, 60], { ls: 2, le: 6, looped: true });
applyOp(es, 'crop', 2, 6);
ok(es.len === 4 && es.ls === 0 && es.le === 4 && es.looped, 'crop moves the loop with the data');
es = mk([1, 2, 3, 4, 5, 6, 7, 8], { ls: 4, le: 8, looped: true });
applyOp(es, 'cut', 0, 2);
ok(es.len === 6 && es.ls === 2 && es.le === 6, 'cut before the loop shifts it back');
es = mk([1, 2, 3, 4, 5, 6, 7, 8], { ls: 2, le: 4, looped: true });
applyOp(es, 'cut', 1, 7);
ok(es.len === 2 && !es.looped, 'cut that swallows the loop turns looping off');
es = mk([20, -40, 10, 0]);
applyOp(es, 'normalize', 0, 0);
ok(es.data[1] === -127 && es.data[0] === 64, 'normalize scales peak to 127');
es = mk([100, 100, 100, 100]);
applyOp(es, 'fadeout', 0, 0);
ok(es.data[0] === 100 && es.data[3] === 0, 'fade out ends at silence');
es = mk([1, 2, 3]);
ok(es.len === 3 && applyOp(es, 'silence', 0, 0) && es.len === 4, 'odd length is padded to even');
ok(applyOp(mk([1, 2, 3, 4]), 'crop', 0, 0) === false, 'crop without a selection is refused');

// save/load round trip
const rt = parseMod(writeMod(mod, false));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
ok(rt.title === mod.title && rt.songLen === mod.songLen && same(rt.orders, mod.orders), 'saved module keeps title and order list');
ok(rt.patterns.every((p, i) => same(p, mod.patterns[i])), 'saved module keeps pattern data');
ok(rt.samples.every((s, i) => same(s.data, mod.samples[i].data) && s.looped === mod.samples[i].looped && s.ls === mod.samples[i].ls && s.le === mod.samples[i].le && s.vol === mod.samples[i].vol), 'saved module keeps sample data, loops and volumes');
const m15rt = parseMod(writeMod(m15, false));
ok(m15rt.tag === 'M.K.' && m15rt.samples[3].looped, '15-sample module saves as 31-sample M.K.');
const stSaved = parseMod(writeMod(mst, true));
ok(stSaved.patterns[0][(0 * 4 + 2) * 4 + 2] % 16 === 0 && stSaved.patterns[0][(0 * 4 + 2) * 4 + 3] === 0x37, 'Soundtracker save rewrites 1xy as ProTracker arpeggio 0xy');

// WAV import/export
const orig = mod.samples[0].data.slice(0, 1000);
const wav = decodeWav(encodeWav8(orig, 8287));
const back = toSample8(wav.mono, wav.rate);
ok(wav.rate === 8287 && back.length === 1000 && back.every((v, i) => v === orig[i]), '8-bit WAV export then import is lossless at 8287 Hz');
const hi = new Float32Array(44100).map((_, i) => Math.sin(i / 44100 * 2 * Math.PI * 100));
ok(toSample8(hi, 44100).length === Math.floor(44100 / (44100 / 8287)), 'import resamples 44.1 kHz down to the C-2 rate');

// preview voice
const rv = new ModReplayer(mod, 44100); rv.preview(3, 21);
const pa = new Float32Array(2048); rv.renderPv(pa, pa, pa.length);
ok(pa.some(v => Math.abs(v) > 0.01) && rv.pv, 'preview voice sounds and keeps looping');
const ru = new ModReplayer(mod, 44100); ru.readRow(); ru.setSample(3, { ...mod.samples[3], data: new Int8Array(0), len: 0, looped: false });
ok(ru.ch[2].active === false, 'swapping in an empty sample silences channels using it');

// pattern editing helpers
const P = new Uint8Array(64 * 4 * 4), at = (r, c) => cellOff(4, r, c);
patSetNote(P, 4, 2, 1, 12, 5);
ok((((P[at(2, 1)] & 15) << 8) | P[at(2, 1) + 1]) === 428 && ((P[at(2, 1)] & 0xF0) | (P[at(2, 1) + 2] >> 4)) === 5, 'note entry writes period and sample number');
patSetNote(P, 4, 2, 1, 14, 0);
ok(((P[at(2, 1)] & 0xF0) | (P[at(2, 1) + 2] >> 4)) === 5, 'note entry without a current sample keeps the existing one');
patSetNibble(P, 4, 3, 0, 1, 1); patSetNibble(P, 4, 3, 0, 2, 0xF);
ok(((P[at(3, 0)] & 0xF0) | (P[at(3, 0) + 2] >> 4)) === 0x1F, 'hex entry builds sample $1F');
patSetNibble(P, 4, 3, 0, 3, 0xC); patSetNibble(P, 4, 3, 0, 4, 4); patSetNibble(P, 4, 3, 0, 5, 0);
ok((P[at(3, 0) + 2] & 15) === 0xC && P[at(3, 0) + 3] === 0x40, 'hex entry builds effect C40');
patClearField(P, 4, 3, 0, 4);
ok((P[at(3, 0) + 2] & 15) === 0 && P[at(3, 0) + 3] === 0 && ((P[at(3, 0)] & 0xF0) | (P[at(3, 0) + 2] >> 4)) === 0x1F, 'clearing the effect field leaves the sample');
const Q = new Uint8Array(64 * 4 * 4);
for (let r = 0; r < 64; r++) Q[at(r, 2) + 3] = r + 1;
patShift(Q, 4, 10, 2, -1);
ok(Q[at(10, 2) + 3] === 12 && Q[at(63, 2) + 3] === 0 && Q[at(9, 2) + 3] === 10, 'delete row pulls the channel up');
patShift(Q, 4, 10, 2, 1);
ok(Q[at(10, 2) + 3] === 0 && Q[at(11, 2) + 3] === 12, 'insert row pushes the channel down');
const clip = patCopy(P, 4, { r0: 2, r1: 3, c0: 0, c1: 1 });
const PR = new Uint8Array(64 * 4 * 4);
patPaste(PR, 4, 62, 3, clip);
ok(clip.rows === 2 && clip.chs === 2 && PR[at(63, 3) + 1] === P[at(3, 0) + 1] && PR[at(63, 3) + 3] === P[at(3, 0) + 3], 'paste lands at the cursor and clips at the pattern end');
const TQ = new Uint8Array(64 * 4 * 4); patSetNote(TQ, 4, 0, 0, 10, 1);
patTranspose(TQ, 4, { r0: 0, r1: 0, c0: 0, c1: 0 }, 12);
ok(noteIndex(((TQ[0] & 15) << 8) | TQ[1]) === 22, 'transpose up an octave');
patTranspose(TQ, 4, { r0: 0, r1: 0, c0: 0, c1: 0 }, 30);
ok(noteIndex(((TQ[0] & 15) << 8) | TQ[1]) === 22, 'transpose out of range leaves the note alone');

// finetune: a note's period maps to the same note index whatever the sample finetune is
ok(noteIndex(428) === 12 && noteIndex(856) === 0 && noteIndex(113) === 35, 'note lookup uses the finetune-0 table');
const fm = parseMod(makeDemo()); fm.samples[3].finetune = -7;
const rf = new ModReplayer(fm, 44100); rf.readRow();
ok(rf.ch[2].noteIdx === 9 && rf.ch[2].period === TABLES[1][9], 'a finetuned sample plays the written note, not its neighbour');

// saving after order edits: only referenced patterns are written, readable again
const em = parseMod(makeDemo());
em.patterns.push(new Uint8Array(64 * 4 * 4)); em.patterns.push(new Uint8Array(64 * 4 * 4));
em.orders[8] = 5; em.songLen = 9;
const ebuf = writeMod(em, false);
const eb = parseMod(ebuf);
ok(eb.patterns.length === 6 && eb.songLen === 9 && eb.samples.every((s, i) => s.data.length === em.samples[i].data.length), 'new pattern added to the order list saves with all sample data intact');
em.songLen = 8; em.orders[8] = 5;
ok(parseMod(writeMod(em, false)).patterns.length === 4, 'patterns past the song length are not saved');

// song length
const lm = parseMod(makeDemo());
const len0 = computeLength(lm);
ok(Math.abs(len0.seconds - 61.44) < 0.05, 'demo length is 8 orders x 64 rows x 6 ticks at 125 BPM = 61.44 s (' + len0.seconds.toFixed(2) + ')');
ok(len0.times[0] === 0 && Math.abs(len0.times[64] - 7.68) < 0.01 && len0.speeds[64] === 6 && len0.tempos[64] === 125, 'row start times, speed and tempo recorded for seeking');
patSetNibble(lm.patterns[0], 4, 0, 1, 3, 0xF); patSetNibble(lm.patterns[0], 4, 0, 1, 5, 3);
ok(Math.abs(computeLength(lm).seconds - 30.72) < 0.05, 'a speed change to 3 halves the length');
const lt = parseMod(makeDemo());
patSetNibble(lt.patterns[0], 4, 0, 1, 3, 0xF); patSetNibble(lt.patterns[0], 4, 0, 1, 4, 0xF); patSetNibble(lt.patterns[0], 4, 0, 1, 5, 0xA);
ok(Math.abs(computeLength(lt).seconds - 61.44 * 125 / 250) < 0.05, 'tempo 250 halves the length');
const lb = parseMod(makeDemo());
patSetNibble(lb.patterns[0], 4, 8, 1, 3, 0xD); // row 8: pattern break to row 0 of next order
ok(computeLength(lb).seconds < 61.44 - 3, 'a pattern break shortens the song');
const lj = parseMod(makeDemo());
patSetNibble(lj.patterns[0], 4, 63, 1, 3, 0xB); // row 63: jump back to order 0
ok(Math.abs(computeLength(lj).seconds - 64 * 6 * 0.02) < 0.05, 'a jump back to order 0 ends the measure after one pass of that pattern');

// playlist ordering
const played = new Set();
ok(pickNext('next', 0, 3, played) === 1 && pickNext('next', 2, 3, played) === -1, 'play next stops after the last track');
ok(pickNext('repeat', 2, 3, played) === 0, 'repeat list wraps to the first track');
const seen = []; let curT = 0; const sp = new Set([0]);
for (let i = 0; i < 4; i++) { curT = pickNext('shuffle', curT, 5, sp, () => 0.3); seen.push(curT); }
ok(new Set([0, ...seen]).size === 5, 'shuffle visits every track before repeating');
ok(pickNext('shuffle', 0, 1, new Set()) === 0 && pickNext('next', 0, 0, new Set()) === -1, 'single-track and empty lists are safe');
const e2 = new ModReplayer(mod, 44100); e2.loop = false; e2.ended = true; e2.reset();
ok(e2.ended === false, 'reset after the song ended lets it play again');

// VU / spectrum maths
const sb = spectrumBands(32, 48000, 8192);
ok(sb.length === 32 && sb.every(([lo, hi]) => lo >= 1 && lo <= hi && hi < 4096), 'spectrum bands: 32 valid bin ranges');
ok(sb.every((b, i) => i === 0 || (b[0] >= sb[i - 1][0] && b[1] >= sb[i - 1][1])), 'spectrum bands ascend in frequency');
ok(Math.abs(sb[0][0] * 48000 / 8192 - 40) < 6 && sb[31][1] * 48000 / 8192 > 14000, 'spectrum bands cover roughly 40 Hz to 16 kHz');
const sine = Float32Array.from({ length: 4800 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 100 * i / 48000));
const lv = meterLevel(sine);
ok(Math.abs(lv.peak - 0.5) < 0.01 && Math.abs(lv.rms - 0.5 / Math.SQRT2) < 0.005, 'meter level reads peak 0.5 and RMS 0.354 for a half-scale sine');
ok(meterLevel(new Float32Array(0)).rms === 0, 'meter level of an empty block is silent');

// preferences
const pd = mergePrefs(null);
ok(JSON.stringify(pd) === JSON.stringify(PREF_DEFAULTS) && JSON.stringify(mergePrefs('{not json')) === JSON.stringify(PREF_DEFAULTS) && JSON.stringify(mergePrefs('42')) === JSON.stringify(PREF_DEFAULTS), 'missing, corrupt or non-object storage gives the defaults');
const pv = mergePrefs(JSON.stringify({ mode: 'clean', fx: 'st', sep: '75', vol: 120, after: 'shuffle', oct: '3', step: '4', theme: 'amber', fontScale: '1.2', showMeters: false }));
ok(pv.mode === 'clean' && pv.fx === 'st' && pv.sep === '75' && pv.vol === '120' && pv.after === 'shuffle' && pv.oct === '3' && pv.step === '4' && pv.theme === 'amber' && pv.fontScale === '1.2' && pv.showMeters === false, 'valid saved preferences are restored');
const pb = mergePrefs(JSON.stringify({ mode: 'turbo', vol: 999, sep: -5, theme: 'x', showMeters: 'yes', oct: 9, fx: 'pt', evil: 1 }));
ok(pb.mode === 'a500' && pb.vol === '100' && pb.sep === '40' && pb.theme === 'neon' && pb.showMeters === true && pb.oct === '2' && pb.fx === 'pt' && !('evil' in pb), 'each invalid value falls back on its own and unknown keys are dropped');
ok(JSON.stringify(mergePrefs(JSON.stringify(pv))) === JSON.stringify(pv), 'preferences survive a save and load round trip');
ok(Object.values(THEMES).every(t => /^#[0-9a-f]{6}$/i.test(t.acc) && /^#[0-9a-f]{6}$/i.test(t.acc2)), 'every theme has valid accent colours');

// MIDI keyboard
ok(midiNoteIndex(36, 0) === 0 && midiNoteIndex(48, 0) === 12 && midiNoteIndex(71, 0) === 35, 'MIDI notes 36-71 map to C-1..B-3');
ok(midiNoteIndex(35, 0) === -1 && midiNoteIndex(72, 0) === -1 && midiNoteIndex(24, 1) === 0 && midiNoteIndex(60, -1) === 12, 'out-of-range notes are ignored and the octave shift moves the window');
const cur0 = { order: 2, row: 10, ch: 1 };
const t1 = midiTarget(null, 1000, cur0, null, false, 'cursor', 4, 8);
ok(t1.order === 2 && t1.row === 10 && t1.ch === 1 && t1.advance === true, 'a lone note goes to the cursor and advances');
const t2 = midiTarget({ t: 1000, order: 2, row: 10, ch: 1 }, 1020, cur0, null, false, 'cursor', 4, 8);
ok(t2.row === 10 && t2.ch === 2 && t2.advance === false, 'a note within 40 ms is a chord: next channel, same row');
const t3 = midiTarget({ t: 1000, order: 2, row: 10, ch: 3 }, 1020, cur0, null, false, 'cursor', 4, 8);
ok(t3.ch === 1 && t3.row === 10 && t3.advance === true, 'a chord with no channel left starts a fresh note instead of overflowing');
const t4 = midiTarget({ t: 1000, order: 2, row: 10, ch: 1 }, 1100, cur0, null, false, 'cursor', 4, 8);
ok(t4.ch === 1 && t4.advance === true, 'notes more than 40 ms apart are not a chord');
const live = { order: 3, row: 20, frac: 0.2 };
ok(midiTarget(null, 0, cur0, live, true, 'playhead', 4, 8).row === 20 && midiTarget(null, 0, cur0, { ...live, frac: 0.7 }, true, 'playhead', 4, 8).row === 21, 'live recording rounds to the nearest row');
const edge = midiTarget(null, 0, cur0, { order: 7, row: 63, frac: 0.9 }, true, 'playhead', 4, 8);
ok(edge.order === 0 && edge.row === 0 && edge.advance === false, 'live recording past the last row wraps to the next order, and to the start after the last order');
ok(midiTarget(null, 0, cur0, live, false, 'playhead', 4, 8).advance === true, 'playhead mode while stopped falls back to the cursor');
ok(mergePrefs(JSON.stringify({ midiIn: 'abc123', midiRec: 'playhead', midiShift: '-1' })).midiIn === 'abc123' && mergePrefs(JSON.stringify({ midiIn: 42, midiRec: 'x', midiShift: '9' })).midiIn === 'off' && mergePrefs(JSON.stringify({ midiShift: '9' })).midiShift === '0', 'MIDI preferences are validated');

// tempo map and played pattern length
const base = computeLength(parseMod(makeDemo()));
ok(base.changes.length === 1 && base.changes[0].time === 0 && base.changes[0].speed === 6 && base.changes[0].tempo === 125, 'a song with no speed or tempo effects has one constant tempo entry');
ok(base.orders.length === 8 && base.orders.every(o => o.count === 64 && o.first === 0 && o.last === 63), 'every demo pattern plays all 64 rows');
const tm = parseMod(makeDemo());
patSetNibble(tm.patterns[0], 4, 4, 1, 3, 0xF); patSetNibble(tm.patterns[0], 4, 4, 1, 4, 9); patSetNibble(tm.patterns[0], 4, 4, 1, 5, 0); // row 4: tempo 144
patSetNibble(tm.patterns[2], 4, 0, 1, 3, 0xF); patSetNibble(tm.patterns[2], 4, 0, 1, 5, 4);                                          // pattern 2 row 0: speed 4
const tl = computeLength(tm);
ok(tl.changes.length === 3 && tl.changes[0].tempo === 125 && tl.changes[1].tempo === 144 && tl.changes[1].order === 0 && tl.changes[1].row === 5, 'a tempo change shows up at the row after the Fxx');
ok(tl.changes[2].speed === 4 && tl.changes[2].tempo === 144 && tl.changes[2].order === 2 && tl.changes[2].row === 1, 'a speed change is a separate entry and keeps the tempo');
ok(tl.changes.every((c, i) => i === 0 || c.time > tl.changes[i - 1].time), 'tempo map entries are in time order');
const bk = parseMod(makeDemo());
patSetNibble(bk.patterns[0], 4, 8, 1, 3, 0xD); patSetNibble(bk.patterns[0], 4, 8, 1, 4, 1); patSetNibble(bk.patterns[0], 4, 8, 1, 5, 0); // row 8: break to row 10 of next order
const bl = computeLength(bk);
ok(bl.orders[0].count === 9 && bl.orders[0].first === 0 && bl.orders[0].last === 8, 'a pattern break shortens the played length of that pattern');
ok(bl.orders[1].first === 10 && bl.orders[1].count === 54, 'the next pattern starts at the break row');

// loop region
const Lr = computeLength(parseMod(makeDemo()));
ok(orderRegion(70, 10, Lr.times).join() === '10,70' && orderRegion(10, 70, Lr.times).join() === '10,70', 'loop points are put in play order');
ok(orderRegion(5000, 20, Lr.times).join() === '20,5000' && orderRegion(3, 3, Lr.times).join() === '3,3', 'unplayed rows fall back to position order; a one-row region is allowed');
const band = regionSpan(Lr, 64, 127);
ok(Math.abs(band.left - 7.68 / 61.44) < 1e-6 && Math.abs(band.width - 7.68 / 61.44) < 0.002, 'region band covers rows 64-127 = 7.68 s of 61.44 s');
ok(regionSpan(Lr, 64, 5000) === null, 'a region with an unplayed end has no band');

function playRegion(region, seconds, start) {
  const r = new ModReplayer(parseMod(makeDemo()), 44100);
  r.region = region; if (start) r.setPos(start.order, start.row);
  const L = new Float32Array(512), R = new Float32Array(512), seen = new Set(); let tempoSeen = new Set();
  for (let i = 0; i < seconds * 44100 / 512; i++) { r.render(L, R, 512); seen.add(r.order * 64 + r.row); tempoSeen.add(r.speed); }
  return { seen, r, tempoSeen };
}
const inside = playRegion({ a: 4, b: 7, speed: 6, tempo: 125 }, 12, { order: 0, row: 4 });
ok([...inside.seen].every(k => k >= 4 && k <= 7) && inside.seen.size === 4, '12 s of playback stays inside rows 4-7 of order 0 and visits all four');
const across = playRegion({ a: 62, b: 65, speed: 6, tempo: 125 }, 10, { order: 0, row: 62 });
ok([...across.seen].every(k => k >= 62 && k <= 65) && across.seen.size === 4, 'a region can span two patterns (rows 62-63 then 0-1 of the next)');
const slow = playRegion({ a: 4, b: 5, speed: 3, tempo: 125 }, 6, { order: 0, row: 4 });
ok(slow.r.speed === 3, 'looping back restores the region start speed');
const free = playRegion(null, 5, { order: 0, row: 4 });
ok(free.r.order * 64 + free.r.row > 7 && free.seen.size > 10, 'with no region playback moves on as normal');
const outside = playRegion({ a: 200, b: 203, speed: 6, tempo: 125 }, 5, { order: 0, row: 0 });
ok(outside.seen.size > 10, 'a region the song is not inside does not trap playback');

// swing and groove
const sum = a => Array.from(a).reduce((x, y) => x + y, 0);
const sw0 = swingTemplate(0.5, 2), sw3 = swingTemplate(2 / 3, 2), sw8 = swingTemplate(0.6, 4);
ok(sw0.every(v => v === 1) && Math.abs(sw3[0] - 4 / 3) < 1e-9 && Math.abs(sw3[1] - 2 / 3) < 1e-9 && Math.abs(sum(sw3) - 16) < 1e-9, 'swing 50% is straight; 67% makes 16th pairs last 4/3 then 2/3');
ok(sw8[0] === 1.2 && sw8[1] === 1.2 && Math.abs(sw8[2] - 0.8) < 1e-9 && Math.abs(sum(sw8) - 16) < 1e-9, 'swing 8ths pairs two rows with two rows');
ok(['straight', 'swing16', 'swing8', 'laid', 'rush', 'custom'].every(p => { const g = grooveTemplate(p, 62, null); return g.length === 16 && g.every(v => v > 0) && Math.abs(sum(g) - 16) < 1e-9; }), 'every preset is 16 positive steps that add up to 16 rows');
ok(Array.from(grooveMultipliers(sw3, 0)).every(v => v === 1), 'strength 0 switches the groove off');
const half = grooveMultipliers(sw3, 0.5);
ok(Math.abs(half[0] - 7 / 6) < 1e-6 && Math.abs(sum(half) - 16) < 1e-5, 'strength 50% halves the swing and keeps the total');
const lop = grooveMultipliers([2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1].map(v => Math.min(1.5, v)), 1);
ok(Math.abs(sum(lop) - 16) < 1e-5, 'an uneven custom groove is rescaled to keep the tempo');
ok(parseSteps('1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1').length === 16 && parseSteps('1,2') === null && parseSteps('1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,9') === null && parseSteps(42) === null && parseSteps('a,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1') === null, 'custom groove text is validated');
ok(mergePrefs(JSON.stringify({ groovePreset: 'swing8', grooveSwing: '66', grooveStrength: 80, grooveSteps: '1,1.2,0.8,1,1,1,1,1,1,1,1,1,1,1,1,1' })).grooveSteps.startsWith('1,1.2') && mergePrefs(JSON.stringify({ groovePreset: 'wobble', grooveSwing: 99, grooveSteps: 'junk' })).groovePreset === 'straight' && mergePrefs(JSON.stringify({ grooveSwing: 99 })).grooveSwing === '58', 'groove preferences are validated');

// playback timing with swing on
function rowTimes(groove) {
  const r = new ModReplayer(parseMod(makeDemo()), 44100);
  if (groove) r.groove = groove;
  const L = new Float32Array(64), R = new Float32Array(64), starts = []; let frames = 0;
  const read = r.readRow.bind(r);
  r.readRow = () => { starts.push(frames / 44100); read(); };     // real row starts, not the early counter change
  while (starts.length < 5) { r.render(L, R, 64); frames += 64; }
  return starts;
}
const straight = rowTimes(null), swung = rowTimes(grooveMultipliers(sw3, 1));
const d = a => [a[1] - a[0], a[2] - a[1], a[3] - a[2], a[4] - a[3]];
ok(d(straight).every(x => Math.abs(x - 0.12) < 0.004), 'straight playback has equal 0.12 s rows (' + d(straight).map(x => x.toFixed(3)).join(', ') + ')');
ok(Math.abs(d(swung)[0] / d(swung)[1] - 2) < 0.1 && Math.abs(d(swung)[2] / d(swung)[3] - 2) < 0.1, 'swing 67% makes the long row twice the short row in real playback (' + d(swung).map(x => x.toFixed(3)).join(', ') + ')');
ok(Math.abs((swung[4] - swung[0]) - (straight[4] - straight[0])) < 0.004, 'two swung row pairs take as long as two straight ones, so tempo is unchanged');

// the length calculation follows the groove too
const gl = computeLength(parseMod(makeDemo()), grooveMultipliers(sw3, 1));
ok(Math.abs(gl.seconds - 61.44) < 0.05, 'swing does not change the song length (' + gl.seconds.toFixed(2) + ' s)');
ok(Math.abs(gl.times[1] - 0.16) < 0.005 && Math.abs(gl.times[2] - 0.24) < 0.005, 'row start times move with the swing (row 1 at 0.16 s, row 2 at 0.24 s)');

// disk op: file types, sorting, names
ok(fileKind('song.MOD') === 'mod' && fileKind('mod.axelf') === 'mod' && fileKind('old.nst') === 'mod' && fileKind('k.wav') === 'wav' && fileKind('s.8svx') === 'iff' && fileKind('s.IFF') === 'iff' && fileKind('s.raw') === 'raw' && fileKind('readme.txt') === 'other' && fileKind('noext') === 'other', 'file kinds are recognised by extension and by the Amiga mod. prefix');
const ents = [{ name: 'kick10.wav', kind: 'file' }, { name: 'Zeta', kind: 'dir' }, { name: 'kick2.wav', kind: 'file' }, { name: 'alpha', kind: 'dir' }, { name: 'Bass.wav', kind: 'file' }];
ok(sortEntries(ents).map(e => e.name).join() === 'alpha,Zeta,Bass.wav,kick2.wav,kick10.wav', 'folders come first, names sort naturally and ignore case');
ok(sampleNameFromFile('My Kick Drum Sample Long Name.wav') === 'My Kick Drum Sample Lo', 'sample names drop the extension and fit 22 characters');
ok(sampleNameFromFile('café.iff') === 'caf?' && sampleNameFromFile('a.b.wav') === 'a.b', 'sample names are plain ASCII and only the last extension is removed');

// IFF 8SVX
const iffData = Int8Array.from({ length: 200 }, (_, i) => Math.round(100 * Math.sin(i / 7)));
const looped = { name: 'sine loop', data: iffData, len: 200, ls: 40, le: 160, looped: true, vol: 48 };
const iffBuf = encodeIff8svx(looped);
const iffBack = decodeIff8svx(iffBuf);
ok(iffBack.data.length === 160 && Array.from(iffBack.data).every((v, i) => v === iffData[i]), 'an IFF 8SVX round trip keeps the sample bytes (data after the loop end is not stored)');
ok(iffBack.looped && iffBack.ls === 40 && iffBack.le === 160 && iffBack.vol === 48 && iffBack.rate === 8287, 'an IFF 8SVX round trip keeps loop points, volume and rate');
const oneShot = decodeIff8svx(encodeIff8svx({ name: '', data: iffData, len: 200, ls: 0, le: 0, looped: false, vol: 64 }));
ok(!oneShot.looped && oneShot.data.length === 200 && oneShot.vol === 64, 'an unlooped 8SVX comes back unlooped at full volume');
ok(new Uint8Array(iffBuf).length % 2 === 0 && String.fromCharCode(...new Uint8Array(iffBuf, 0, 4)) === 'FORM' && String.fromCharCode(...new Uint8Array(iffBuf, 8, 4)) === '8SVX', 'the written file is a well-formed even-length FORM 8SVX');
const comp = new Uint8Array(iffBuf.slice(0)); const cv = new DataView(comp.buffer);
for (let o = 12; o + 8 < comp.length; o += 8 + cv.getUint32(o + 4) + (cv.getUint32(o + 4) & 1)) if (String.fromCharCode(...comp.slice(o, o + 4)) === 'VHDR') comp[o + 8 + 15] = 1;
let compErr = ''; try { decodeIff8svx(comp.buffer); } catch (e) { compErr = e.message; }
ok(/compressed/i.test(compErr), 'compressed 8SVX is refused with a clear message');
let notIff = false; try { decodeIff8svx(new Uint8Array(64).buffer); } catch (e) { notIff = true; }
ok(notIff, 'a non-IFF file is refused');

// decodeSample by kind
const wav8 = encodeWav8(iffData.slice(0, 100), 8287);
ok(decodeSample('wav', wav8).data.length === 100 && decodeSample('wav', wav8).vol === null, 'WAV samples load resampled to the C-2 rate');
ok(decodeSample('raw', iffData.buffer.slice(0)).data.length === 200 && decodeSample('iff', iffBuf).looped, 'raw and IFF samples load by kind');

// auditioning raw sample data
const auditionRep = new ModReplayer(parseMod(makeDemo()), 44100);
auditionRep.previewData(iffData, 64);
const auditionBuf = new Float32Array(2048); auditionRep.renderPv(auditionBuf, auditionBuf, auditionBuf.length);
ok(auditionBuf.slice(0, 1000).some(v => Math.abs(v) > 0.01) && auditionRep.pv === null && auditionBuf.slice(1500).every(v => v === 0), 'auditioning a file plays its data once through the preview voice, then stops');
auditionRep.previewData(new Int8Array(0), 64);
ok(auditionRep.pv === null, 'auditioning an empty file stops the preview');

// tutorial card placement
const VW = 1280, VH = 800, CW = 340, CH = 180;
const inView = p => p.left >= 8 - 1e-9 && p.top >= 8 - 1e-9 && p.left + CW <= VW - 8 + 1e-9 && p.top + CH <= VH - 8 + 1e-9;
const overlaps = (p, r) => p.left < r.left + r.width && p.left + CW > r.left && p.top < r.top + r.height && p.top + CH > r.top;
const c0 = placeCard(null, CW, CH, VW, VH);
ok(c0.side === 'center' && c0.left === (VW - CW) / 2 && c0.top === (VH - CH) / 2, 'with no target the card is centred');
const topBtn = { left: 100, top: 20, width: 80, height: 30 };
const c1 = placeCard(topBtn, CW, CH, VW, VH);
ok(c1.side === 'below' && c1.top >= 50 && inView(c1) && !overlaps(c1, topBtn), 'a target near the top gets the card below it');
const botBtn = { left: 600, top: 740, width: 90, height: 40 };
const c2 = placeCard(botBtn, CW, CH, VW, VH);
ok(c2.side === 'above' && inView(c2) && !overlaps(c2, botBtn), 'a target near the bottom gets the card above it');
const c3 = placeCard({ left: 20, top: 300, width: 260, height: 120 }, CW, CH, VW, VH, 16, 'right');
ok(c3.side === 'right' && c3.left >= 296 && inView(c3), 'the preferred side is used when it fits');
const c4 = placeCard({ left: 900, top: 300, width: 300, height: 100 }, CW, CH, VW, VH, 16, 'right');
ok(c4.side !== 'right' && inView(c4), 'the preferred side is skipped when it does not fit');
const huge = { left: 0, top: 0, width: VW, height: VH };
const c5 = placeCard(huge, CW, CH, VW, VH);
ok(c5.side === 'inside' && inView(c5), 'a target filling the screen gets the card inside it');
let bad = 0, seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let i = 0; i < 500; i++) {
  const r = { left: rnd() * VW, top: rnd() * VH, width: 10 + rnd() * 700, height: 10 + rnd() * 500 };
  const p = placeCard(r, CW, CH, VW, VH, 16, ['above', 'below', 'left', 'right', undefined][i % 5]);
  if (!inView(p) || !Number.isFinite(p.left + p.top)) bad++;
}
ok(bad === 0, 'the card stays on screen for 500 random targets and preferences');
ok(mergePrefs(null).tutorialDone === false && mergePrefs(JSON.stringify({ tutorialDone: true })).tutorialDone === true && mergePrefs(JSON.stringify({ tutorialDone: 'yes' })).tutorialDone === false, 'the tutorial-seen flag defaults to false and is validated');

// projects
const pjBig = Uint8Array.from({ length: 250000 }, (_, i) => (i * 31 + (i >> 8)) & 255);
const pjBigBack = b64ToBytes(bytesToB64(pjBig));
ok(pjBigBack.length === pjBig.length && pjBigBack.every((v, i) => v === pjBig[i]), 'base64 round trip keeps 250,000 bytes exactly (no call-stack limit)');
ok(projectFileName('My Song: v2?.mod') === 'My Song_ v2_.tlp' && projectFileName('') === 'project.tlp' && projectFileName('  ') === 'project.tlp' && projectFileName('a/b' + String.fromCharCode(92) + 'c') === 'a_b_c.tlp', 'project file names are safe and end in .tlp');

const pjMod = parseMod(makeDemo());
patSetNote(pjMod.patterns[0], 4, 5, 1, 17, 3);                                  // an edit the project must carry
pjMod.samples[2].name = 'pjEdited hat';
const pjEdited = new Uint8Array(writeMod(pjMod, false)), pjPlain = new Uint8Array(makeDemo());
const pjState = { prefs: { mode: 'clean', fx: 'pt', sep: '65', groovePreset: 'swing16', grooveSwing: '62', grooveStrength: '80', grooveSteps: '1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1' },
  mute: [false, true, false, false], loop: { a: 70, b: 90, on: true }, curSample: 4, cur: { order: 1, row: 12, ch: 2, field: 3 }, pos: { order: 1, row: 20 } };
const pjText = JSON.stringify(makeProject([{ name: 'a.mod', bytes: pjPlain }, { name: 'b.mod', bytes: pjEdited }], 1, pjState, 'My project'));
const pjRead = readProject(pjText);
const pjSame = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
ok(pjRead.tracks.length === 2 && pjRead.cur === 1 && pjRead.name === 'My project' && pjRead.tracks[0].name === 'a.mod', 'a project round trip keeps song count, current song, names and project name');
ok(pjSame(pjRead.tracks[0].bytes, pjPlain) && pjSame(pjRead.tracks[1].bytes, pjEdited), 'every embedded module comes back byte for byte');
const pjBack = parseMod(pjRead.tracks[1].bytes.buffer);
ok(pjBack.samples[2].name === 'pjEdited hat' && pjBack.patterns[0][(5 * 4 + 1) * 4 + 1] === (TABLES[8][17] & 255), 'edits made before saving are in the saved song');
ok(pjRead.state.prefs.mode === 'clean' && pjRead.state.prefs.groovePreset === 'swing16' && pjRead.state.prefs.sep === '65' && pjRead.state.mute.join() === 'false,true,false,false', 'song-shaping settings and mutes are restored');
ok(pjRead.state.loop.a === 70 && pjRead.state.loop.b === 90 && pjRead.state.loop.on === true && pjRead.state.curSample === 4 && pjRead.state.cur.row === 12 && pjRead.state.pos.order === 1, 'loop region, sample, cursor and position are restored');

// project validation
const pjThrows = f => { try { f(); return ''; } catch (e) { return e.message; } };
ok(/Not a Tracklight project/.test(pjThrows(() => readProject('{oops'))) && /Not a Tracklight project/.test(pjThrows(() => readProject('{"format":"other"}'))) && /Not a Tracklight project/.test(pjThrows(() => readProject('null'))), 'garbage and other JSON files are refused');
ok(/newer version/.test(pjThrows(() => readProject(pjText.replace('"version":1', '"version":9')))), 'a project from a newer version is refused with a clear message');
ok(/no songs/.test(pjThrows(() => readProject(JSON.stringify({ format: 'tracklight-project', version: 1, tracks: [] })))), 'a project with no songs is refused');
const pjBad = JSON.parse(pjText); pjBad.tracks[1].data = bytesToB64(new Uint8Array(2000));
ok(/Song 2 \(b\.mod\)/.test(pjThrows(() => readProject(JSON.stringify(pjBad)))), 'a damaged song is named in the error (Song 2 (b.mod))');
const pjBad2 = JSON.parse(pjText); pjBad2.tracks[0].data = '***not base64***';
ok(/Song 1/.test(pjThrows(() => readProject(JSON.stringify(pjBad2)))), 'invalid base64 is reported, not thrown raw');
const pjOdd = JSON.parse(pjText); pjOdd.cur = 99;
ok(readProject(JSON.stringify(pjOdd)).cur === 0, 'an out-of-range current song falls back to the first');

// untrusted state is sanitised
const pjHostile = sanitizeProjectState({ prefs: { mode: 'rm -rf', sep: '500', fx: 'st', theme: 'amber', volume: 1, midiIn: 'x' }, mute: [1, 2], loop: { a: -3, b: 5 }, curSample: 99, cur: { order: 0, row: 70, ch: 0, field: 0 }, pos: 'now' });
ok(Object.keys(pjHostile.prefs).join() === 'fx' && pjHostile.prefs.fx === 'st', 'only valid song-shaping preferences are accepted; themes, MIDI and unknown keys are ignored');
ok(pjHostile.mute === null && pjHostile.loop === null && pjHostile.curSample === null && pjHostile.cur === null && pjHostile.pos === null, 'out-of-range mutes, loop, sample, cursor and position are dropped');
ok(JSON.stringify(sanitizeProjectState(undefined)) === JSON.stringify({ prefs: {}, mute: null, loop: null, curSample: null, cur: null, pos: null }), 'a project with no state section opens with defaults');
ok(fileKind('song.tlp') === 'proj' && fileKind('SONG.TLP') === 'proj', 'project files are recognised by extension');

// standalone player export
const vm = require('vm');
const tplText = html.match(/<script type="text\/plain" id="player-tpl">([\s\S]*?)<\/script>/)[1];
const procClass = html.match(/const PROC_CLASS = `([\s\S]*?)`;\r?\n\s+const procSrc/)[1];
const expBytes = new Uint8Array(writeMod(parseMod(makeDemo()), false));
const expConfig = { title: 'T', credit: 'by me', loop: true, theme: { acc: '#ffb000', acc2: '#ff6a3d' }, mode: 'clean', sep: 60, fx: 'auto', groove: Array.from({ length: 16 }, (_, i) => i % 2 ? 0.75 : 1.25) };
const exported = buildPlayerHtml(tplText, { title: 'T', core, procClass, bytes: expBytes, config: expConfig });
const blocks = [...exported.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].map(m => ({ attrs: m[1].trim(), body: m[2] }));
ok(blocks.length === 5 && blocks.map(b => b.attrs.replace(/\s*id="\w+"\s*/, '').trim() || 'classic').join('|') === 'classic|type="text/plain"|type="application/json"|type="text/plain"|classic', 'the export has exactly five script blocks: engine, worklet class, settings, song, player');
ok(!exported.includes('{{') && /<title>T<\/title>/.test(exported) && exported.startsWith('<!doctype html>'), 'every placeholder is filled and the page has its title');
const [bCore, bProc, bCfg, bMod, bMain] = blocks.map(b => b.body);
ok(JSON.stringify(JSON.parse(bCfg)) === JSON.stringify(expConfig), 'the embedded settings parse back exactly');
const embedded = b64ToBytes(bMod.trim());
ok(embedded.length === expBytes.length && embedded.every((v, i) => v === expBytes[i]), 'the embedded song is the exact module bytes');
let syntax = 'ok';
try { new vm.Script(bCore); new vm.Script(bCore + bProc); new vm.Script(bMain); } catch (e) { syntax = e.message; }
ok(syntax === 'ok', 'the engine, the worklet source and the player script all compile (' + syntax + ')');
ok(bCore === core && bProc === procClass, 'the engine and worklet text are embedded unchanged');
ok(!/<\/script|<!--/i.test(core) && !/<\/script|<!--/i.test(procClass), 'the engine text never contains a script terminator or comment opener, so it can be embedded as is');

// run the exported engine in a clean sandbox, with nothing from the app available
const sandbox = { atob, btoa, TextEncoder, Math, Float32Array, Int8Array, Uint8Array, Uint8Array, Set, Map, Number, JSON, String, Array, Object, Date, Error };
vm.createContext(sandbox);
const lib = vm.runInContext(bCore + ';({ parseMod, ModReplayer, computeLength, b64ToBytes })', sandbox);
const exMod = lib.parseMod(lib.b64ToBytes(bMod.trim()).buffer);
ok(exMod.nch === 4 && exMod.songLen === 8 && exMod.patterns.length === 4, 'the embedded song loads in a sandbox that has only the exported engine');
const exRep = new lib.ModReplayer(exMod, 44100), exL = new Float32Array(44100 * 2), exR = new Float32Array(44100 * 2);
exRep.groove = Float32Array.from(expConfig.groove); exRep.render(exL, exR, exL.length);
ok(exL.some(v => Math.abs(v) > 0.05) && exL.every(Number.isFinite), 'the exported engine plays the embedded song with the exported groove');
ok(Math.abs(lib.computeLength(exMod, Float32Array.from(expConfig.groove)).seconds - 61.44) < 0.1, 'the exported engine measures the song length the same as the app (61.44 s)');

// hostile text can never break out of its block
const evil = '</script><script>alert(1)</script><!-- $& $1 {{CORE}} "quoted"';
const evilHtml = buildPlayerHtml(tplText, { title: evil, core, procClass, bytes: expBytes, config: { ...expConfig, title: evil, credit: evil } });
const evilBlocks = [...evilHtml.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
ok(evilBlocks.length === 5, 'a title and credit full of script tags still leave exactly five script blocks');
ok(JSON.parse(evilBlocks[2][2]).credit === evil && JSON.parse(evilBlocks[2][2]).title === evil, 'hostile text survives the settings round trip intact');
ok(/<title>&lt;\/script&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;&lt;!-- \$&amp; \$1 \{\{CORE\}\} &quot;quoted&quot;<\/title>/.test(evilHtml), 'the page title is HTML-escaped and special replacement patterns stay literal');
ok(!/<script>\s*alert/.test(evilHtml) && !evilHtml.includes('<!--'), 'no injected script or comment opener reaches the page');

// A500 output filter: a 6 dB/octave low-pass at 1/(2*pi*360 ohm*0.1 uF) = 4421 Hz
const a500 = new ModReplayer(parseMod(makeDemo()), 44100);
const hardwareHz = 1 / (2 * Math.PI * 360 * 0.1e-6);
const gainAt = (hz) => {            // steady-state gain of the replayer's own one-pole filter at a given frequency
  let y = 0, peak = 0;
  for (let i = 0; i < 44100; i++) { y += a500.a1 * (Math.sin(2 * Math.PI * hz * i / 44100) - y); if (i > 20000) peak = Math.max(peak, Math.abs(y)); }
  return peak;
};
ok(Math.abs(hardwareHz - 4421) < 1, 'the A500 filter corner works out to 4421 Hz from R=360 ohm and C=0.1 uF');
ok(Math.abs(gainAt(4421) - Math.SQRT1_2) < 0.06, 'the A500 filter is about -3 dB at 4421 Hz (gain ' + gainAt(4421).toFixed(3) + ')');
ok(gainAt(400) > 0.98 && gainAt(8842) < 0.5 && gainAt(8842) > 0.35, 'the A500 filter passes bass and falls about 6 dB per octave above the corner (gain at 8842 Hz ' + gainAt(8842).toFixed(3) + ')');
ok(Math.abs(a500.a1 - (1 - Math.exp(-2 * Math.PI * 4421 / 44100))) < 1e-12, 'the filter uses the 4421 Hz coefficient');

// ProTracker 2.3 behaviours documented in OpenMPT's MOD test cases (https://wiki.openmpt.org/Development:_Test_Cases/MOD).
// The modules here are built from those written descriptions, not copied from OpenMPT's files.
{
  const quiet = () => { const m = parseMod(makeDemo()); m.patterns.forEach(p => p.fill(0)); return m; };   // demo samples: 1-3 one-shots, 4 and 5 looped
  const put = (m, row, ch, o) => {
    const d = m.patterns[m.orders[0]];
    if (o.idx !== undefined) patSetNote(d, 4, row, ch, o.idx, o.smp || 0);
    else if (o.smp) { patSetNibble(d, 4, row, ch, 1, o.smp >> 4); patSetNibble(d, 4, row, ch, 2, o.smp & 15); }
    if (o.cmd !== undefined) { patSetNibble(d, 4, row, ch, 3, o.cmd); patSetNibble(d, 4, row, ch, 4, (o.par || 0) >> 4); patSetNibble(d, 4, row, ch, 5, (o.par || 0) & 15); }
  };
  const ticks = (r, n) => { for (let i = 0; i < n; i++) r.stepTick(); };   // row k starts on tick 6k+1 at the default speed of 6
  const frames = (r, n) => { const a = new Float32Array(n); r.render(a, new Float32Array(n), n); };

  // PatternJump.mod: Bxx cancels a Dxx to its left
  let m = quiet(); put(m, 0, 0, { cmd: 13, par: 0x10 }); put(m, 0, 1, { cmd: 11, par: 2 });
  let r = new ModReplayer(m, 44100); ticks(r, 6);
  ok(r.order === 2 && r.row === 0, 'a Bxx to the right of a Dxx cancels the break row: the jump lands on row 0 of order 2 (order ' + r.order + ' row ' + r.row + ')');
  m = quiet(); put(m, 0, 0, { cmd: 11, par: 2 }); put(m, 0, 1, { cmd: 13, par: 0x10 });
  r = new ModReplayer(m, 44100); ticks(r, 6);
  ok(r.order === 2 && r.row === 10, 'a Dxx to the right of a Bxx still sets the row in the jumped-to pattern (order ' + r.order + ' row ' + r.row + ')');

  // PortaTarget.mod: reaching the target clears it
  m = quiet(); put(m, 0, 0, { idx: 12, smp: 4 }); put(m, 1, 0, { idx: 14, smp: 0, cmd: 3, par: 0x40 });
  r = new ModReplayer(m, 44100); ticks(r, 7);
  const pc = r.ch[0];
  ok(pc.target === TABLES[8][14] && pc.period === TABLES[8][12], 'a note beside 3xx sets the slide target without retriggering');
  ticks(r, 1);
  ok(pc.period === TABLES[8][14] && pc.target === 0, 'the slide stops on the target and forgets it');
  pc.period = 400; ticks(r, 1);
  ok(pc.period === 400, 'a later 3xx does not slide back to a target that was already reached');

  // PTRetrigger.mod: E9x retriggers on tick 0 of a row with no note
  m = quiet(); put(m, 0, 0, { idx: 12, smp: 4 }); put(m, 1, 0, { cmd: 14, par: 0x93 });
  r = new ModReplayer(m, 44100); ticks(r, 1); r.ch[0].pos = 30; ticks(r, 5); ticks(r, 1);
  ok(r.ch[0].pos === 0, 'E93 on a row without a note retriggers the sample on tick 0');
  m = quiet(); put(m, 0, 0, { idx: 12, smp: 4 }); put(m, 1, 0, { cmd: 14, par: 0x90 });
  r = new ModReplayer(m, 44100); ticks(r, 1); r.ch[0].pos = 30; ticks(r, 6);
  ok(r.ch[0].pos === 30, 'E90 does not retrigger');
  m = quiet(); put(m, 0, 0, { idx: 12, smp: 4 }); put(m, 1, 0, { cmd: 14, par: 0x93 });
  r = new ModReplayer(m, 44100); ticks(r, 7); r.ch[0].pos = 30; ticks(r, 2);   // tick 2 of the row: 2 % 3 != 0, no retrigger yet
  ok(r.ch[0].pos === 30, 'between multiples of the interval nothing retriggers');
  ticks(r, 1);
  ok(r.ch[0].pos === 0, 'it retriggers again on tick 3 (tick modulo interval = 0)');

  // TempoChange.mod: the new tempo starts after the tick it is set on
  m = quiet(); put(m, 0, 0, { cmd: 15, par: 250 });
  r = new ModReplayer(m, 44100); r.speed = 1;
  const starts = []; let fr = 0; const rd = r.readRow.bind(r);
  r.readRow = () => { starts.push(fr / 44100); rd(); };
  while (starts.length < 3) { frames(r, 64); fr += 64; }
  ok(Math.abs(starts[1] - starts[0] - 0.02) < 0.003 && Math.abs(starts[2] - starts[1] - 0.01) < 0.003, 'with one tick per row the row that sets tempo 250 still lasts 20 ms; the next lasts 10 ms (' + (starts[1] - starts[0]).toFixed(3) + ', ' + (starts[2] - starts[1]).toFixed(3) + ' s)');
  m = quiet(); put(m, 0, 0, { cmd: 15, par: 250 }); put(m, 0, 1, { cmd: 15, par: 1 });
  const cl = computeLength(m);
  ok(Math.abs(cl.times[1] - 0.02) < 1e-9 && Math.abs(cl.times[2] - 0.03) < 1e-9, 'the length calculation applies the same rule, so seek times match playback (' + cl.times[1] + ', ' + cl.times[2] + ')');

  // PatternDelaysRetrig.mod: fine slides and note delays run on every repeat of a delayed row
  m = quiet(); put(m, 0, 0, { idx: 12, smp: 4 }); put(m, 1, 0, { cmd: 14, par: 0x12 }); put(m, 1, 1, { cmd: 14, par: 0xE2 });
  r = new ModReplayer(m, 44100); let guard = 0; while (r.row < 2 && guard++ < 60) r.stepTick();
  ok(r.ch[0].period === 428 - 6, 'a fine slide up by 2 on a row repeated three times by EE2 slides 6 in total (period ' + r.ch[0].period + ')');
  m = quiet(); put(m, 1, 0, { idx: 12, smp: 4, cmd: 14, par: 0xD2 }); put(m, 1, 1, { cmd: 14, par: 0xE1 });
  r = new ModReplayer(m, 44100); let trigs = 0; const tg = r.trig.bind(r); r.trig = (...a) => { trigs++; return tg(...a); };
  guard = 0; while (r.row < 2 && guard++ < 60) r.stepTick();
  ok(trigs === 2, 'a delayed note on a row repeated once by EE1 is triggered on each repetition (' + trigs + ' triggers)');

  // ArpWraparound.mod: arpeggio past the end of the period table
  m = quiet(); put(m, 0, 0, { idx: 35, smp: 4, cmd: 0, par: 0x12 });
  r = new ModReplayer(m, 44100); ticks(r, 2);
  ok(r.ch[0].outPeriod === 0 && r.ch[0].step < 0.002, 'an arpeggio step one past the last note plays period 0, which the hardware treats as 65536 (very low)');
  ticks(r, 1);
  ok(r.ch[0].outPeriod === TABLES[9][0], 'the next step wraps into the following finetune row (period ' + r.ch[0].outPeriod + ')');
  ticks(r, 1);
  ok(r.ch[0].outPeriod === TABLES[8][35], 'tick 3 is back on the base note');

  // PortaSmpChange.mod / PTInstrSwap.mod / InstrDelay.mod / PTStoppedSwap.mod / PTSwapNoLoop.mod: deferred sample changes
  const bass = parseMod(makeDemo()).samples[3].data, lead = parseMod(makeDemo()).samples[4].data;
  m = quiet(); put(m, 0, 0, { idx: 12, smp: 4 }); put(m, 1, 0, { smp: 5 });
  r = new ModReplayer(m, 44100); ticks(r, 7);
  ok(r.ch[0].smp === 4 && r.ch[0].data.length === bass.length && r.ch[0].pend && r.ch[0].pend.data.length === lead.length, 'a sample number without a note does not switch sample at once: the old one keeps playing and the new one waits');
  guard = 0; while (r.ch[0].pend && guard++ < 400) frames(r, 16);
  ok(!r.ch[0].pend && r.ch[0].data.length === lead.length && r.ch[0].looped && r.ch[0].pos < 8, 'the new sample takes over at the end of the old loop, starting at its loop start');
  frames(r, 2000);
  ok(r.ch[0].active && r.ch[0].pos >= r.ch[0].ls && r.ch[0].pos < r.ch[0].le, 'and then keeps looping inside its own loop');
  m = quiet(); put(m, 0, 0, { idx: 12, smp: 4 }); put(m, 1, 0, { smp: 3 });
  r = new ModReplayer(m, 44100); ticks(r, 7); guard = 0; while (r.ch[0].active && guard++ < 400) frames(r, 16);
  ok(!r.ch[0].active, 'swapping to a sample that does not loop makes the channel stop at the end of the current loop');
  m = quiet(); put(m, 0, 0, { idx: 12, smp: 3 }); put(m, 1, 0, { smp: 5 });
  r = new ModReplayer(m, 44100); r.speed = 31; ticks(r, 1);
  guard = 0; while (r.ch[0].active && guard++ < 2000) frames(r, 16);
  ok(!r.ch[0].active && r.ch[0].dma, 'a one-shot sample runs out but the channel stays alive');
  guard = 0; while (!(r.row >= 1 && r.counter >= 1) && guard++ < 4000) frames(r, 64);   // the row counter moves on one tick before the row is read
  ok(r.ch[0].active && r.ch[0].data.length === lead.length && r.ch[0].pos >= 0 && r.ch[0].pos < r.ch[0].le, 'a looped sample swapped in after the old one has stopped starts playing straight away');
  m = quiet(); put(m, 0, 0, { smp: 5 });
  r = new ModReplayer(m, 44100); ticks(r, 1);
  ok(!r.ch[0].active && !r.ch[0].dma, 'a sample number on a channel that never played does not start anything');
  m = quiet(); put(m, 0, 0, { idx: 12, smp: 4 }); put(m, 1, 0, { smp: 5 }); put(m, 2, 0, { idx: 12, smp: 4 });
  r = new ModReplayer(m, 44100); ticks(r, 7); const waiting = !!r.ch[0].pend; ticks(r, 6);
  ok(waiting && r.ch[0].pend === null && r.ch[0].data.length === bass.length && r.ch[0].pos === 0, 'a new note cancels a waiting swap and plays its own sample');
  m = quiet(); put(m, 0, 0, { idx: 12, smp: 4 }); put(m, 1, 0, { idx: 14, smp: 5, cmd: 3, par: 0x10 });
  r = new ModReplayer(m, 44100); ticks(r, 7);
  ok(r.ch[0].data.length === bass.length && r.ch[0].pend && r.ch[0].pend.data.length === lead.length, 'a note with a sample number beside a tone portamento queues the sample and slides the old one');
  m = quiet(); put(m, 0, 0, { idx: 14, smp: 5 }); put(m, 1, 0, { idx: 12, smp: 4, cmd: 14, par: 0xD3 });
  r = new ModReplayer(m, 44100); ticks(r, 7);
  ok(r.ch[0].pend && r.ch[0].pend.data.length === bass.length && r.ch[0].smp === 3, 'a delayed note loads its sample number on tick 0 but waits to play it');
}

process.exit(fail);
