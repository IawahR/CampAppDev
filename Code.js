function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('IAWAH Activity Scheduler (Testing)')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ── Storage layout ────────────────────────────────────────────────────────────
//
//   A1 = G  (global: activities, areas, nextId)
//   B1 = S  (season: year, weekDates, weekSummaries)
//   Column C = Week 1 data     (chunked down the column: C1, C2, C3, …)
//   Column D = Week 2 data
//   Column E = Week 3 data
//   Column F = Week 5 data     (Week 4 is not used at IAWAH)
//   Column G = Week 6 data
//   Column H = Week 7 data
//
// A Google Sheets cell holds at most 50,000 characters. A busy camp week
// (100+ campers with assignments) exceeds that as ONE JSON string, and
// setValue() THROWS — which made every save of that week fail (July 19).
// So each week's JSON is split into <=45,000-char chunks written down its
// column. Chunks are prefixed with "~" so a chunk that happens to start
// with "=" can never be interpreted as a formula. Reads accept both the
// chunked format and the old single-cell format (a bare "{...}" in row 1).
//
// OLD layout (3 cells): A1=G, B1=WD_all_weeks, C1=S
// Migration happens automatically on first load with new code.

var SHEET_ID = '1LrhFpV77zQ3CdHgT9jJGcG5J29P7imNxgLhIcjBssnI';
var TAB      = 'AppData';

var WEEKS_ORDERED = ['Week 1','Week 2','Week 3','Week 5','Week 6','Week 7'];
var WEEK_COLS     = { 'Week 1':'C','Week 2':'D','Week 3':'E','Week 5':'F','Week 6':'G','Week 7':'H' };

var CHUNK_SIZE = 45000;  // margin under the 50k cell limit
var MAX_CHUNKS = 50;     // 50 x 45k = 2.25M chars per week — far beyond any real week

function tab_() {
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB);
  if (!sh) throw new Error('Tab not found: ' + TAB);
  // getRange('E1:E50') THROWS if the sheet's grid is smaller than the range,
  // so make sure the grid can hold MAX_CHUNKS rows and all week columns.
  if (sh.getMaxRows() < MAX_CHUNKS) sh.insertRowsAfter(sh.getMaxRows(), MAX_CHUNKS - sh.getMaxRows());
  if (sh.getMaxColumns() < 8) sh.insertColumnsAfter(sh.getMaxColumns(), 8 - sh.getMaxColumns());
  return sh;
}

// Read a week's JSON from its column, handling both formats:
// old single cell (row 1 starts with "{") and chunked ("~"-prefixed cells).
// Also reports how many rows the stored value occupies, so a later write only
// has to blank the rows that really held data.
function readWeekColInfo_(sh, col) {
  var vals = sh.getRange(col + '1:' + col + MAX_CHUNKS).getValues();

  // `rows` is the LAST occupied row, not the length of the contiguous prefix.
  // writeWeekCol_ uses it as the clear bound, and a populated row sitting BELOW
  // a blank must still be blanked. The old code wrote all 50 rows on every save
  // and so self-healed a gapped column by construction; writing only
  // max(prevRows, chunks) removes that, and an orphan tail then gets
  // concatenated onto a later, shorter value and read back as unparseable JSON.
  // Reading still stops at the first blank, so read semantics are unchanged.
  var last = 0;
  for (var r = vals.length - 1; r >= 0; r--) {
    var vr = vals[r][0];
    if (vr !== '' && vr != null) { last = r + 1; break; }
  }

  var first = vals[0][0];
  if (first === '' || first == null) return { json: '', rows: last };
  first = String(first);
  if (first.charAt(0) !== '~') return { json: first, rows: last };  // old single-cell format
  var out = '';
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i][0];
    if (v === '' || v == null) break;
    out += String(v).slice(1);  // strip "~" prefix
  }
  return { json: out, rows: last };
}

function readWeekCol_(sh, col) {
  return readWeekColInfo_(sh, col).json;
}

