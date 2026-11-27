// makefun-diff, faster: a drop-in for makefun-diff 1.0.0 (make.fun's own line diff, MIT, derived from
// jsdiff 9.0.0) that returns byte-identical patches, faster. Written from the rule in the house
// baseline's vendor/makefun-diff/index.js header: lines cut after every "\n"; two lines equal only when
// the same code units, newline or its absence included; the edit script keeps the common prefix, then
// the common suffix, and between them runs Myers's greedy search that keeps on each diagonal the path
// furthest into the old text, taking the deletion when a deletion and an insertion reach the same
// point, never moving past either text's end, pruning no edge diagonal, and following every run of
// equal lines as far as it goes; the first path to reach both ends is the script. The patch is
// "makefun-diff/1 old=N new=M hunks=H deleted=D inserted=I", then per hunk "@ os ol ns nl" and one line
// per covered line ("=" kept, "-" deleted, "+" inserted; deletions before insertions in each change
// run; up to 3 kept lines before and after each run; runs at most 6 kept lines apart share a hunk). A
// last line with no newline is written with one and followed by "%". Identical texts are the first
// line alone.
//
// Speed: lines are interned to small integers once (shared tables for both texts, keyed by the
// content the split already made, so equality is a single integer compare), the prefix and suffix
// only the furthest old position per diagonal in typed arrays — no path objects, no per-step
// allocation — with the edit script rebuilt afterwards by walking the stored positions back. The patch
// is then formatted exactly as the reference formats it. Each case is answered alone: the intern
// table is built fresh inside run(), nothing is carried from one case to the next.

/** The patch's first word. */
const FORMAT = 'makefun-diff/1';

/** The kept lines a hunk shows before and after each change run. */
const CONTEXT = 3;

/** Run kinds: kept, deleted, inserted. */
const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/**
 * A text's lines as small integers, each line's string interned once in the tables shared by both
 * texts (mapNL: a line with its "\n", keyed by its content without it; mapBare: a last line with no
 * newline, keyed by its content; strs: id -> the line string). Two tables keep a line with a
 * newline apart from the same content without one. A line keeps its "\n", except a last line with
 * no newline; the empty text has no lines, "\n" has one, an empty line. Keying on the content the
 * split already made avoids building a new string for every line: the full line is built only the
 * first time its content is seen.
 */
function tokenize(text, mapNL, mapBare, strs) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  const ids = new Int32Array(last + (parts[last] !== '' ? 1 : 0));
  let j = 0;
  for (let i = 0; i < last; i++) {
    const content = parts[i];
    let id = mapNL.get(content);
    if (id === undefined) {
      id = strs.length;
      mapNL.set(content, id);
      strs.push(content + '\n');
    }
    ids[j++] = id;
  }
  if (parts[last] !== '') {
    const content = parts[last];
    let id = mapBare.get(content);
    if (id === undefined) {
      id = strs.length;
      mapBare.set(content, id);
      strs.push(content);
    }
    ids[j++] = id;
  }
  return ids;
}

/**
 * The edit script's runs for the trimmed middle, as [{ kind, count }] in order: the same search the
 * reference runs, with the same tie-break, on integer lines. Vs[d] holds, per diagonal k (index
 * k + d), the old position (last old line consumed, -1 for none) of the furthest path of d edits
 * after following its run of equal lines, stored + 2 so that 0 means the diagonal has no path and a
 * fresh array needs no fill (old positions stay below 65534: the middle holds at most 40,000 lines).
 * The search keeps every diagonal: d = 0, 1, 2, ... and k = -d, -d + 2, ..., d, and the first (d, k)
 * whose path reaches both ends is the script. Backtracking replays the same choice at each step from
 * the stored positions, so the runs are the reference's runs exactly.
 */