// Write a week's JSON into its column as "~"-prefixed chunks, clearing any
// leftover rows from a previous longer value. Never splits a surrogate pair.
//
// prevRows is how many rows the value being replaced occupied. Only rows
// 1..max(prevRows, newChunks) are touched: a typical week needs 2, so writing
// all 50 shipped ~48 pointless empty cells to Sheets while holding the lock.
// Omit prevRows and it falls back to writing everything, which is what the
// migration path needs against a column with arbitrary leftovers.
function writeWeekCol_(sh, col, json, prevRows) {
  var chunks = [];
  var i = 0;
  while (i < json.length) {
    var end = Math.min(i + CHUNK_SIZE, json.length);
    // Don't split a UTF-16 surrogate pair across cells.
    var c = json.charCodeAt(end - 1);
    if (end < json.length && c >= 0xD800 && c <= 0xDBFF) end--;
    chunks.push('~' + json.slice(i, end));
    i = end;
  }
  if (chunks.length > MAX_CHUNKS) throw new Error('Week data too large to store (' + json.length + ' chars).');
  var used = (prevRows == null) ? MAX_CHUNKS : Math.max(prevRows, chunks.length);
  if (used < 1) used = 1;                      // never build an empty range
  if (used > MAX_CHUNKS) used = MAX_CHUNKS;
  var rows = [];
  for (var r = 0; r < used; r++) rows.push([r < chunks.length ? chunks[r] : '']);
  sh.getRange(col + '1:' + col + used).setValues(rows);
}

// ── Migration ─────────────────────────────────────────────────────────────────

// Detects the old 3-column format and rewrites the sheet into the new layout.
// Safe to call repeatedly — skips if already migrated.
function migrate_(sh) {
  var b1 = sh.getRange('B1').getValue() || '{}';
  var b1Parsed = {};
  try { b1Parsed = JSON.parse(b1); } catch(e) {}

  // Old format: B1 contains the whole WD blob, keyed by "Week N"
  var isOldFormat = !!(b1Parsed['Week 1'] || b1Parsed['Week 2'] || b1Parsed['Week 3']);
  if (!isOldFormat) return; // Already migrated

  var c1 = sh.getRange('C1').getValue() || '{}'; // Old S was in C1

  // Write S to B1
  sh.getRange('B1').setValue(c1);

  // Write each week into its own column
  WEEKS_ORDERED.forEach(function(w) {
    var weekData = b1Parsed[w];
    if (weekData) writeWeekCol_(sh, WEEK_COLS[w], JSON.stringify(weekData));
  });

  // Clear the now-empty old C1
  sh.getRange('C1').setValue('');
  SpreadsheetApp.flush();
}

// ── Read functions ────────────────────────────────────────────────────────────

// Startup load: returns only G and S (fast — two cells).
// The app uses this on initial page load and shows the week selector.
// Individual weeks are loaded on demand when selected.
function loadInit() {
  var sh = tab_();
  migrate_(sh); // no-op if already on new format
  var vals = sh.getRange('A1:B1').getValues()[0];
  return { G: vals[0] || '{}', S: vals[1] || '{}' };
}

// Load one week's data (called when the user selects a week).
function loadWeek(weekName) {
  var col = WEEK_COLS[weekName];
  if (!col) throw new Error('Unknown week: ' + weekName);
  return readWeekCol_(tab_(), col) || '{}';
}

// Poll load: returns G, S, and one week (the active week on that device).
// Called every 30 s instead of loading all weeks.
function pollData(weekName) {
  var sh   = tab_();
  var col  = WEEK_COLS[weekName];
  if (!col) throw new Error('Unknown week: ' + weekName);
  var meta = sh.getRange('A1:B1').getValues()[0];
  var wk   = readWeekCol_(sh, col) || '{}';
  return { G: meta[0] || '{}', S: meta[1] || '{}', WK: wk };
}

// ── Write functions ───────────────────────────────────────────────────────────
//
// Everything below runs while holding a SCRIPT-WIDE lock. Google documents
// getScriptLock as global: "A code section guarded by a script lock cannot be
// executed simultaneously regardless of the identity of the user." So one
// device's lock hold is every other device's wait, and LockService offers no
// per-week scope to shard it. Three rules therefore apply throughout:
//
//   1. Parse client-supplied JSON BEFORE waitLock. It doesn't depend on server
//      state, so no other device should wait for it.
//   2. Take the fast path when the stored copy is byte-identical to the base
//      the client sent: nobody else touched the data, so the incoming state is
//      a clean descendant. Any mismatch falls through to the full three-way
//      merge, so this can only ever be an optimization.
//   3. Write only what changed, and flush only if something was written. The
//      flush decision is EXECUTION-WIDE, never per-cell: releaseLock() runs in
//      the finally before the execution's implicit commit, so writing without
//      flushing would let the next device merge against a stale cell.

// Pure: returns the merged week OBJECT (caller stringifies). Returning the
// object rather than a string is what lets the summary derivation below read
// camper counts on both paths without re-parsing.
function mergeWeekObj_(srvJson, incWK, baseWK, wkBase) {
  if (baseWK && srvJson === wkBase) return incWK;   // fast path
  return baseWK ? mergeWeek_(safeparse_(srvJson), baseWK, incWK) : incWK;
}

// Pure: returns the merged G object.
function mergeGObj_(srvJson, incG, baseG, gBase) {
  if (baseG && srvJson === gBase) return incG;      // fast path
  return baseG ? mergeG_(safeparse_(srvJson), baseG, incG) : incG;
}

// weekSummaries is SERVER-DERIVED. The client only ever authors the entry for
// the week it has open, but it round-trips the whole season blob, so its copy
// of every other week is stale-but-present, not absent. Any "incoming wins for
// what it carries" rule therefore lets a stale count overwrite a fresh one.
// Instead the server owns the value and recomputes it here, from the week data
// it is already writing.
//
// Returns the season JSON unchanged when nothing moved, so the caller's
// change-gate and the empty-string response both still work.
function withDerivedSummary_(srvSJson, weekName, weekObj) {
  // Do NOT use safeparse_ here. It returns {} on a parse failure, and building a
  // fresh summaries object on that empty base would write back a season blob
  // with the camp year and every week date gone. saveWeek never used to touch
  // B1 at all, so a corrupt B1 used to self-heal on the next saveMeta; leave it
  // exactly as found instead, mirroring seasonWithServerSummaries_'s escape.
  var s;
  try { s = JSON.parse(srvSJson || '{}'); } catch (e) { return srvSJson; }
  if (!s || typeof s !== 'object') return srvSJson;
  var sr = (weekObj && weekObj.campers)   ? weekObj.campers.length   : 0;
  var jr = (weekObj && weekObj.jrCampers) ? weekObj.jrCampers.length : 0;
  var cur = s.weekSummaries && s.weekSummaries[weekName];
  if (cur && cur.sr === sr && cur.jr === jr) return srvSJson;  // unchanged: preserve bytes
  if (!s.weekSummaries) s.weekSummaries = {};
  s.weekSummaries[weekName] = { sr: sr, jr: jr };
  return JSON.stringify(s);
}

// Incoming season data wins for year/weekDates, but never for weekSummaries.
//
// Mutates the incoming object's summary VALUES in place rather than replacing
// the weekSummaries object: deleting and reassigning the key would move it to
// the end of the key order, so the re-stringified blob would differ from what
// the client sent even when the content is identical, permanently defeating
// the change-gate and the empty-string response for S.
function seasonWithServerSummaries_(srvSJson, incSJson) {
  var srv = safeparse_(srvSJson);
  var srvSum = srv.weekSummaries;
  if (!srvSum) return incSJson;               // server has none yet: seed from client
  var inc = safeparse_(incSJson);
  if (!inc.weekSummaries) inc.weekSummaries = {};
  var out = inc.weekSummaries, changed = false;
  Object.keys(out).forEach(function(w) {
    if (srvSum[w] !== undefined && JSON.stringify(out[w]) !== JSON.stringify(srvSum[w])) {
      out[w] = srvSum[w];                     // server wins, value replaced in place
      changed = true;
    }
  });
  Object.keys(srvSum).forEach(function(w) {
    if (out[w] === undefined) { out[w] = srvSum[w]; changed = true; }
  });
  return changed ? JSON.stringify(inc) : incSJson;
}