function editRuns(A, B) {
  const N = A.length;
  const M = B.length;
  if (N === 0 && M === 0) return [];
  const Vs = [];
  // d = 0: the path from the first lines, following equal lines as far as they go.
  const V0 = new Uint16Array(1);
  let x = -1;
  const end0 = N < M ? N : M;
  while (x + 1 < end0 && A[x + 1] === B[x + 1]) x++;
  V0[0] = x + 2;
  Vs.push(V0);
  if (x + 1 >= N && x + 1 >= M) return backtrack(Vs, A, B, 0, 0);
  let D = 0;
  let kF = 0;
  for (let d = 1; d <= N + M; d++) {
    const Vp = Vs[d - 1];
    const V = new Uint16Array(2 * d + 1);
    let done = false;
    // The insertion candidate on k + 1 of one step is the deletion candidate on k + 1 of the
    // next (k + 2), so it is carried over instead of read again: carry is the deletion candidate,
    // av the insertion candidate, of the diagonal being computed.
    let carry = 0;
    let av = Vp[0];
    for (let k = -d; k <= d; k += 2) {
      // The (d - 1) paths: the deletion's on k - 1 (absent at k = -d), the insertion's on k + 1
      // (absent at k = d). A move past either text's end is no candidate.
      const rv = carry;
      const cav = av;
      carry = av;
      av = k + 2 < d ? Vp[k + d + 2] : 0;
      const canRemove = rv !== 0 && rv <= N;
      const canAdd = cav !== 0 && cav < M + k + 2;
      if (!canRemove && !canAdd) continue;
      // The candidate further into the old text, and the deletion when both reach one point:
      // the deletion's old position after its step is rv - 1, the insertion's is cav - 2.
      let p;
      if (canRemove && (!canAdd || rv + 1 >= cav)) p = rv - 1;
      else p = cav - 2;
      // Follow the run of equal lines as far as it goes (diagonal k: new index = old index - k).
      let xx = p;
      let yy = p - k;
      const end = N < M + k ? N : M + k;
      while (xx + 1 < end && A[xx + 1] === B[yy + 1]) {
        xx++;
        yy++;
      }
      V[k + d] = xx + 2;
      if (xx + 1 >= N && xx + 1 - k >= M) {
        D = d;
        kF = k;
        done = true;
        break;
      }
    }
    Vs.push(V);
    if (done) break;
  }
  return backtrack(Vs, A, B, D, kF);
}

/**
 * The runs of the path that reached both ends, rebuilt by walking the stored positions back from
 * (D, kF) to d = 0. At each step the parent is the same choice the forward search made (replayed
 * from the stored (d - 1) positions); the step contributes its one edit and then the run of equal
 * lines the forward search followed after it. Adjacent runs of one kind merge, as the reference's
 * path components do.
 */
function backtrack(Vs, A, B, D, kF) {
  const N = A.length;
  const M = B.length;
  const segs = [];
  let k = kF;
  for (let d = D; d >= 1; d--) {
    const V = Vs[d];
    const p = V[k + d] - 2;
    const Vp = Vs[d - 1];
    const rv = k > -d ? Vp[k + d - 2] : 0;
    const av = k < d ? Vp[k + d] : 0;
    const r = rv - 2;
    const canRemove = rv !== 0 && rv <= N;
    const canAdd = av !== 0 && av < M + k + 2;
    if (canRemove && (!canAdd || rv + 1 >= av)) {
      // A deletion: one old line gone (index r + 1), then the equal run after it, p - (r + 1) lines.
      const snake = p - (r + 1);
      if (snake > 0) segs.push([KEEP, snake]);
      segs.push([DELETE, 1]);
      k = k - 1;
    } else {
      // An insertion: one new line in (index ap - k), then the equal run after it, p - ap lines.
      const snake = p - (av - 2);
      if (snake > 0) segs.push([KEEP, snake]);
      segs.push([INSERT, 1]);
      k = k + 1;
    }
  }
  // d = 0: the opening run of equal lines, p0 + 1 of them.
  const p0 = Vs[0][0] - 2;
  if (p0 >= 0) segs.push([KEEP, p0 + 1]);
  segs.reverse();
  const runs = [];
  for (let i = 0; i < segs.length; i++) {
    const kind = segs[i][0];
    const count = segs[i][1];
    const last = runs[runs.length - 1];
    if (last !== undefined && last.kind === kind) last.count += count;
    else runs.push({ kind, count });
  }
  return runs;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line) {
  return line.endsWith('\n') ? op + line : op + line + '\n%\n';
}

/**
 * make.fun's own patch of the two texts, from their line ids and the interned line strings: the
 * change runs, each a stretch of deletions and insertions between two kept lines, grouped into
 * hunks that hold every run with up to 3 kept lines before and after it, two runs at most 6 kept
 * lines apart sharing one.
 */
function patch(a, b, strs, runs) {
  const n = a.length;
  const m = b.length;
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }
  const hunks = [];
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (let hi = 0; hi < hunks.length; hi++) {
    const h = hunks[hi];
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (let ci = 0; ci < h.length; ci++) {
      const c = h[ci];
      for (; at < c.o; at++) out.push(written('=', strs[a[at]]));
      for (let j = 0; j < c.dels; j++) out.push(written('-', strs[a[c.o + j]]));
      for (let j = 0; j < c.ins; j++) out.push(written('+', strs[b[c.p + j]]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', strs[a[at]]));
  }
  return out.join('');
}

/** makefun-diff 1.0.0's answer for one case's input: make.fun's own patch of { old, new }. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const strs = [];
  const mapNL = new Map();
  const mapBare = new Map();
  const a = tokenize(input.old, mapNL, mapBare, strs);
  const b = tokenize(input.new, mapNL, mapBare, strs);
  const n = a.length;
  const m = b.length;
  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  const mid = editRuns(a.subarray(prefix, n - suffix), b.subarray(prefix, m - suffix));
  for (let i = 0; i < mid.length; i++) runs.push(mid[i]);
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });
  return patch(a, b, strs, runs);
}