// Save G and/or S.
//
// Each field comes back as '' when the stored copy already matches what this
// client sent. The current client reads an empty value as "keep what you have,
// just reseed the snapshot", which is exactly right then and saves echoing the
// blob back over camp wifi. A field that was NOT sent still comes back in full,
// preserving cross-device pull-through.
function saveMeta(gJson, gBase, sJson) {
  var sh = tab_();
  var incG  = gJson != null ? safeparse_(gJson) : null;
  var baseG = gBase ? safeparse_(gBase) : null;

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    // One read covering both metadata cells rather than up to four calls.
    var meta    = sh.getRange('A1:B1').getValues()[0];
    var srvGRaw = String(meta[0] || '{}');
    var srvSRaw = String(meta[1] || '{}');

    var storedG = srvGRaw;
    if (incG) {
      var mergedG = mergeGObj_(srvGRaw, incG, baseG, gBase);
      storedG = (mergedG === incG) ? gJson : JSON.stringify(mergedG);
    }
    var storedS = (sJson != null) ? seasonWithServerSummaries_(srvSRaw, sJson) : srvSRaw;

    if (storedG !== srvGRaw || storedS !== srvSRaw) {
      sh.getRange('A1:B1').setValues([[storedG, storedS]]);
      SpreadsheetApp.flush();
    }
    return {
      G: (gJson != null && storedG === gJson) ? '' : storedG,
      S: (sJson != null && storedS === sJson) ? '' : storedS
    };
  } finally {
    lock.releaseLock();
  }
}

// Save one week's data with a three-way merge, and derive that week's summary.
// Returns the merged week JSON, or '' when the stored copy already matches what
// the client sent (the common case with only a few devices).
function saveWeek(weekName, wkJson, wkBase) {
  var col = WEEK_COLS[weekName];
  if (!col) throw new Error('Unknown week: ' + weekName);
  var sh = tab_();
  var incWK  = safeparse_(wkJson);
  var baseWK = wkBase ? safeparse_(wkBase) : null;

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var info      = readWeekColInfo_(sh, col);
    var mergedObj = mergeWeekObj_(info.json, incWK, baseWK, wkBase);
    // On the fast path the merged object IS the parsed incoming week, so reuse
    // the client's exact string rather than re-stringifying it.
    var mergedJson = (mergedObj === incWK) ? wkJson : JSON.stringify(mergedObj);

    var wrote = false;
    if (mergedJson !== info.json) {
      writeWeekCol_(sh, col, mergedJson, info.rows);
      wrote = true;
      // Derive this week's summary from what is now stored. Gated on the week
      // having actually changed: camper counts cannot move unless the week did,
      // so a retry of a save that already landed costs one range call in total
      // rather than two.
      var srvSRaw = String(sh.getRange('B1').getValue() || '{}');
      var newS = withDerivedSummary_(srvSRaw, weekName, mergedObj);
      if (newS !== srvSRaw) sh.getRange('B1').setValue(newS);
    }
    if (wrote) SpreadsheetApp.flush();
    return (mergedJson === wkJson) ? '' : mergedJson;
  } finally {
    lock.releaseLock();
  }
}

// ── Three-way merge helpers ───────────────────────────────────────────────────

function safeparse_(s) {
  try { return JSON.parse(s || '{}'); } catch(e) { return {}; }
}

// Slot-array entries must be primitives (cabin name strings / camper id numbers).
function isPrim_(x) {
  return typeof x === 'string' || typeof x === 'number';
}

function clone_(obj) {
  return JSON.parse(JSON.stringify(obj || {}));
}

function allKeys_(a, b) {
  var seen = {};
  Object.keys(a || {}).forEach(function(k){ seen[k] = 1; });
  Object.keys(b || {}).forEach(function(k){ seen[k] = 1; });
  return Object.keys(seen);
}

// Merge arrays of {id,...} objects. Applies additions, edits, and removals
// from (base→incoming) onto the server array.
function mergeById_(srv, base, inc) {
  var result  = clone_(srv  || []);
  var baseMap = {}, incMap = {};
  (base || []).forEach(function(x){ baseMap[String(x.id)] = x; });
  (inc  || []).forEach(function(x){ incMap[String(x.id)]  = x; });

  // Additions and edits
  Object.keys(incMap).forEach(function(id) {
    if (!baseMap[id]) {
      // New — add if not already present on server
      var found = false;
      for (var i = 0; i < result.length; i++) { if (String(result[i].id) === id) { found = true; break; } }
      if (!found) result.push(incMap[id]);
    } else {
      // Edited — update server's copy
      for (var i = 0; i < result.length; i++) {
        if (String(result[i].id) === id) { result[i] = incMap[id]; break; }
      }
    }
  });

  // Removals
  var removedIds = Object.keys(baseMap).filter(function(id){ return !incMap[id]; });
  if (removedIds.length) {
    result = result.filter(function(x){ return removedIds.indexOf(String(x.id)) === -1; });
  }
  return result;
}

// Merge [day][period][actId] = [id,...] maps (assignments and hrCabins).
// Legacy weeks store hrCabins[day][period] as a plain ARRAY (old shared-cabin
// format). Object.keys() on an array yields indices and the per-id merge below
// ends up calling .filter on a string — which THROWS and kills the whole save.
// Any legacy-shaped slot falls back to "client wins if it changed the slot".
function mergeSlotArrays_(srv, base, inc) {
  var result = clone_(srv || {});
  allKeys_(base, inc).forEach(function(day) {
    if (!result[day] || typeof result[day] !== 'object') result[day] = {};
    allKeys_((base||{})[day], (inc||{})[day]).forEach(function(per) {
      var srvSlot  = result[day][per];
      var baseSlot = ((base||{})[day]||{})[per];
      var incSlot  = ((inc ||{})[day]||{})[per];
      if (Array.isArray(srvSlot) || Array.isArray(baseSlot) || Array.isArray(incSlot)) {
        // Legacy shared-array format — can't merge per-activity.
        if (JSON.stringify(incSlot) !== JSON.stringify(baseSlot)) {
          result[day][per] = clone_(incSlot || {});
        }
        return;
      }
      if (!result[day][per]) result[day][per] = {};
      allKeys_(baseSlot, incSlot).forEach(function(actId) {
        var srvArr  = (((result[day]||{})[per]||{})[actId]) || [];
        var baseArr = (baseSlot||{})[actId] || [];
        var incArr  = (incSlot ||{})[actId] || [];
        if (!Array.isArray(srvArr))  srvArr  = [];
        if (!Array.isArray(baseArr)) baseArr = [];
        if (!Array.isArray(incArr))  incArr  = [];
        // Entries must be primitives (cabin names / camper ids). Non-primitive
        // garbage defeats indexOf equality, which made every save re-append the
        // whole server array — the week blob DOUBLED per save (2.09M → 4.16M).
        srvArr  = srvArr.filter(isPrim_);
        baseArr = baseArr.filter(isPrim_);
        incArr  = incArr.filter(isPrim_);
        var added   = incArr.filter(function(id){ return baseArr.indexOf(id) === -1; });
        var removed = baseArr.filter(function(id){ return incArr.indexOf(id) === -1; });
        var merged  = srvArr.filter(function(id){ return removed.indexOf(id) === -1; });
        added.forEach(function(id){ if (merged.indexOf(id) === -1) merged.push(id); });
        // Dedupe the result: legacy data carries heavy duplicates, and a
        // client-side dedup is invisible to the set-based delta above — without
        // this the duplicates persist server-side forever.
        merged = merged.filter(function(id, idx){ return merged.indexOf(id) === idx; });
        result[day][per][actId] = merged;
      });
    });
  });
  return result;
}

// Merge [day][period][actId] = string|'Closed' (blockTemplate).
// If the client changed a slot from its base, apply that change to the server.
function mergeBlockTemplate_(srv, base, inc) {
  var result = clone_(srv || {});
  allKeys_(base, inc).forEach(function(day) {
    if (!result[day]) result[day] = {};
    allKeys_((base||{})[day], (inc||{})[day]).forEach(function(per) {
      if (!result[day][per]) result[day][per] = {};
      allKeys_(((base||{})[day]||{})[per], ((inc||{})[day]||{})[per]).forEach(function(actId) {
        var baseVal = ((((base||{})[day]||{})[per]||{})[actId]);
        var incVal  = ((((inc ||{})[day]||{})[per]||{})[actId]);
        if (incVal !== baseVal) result[day][per][actId] = incVal;
      });
    });
  });
  return result;
}

function mergeWeek_(srv, base, inc) {
  if (!inc) return srv || {};
  if (!srv) return clone_(inc);
  var result       = clone_(srv);
  result.campers   = mergeById_(srv.campers,   base && base.campers,   inc.campers);
  result.jrCampers = mergeById_(srv.jrCampers, base && base.jrCampers, inc.jrCampers);
  result.assignments    = mergeSlotArrays_(srv.assignments,   base && base.assignments,   inc.assignments);
  result.hrCabins       = mergeSlotArrays_(srv.hrCabins,      base && base.hrCabins,      inc.hrCabins);
  result.blockTemplate  = mergeBlockTemplate_(srv.blockTemplate, base && base.blockTemplate, inc.blockTemplate);
  return result;
}

function mergeG_(srv, base, inc) {
  var result        = clone_(srv || {});
  result.activities = mergeById_(srv.activities, base && base.activities, inc.activities);
  result.areas      = mergeById_(srv.areas,      base && base.areas,      inc.areas);
  result.nextId     = Math.max(srv.nextId || 0, inc.nextId || 0);
  return result;
}

// ── Backward compatibility ────────────────────────────────────────────────────

// Old loadData() — still works; used by any legacy code path.
function loadData() {
  var sh = tab_();
  migrate_(sh);
  var meta  = sh.getRange('A1:B1').getValues()[0];
  var wdObj = {};
  WEEKS_ORDERED.forEach(function(w) {
    var val = readWeekCol_(sh, WEEK_COLS[w]);
    if (val) try { wdObj[w] = JSON.parse(val); } catch(e) {}
  });
  return { G: meta[0]||'{}', WD: JSON.stringify(wdObj), S: meta[1]||'{}' };
}

// Old saveBatch(). No current client calls it, but it is kept as a working
// legacy path for a stale cached client, which is why it gets the same
// weekSummaries protection as saveMeta: incoming never overwrites a stored
// summary. When it also carries week data it derives that week's summary, the
// same as saveWeek.
function saveBatch(payload) {
  var week = payload.week;
  var col  = week ? WEEK_COLS[week] : null;
  var sh   = tab_();
  var incG   = payload.G  != null ? safeparse_(payload.G)  : null;
  var baseG  = payload.G_base  ? safeparse_(payload.G_base)  : null;
  var incWK  = payload.WD != null ? safeparse_(payload.WD) : null;
  var baseWK = payload.WD_base ? safeparse_(payload.WD_base) : null;

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var meta    = sh.getRange('A1:B1').getValues()[0];
    var srvGRaw = String(meta[0] || '{}');
    var srvSRaw = String(meta[1] || '{}');
    var wrote   = false;

    var storedG = srvGRaw;
    if (incG) {
      var mergedG = mergeGObj_(srvGRaw, incG, baseG, payload.G_base);
      storedG = (mergedG === incG) ? payload.G : JSON.stringify(mergedG);
    }
    var storedS = (payload.S != null) ? seasonWithServerSummaries_(srvSRaw, payload.S) : srvSRaw;

    var storedWK = '', outWK = '';
    if (incWK && col) {
      var info      = readWeekColInfo_(sh, col);
      var mergedObj = mergeWeekObj_(info.json, incWK, baseWK, payload.WD_base);
      storedWK = (mergedObj === incWK) ? payload.WD : JSON.stringify(mergedObj);
      if (storedWK !== info.json) {
        writeWeekCol_(sh, col, storedWK, info.rows);
        wrote = true;
      }
      storedS = withDerivedSummary_(storedS, week, mergedObj);
      outWK = (storedWK === payload.WD) ? '' : storedWK;
    }
    if (storedG !== srvGRaw || storedS !== srvSRaw) {
      sh.getRange('A1:B1').setValues([[storedG, storedS]]);
      wrote = true;
    }
    if (wrote) SpreadsheetApp.flush();
    return {
      G: (payload.G != null && storedG === payload.G) ? '' : storedG,
      WK: outWK,
      S: (payload.S != null && storedS === payload.S) ? '' : storedS
    };
  } finally {
    lock.releaseLock();
  }
}

// Legacy saveData() for any very old client.
function saveData(key, jsonString) {
  var cell = { Global: 'A1', WeekData: 'B1', Season: 'B1' }[key];
  if (!cell) throw new Error('Unknown key: ' + key);
  var sh = tab_();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { sh.getRange(cell).setValue(jsonString); SpreadsheetApp.flush(); }
  finally { lock.releaseLock(); }
}

// ── Authentication ────────────────────────────────────────────────────────────

// Hardcoded secure dictionary for roles and passwords
var AUTH_USERS = {
  'activitysignup': { password: '1956', role: 'scheduler' },
  'admin': { password: 'iawah', role: 'admin' }
};

function authenticateUser(username, password) {
  var user = AUTH_USERS[username.toLowerCase().trim()];
  if (user && user.password === password) {
    return { success: true, role: user.role };
  }
  return { success: false, error: 'Invalid credentials. Please try again.' };
}