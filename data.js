// MedHub v2 — data layer (Graph read of KCC_Master.xlsx). Milestone 4.1.
//
// PHI HANDLING: this module touches real patient data. Console output MUST be
// structural only — counts, rowIndex values/ranges, HTTP status codes, Graph
// error codes. Never console.log a MedRow, a row's values array, or any
// patient-identifying field. The "View test patient" UI displays synthetic
// test rows only and is safe to render verbatim.
//
// Depends on:
//   - window.medhubAuth.acquireToken from auth.js
//   - 'medhub-signed-in' window event from auth.js

(function () {
  const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
  const WORKBOOK_PATH = '/me/drive/root:/KCC/KCC_Master.xlsx';
  const TABLE_NAME = 'Medications';
  const SCOPES = ['Files.ReadWrite'];

  // 15-column schema per architecture doc §3.1 / §4.2. Order matters — matches A..O.
  const FIELDS = [
    'patientName', 'dob', 'mrn', 'medName', 'dose', 'qty',
    'pharmacy', 'pharmacyFax', 'doctor', 'lastFill', 'daysSupply',
    'nextFillDue', 'refillsRemaining', 'refillStatus', 'verified',
  ];

  // Worksheet row offset: rows 1-3 are title/timestamp/headers; data starts at row 4.
  const HEADER_ROWS = 3;

  // M4.3 resilience constants.
  const SESSION_STALE_MS = 4.5 * 60 * 1000;  // 4.5 minutes idle → recreate session
  const MAX_429_RETRIES = 3;
  const MAX_5XX_RETRIES = 1;
  const FIVE_XX_RETRY_DELAY_MS = 1000;

  let _driveId = null;
  let _itemId = null;
  let _sessionId = null;
  let _sessionLastUsedAt = null;
  let _meds = [];
  let _byRowIndex = new Map();
  let _loaded = false;

  function _toStr(v) {
    return v == null ? '' : String(v);
  }

  function _sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  // Outer entry: acquire token once per public Graph call. Retries reuse this token.
  async function _graph(method, pathOrUrl, body, extraHeaders) {
    const token = await window.medhubAuth.acquireToken(SCOPES);
    return _graphInner(method, pathOrUrl, body, extraHeaders, token, { c429: 0, c5xx: 0 });
  }

  // Retry-aware inner: separate 429 / 5xx budgets, reuse the supplied token across retries.
  async function _graphInner(method, pathOrUrl, body, extraHeaders, token, retry) {
    const url = pathOrUrl.startsWith('https://') ? pathOrUrl : GRAPH_BASE + pathOrUrl;
    const headers = {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (extraHeaders) Object.assign(headers, extraHeaders);
    const res = await fetch(url, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!res.ok) {
      // 429: separate budget. Honor Retry-After header if numeric; otherwise exponential backoff.
      if (res.status === 429 && retry.c429 < MAX_429_RETRIES) {
        const raSec = parseInt(res.headers.get('Retry-After'), 10);
        const delayMs = isFinite(raSec) ? raSec * 1000 : Math.pow(2, retry.c429) * 1000;
        console.info('[MedHub data] 429 retry', retry.c429 + 1, 'after', delayMs, 'ms');
        await _sleep(delayMs);
        return _graphInner(method, pathOrUrl, body, extraHeaders, token,
          { c429: retry.c429 + 1, c5xx: retry.c5xx });
      }
      // 5xx: separate budget, fixed 1s delay.
      if (res.status >= 500 && res.status < 600 && retry.c5xx < MAX_5XX_RETRIES) {
        console.info('[MedHub data] 5xx retry', retry.c5xx + 1, 'after', FIVE_XX_RETRY_DELAY_MS, 'ms');
        await _sleep(FIVE_XX_RETRY_DELAY_MS);
        return _graphInner(method, pathOrUrl, body, extraHeaders, token,
          { c429: retry.c429, c5xx: retry.c5xx + 1 });
      }
      let errCode = '(no body)';
      try {
        const errJson = await res.json();
        errCode = (errJson && errJson.error && errJson.error.code) || '(no code)';
      } catch (_) { /* non-JSON error body */ }
      console.error('[MedHub data] Graph error', res.status, errCode, method, pathOrUrl);
      const err = new Error('Graph ' + res.status + ' ' + errCode);
      err.status = res.status;
      err.code = errCode;
      throw err;
    }

    // Response success — mark the session freshly used if this call carried the session header.
    if (extraHeaders && extraHeaders['workbook-session-id']) {
      _sessionLastUsedAt = Date.now();
    }

    if (res.status === 204) return null;
    return res.json();
  }

  function _sessionHeader() {
    return _sessionId ? { 'workbook-session-id': _sessionId } : {};
  }

  // TODO (M5): replace /me/drive path with /drives/{driveId}/items/{itemId} via
  // sharedWithMe lookup, per arch doc §3.2 multi-user requirement.
  // Currently only works if signed-in user owns the workbook.
  async function _resolveWorkbook() {
    if (_driveId && _itemId) return;
    const item = await _graph('GET', WORKBOOK_PATH);
    _itemId = item.id;
    _driveId = item.parentReference && item.parentReference.driveId;
    if (!_itemId || !_driveId) {
      throw new Error('Could not resolve workbook driveId/itemId.');
    }
    console.info('[MedHub data] workbook resolved');
  }

  async function _createSession() {
    if (_sessionId) return;
    const path = '/drives/' + _driveId + '/items/' + _itemId + '/workbook/createSession';
    const result = await _graph('POST', path, { persistChanges: true });
    _sessionId = result.id;
    _sessionLastUsedAt = Date.now();
    // Log last 6 chars of session ID so the timeout test can verify the ID changed.
    const tail = _sessionId.length >= 6 ? _sessionId.slice(-6) : _sessionId;
    console.info('[MedHub data] workbook session created (…' + tail + ')');
  }

  async function _ensureFreshSession() {
    if (!_sessionId) return;
    if (Date.now() - _sessionLastUsedAt > SESSION_STALE_MS) {
      console.info('[MedHub data] session stale, recreating');
      _sessionId = null;
      _sessionLastUsedAt = null;
      await _createSession();
    }
  }

  async function _readUsedRange() {
    await _ensureFreshSession();
    const path = '/drives/' + _driveId + '/items/' + _itemId
      + "/workbook/worksheets('" + TABLE_NAME + "')/usedRange?$select=address,values";
    const range = await _graph('GET', path, undefined, _sessionHeader());
    const total = (range && range.values && range.values.length) || 0;
    console.info('[MedHub data] usedRange read,', total, 'rows incl headers');
    return range;
  }

  function _parseUsedRange(range) {
    const values = (range && range.values) || [];
    const out = [];
    // values[0..HEADER_ROWS-1] are title/timestamp/header rows; skip them.
    // values[i] corresponds to worksheet row (i + 1), so rowIndex = i + 1.
    for (let i = HEADER_ROWS; i < values.length; i++) {
      const row = values[i] || [];
      const med = { rowIndex: i + 1 };
      for (let c = 0; c < FIELDS.length; c++) {
        med[FIELDS[c]] = _toStr(row[c]);
      }
      out.push(med);
    }
    return out;
  }

  async function _refresh() {
    const range = await _readUsedRange();
    _meds = _parseUsedRange(range);
    _byRowIndex = _buildIndex(_meds);
  }

  function _buildIndex(meds) {
    const map = new Map();
    for (const m of meds) map.set(m.rowIndex, m);
    return map;
  }

  async function loadMedications() {
    await _resolveWorkbook();
    await _createSession();
    await _refresh();
    _loaded = true;
    return _meds;
  }

  function getMedications() {
    return _meds;
  }

  function getMedicationByRowIndex(rowIndex) {
    return _byRowIndex.get(rowIndex);
  }

  // Append one medication to the Medications table.
  //
  // COLUMN L (NextFillDue) FORMULA — observed behavior:
  // The Medications table has =IF(AND(J<>"",K<>""),J+K,"") in column L. We
  // pass "" for L below.
  //
  // OBSERVED IN M4.2 TESTING (2026-05-14): column L formula does NOT
  // auto-propagate on POST .../rows/add. New rows have empty L. Fix deferred
  // to M5 — apply scenario A from decision tree below (PATCH L with explicit
  // formula after add+refresh).
  //
  // Decision tree (kept for reference; scenario A is the live path):
  //   (a) L stays "" only on the new row -> formula propagation failed; fix by
  //       PATCH'ing L with the explicit formula after add+refresh (rowIndex
  //       known from refresh): '=IF(AND(J{n}<>"",K{n}<>""),J{n}+K{n},"")'.
  //   (b) L computes to #VALUE! -> lastFill landed as text not date; switch
  //       the write to send an Excel serial number for column J instead of a
  //       date string. Serial = (jsDateMs / 86400000) + 25569.
  //   (c) L computes correctly but display format is wrong -> cell-formatting
  //       only; address in M5 display layer.
  async function addMedication(medRow) {
    if (!_loaded) throw new Error('Call loadMedications first.');
    await _ensureFreshSession();
    const values = [FIELDS.map(function (f) { return _toStr(medRow[f]); })];
    const path = '/drives/' + _driveId + '/items/' + _itemId
      + '/workbook/tables/' + TABLE_NAME + '/rows/add';
    await _graph('POST', path, { values: values }, _sessionHeader());
    await _refresh();
    console.info('[MedHub data] add ok, total now', _meds.length);
    return _meds.length;
  }

  function _renderTestPatient() {
    const container = document.getElementById('test-patient-view');
    if (!container) return;
    const matches = _meds.filter(function (m) {
      return (m.patientName || '').trim().toLowerCase() === 'test, patient';
    });
    if (matches.length === 0) {
      container.innerHTML = '<p><em>No rows found for "Test, Patient".</em></p>';
      return;
    }
    const rows = matches.map(function (m) {
      return '<tr>'
        + '<td>' + m.rowIndex + '</td>'
        + '<td>' + escapeHtml(m.medName) + '</td>'
        + '<td>' + escapeHtml(m.dose) + '</td>'
        + '<td>' + escapeHtml(m.lastFill) + '</td>'
        + '<td>' + escapeHtml(m.refillsRemaining) + '</td>'
        + '</tr>';
    }).join('');
    container.innerHTML =
      '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;margin-top:0.5rem;">'
      + '<thead><tr>'
      + '<th>rowIndex</th><th>MedName</th><th>Dose</th><th>LastFill</th><th>Refills</th>'
      + '</tr></thead><tbody>'
      + rows
      + '</tbody></table>'
      + '<p style="margin-top:0.25rem;"><small>' + matches.length + ' row(s) matched.</small></p>';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _setLoadStatus(text, isError) {
    const el = document.getElementById('load-status');
    if (!el) return;
    el.textContent = text;
    if (isError) el.classList.add('error');
    else el.classList.remove('error');
  }

  function _formatErrDetail(err) {
    if (err && err.status >= 500 && err.status < 600) return 'Connection error, try again';
    if (err && err.status) return err.status + ' ' + (err.code || '');
    return (err && err.message) || 'Unknown error';
  }

  async function _onSignedIn() {
    if (_loaded) return;
    _setLoadStatus('Loading medications…', false);
    try {
      await loadMedications();
      _setLoadStatus('Loaded ' + _meds.length + ' medications', false);
      const viewBtn = document.getElementById('view-test-patient-btn');
      if (viewBtn) {
        viewBtn.classList.remove('hidden');
        viewBtn.addEventListener('click', _renderTestPatient);
      }
      const addBtn = document.getElementById('add-test-row-btn');
      if (addBtn) {
        addBtn.classList.remove('hidden');
        addBtn.addEventListener('click', _onAddTestRowClick);
      }
    } catch (err) {
      _setLoadStatus('Failed to load medications: ' + _formatErrDetail(err), true);
    }
  }

  function _buildTestRow() {
    return {
      patientName:      'Test, Patient',
      dob:              '1/1/1900',
      mrn:              'TEST-000',
      medName:          'Write Test ' + new Date().toISOString(),
      dose:             '1 mg',
      qty:              '30',
      pharmacy:         'Test Pharmacy',
      pharmacyFax:      '(000) 000-0000',
      doctor:           'Test, Doctor MD',
      lastFill:         '1/1/2026',
      daysSupply:       '30',
      nextFillDue:      '',
      refillsRemaining: '3',
      refillStatus:     '',
      verified:         '',
    };
  }

  async function _onAddTestRowClick() {
    const addBtn = document.getElementById('add-test-row-btn');
    const viewContainer = document.getElementById('test-patient-view');
    if (addBtn) addBtn.disabled = true;
    try {
      await addMedication(_buildTestRow());
      _setLoadStatus('Loaded ' + _meds.length + ' medications', false);
      if (viewContainer && viewContainer.innerHTML.trim() !== '') {
        _renderTestPatient();
      }
    } catch (err) {
      _setLoadStatus('Add failed: ' + _formatErrDetail(err), true);
    } finally {
      if (addBtn) addBtn.disabled = false;
    }
  }

  window.addEventListener('medhub-signed-in', _onSignedIn);

  window.medhubData = {
    loadMedications,
    getMedications,
    getMedicationByRowIndex,
    addMedication,
  };

  // Debug hook for resilience testing. Gated to localhost so it never ships to GitHub Pages.
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    window.medhubDataDebug = {
      // Force the session "last used" timestamp into the past so the next
      // session-using call triggers _ensureFreshSession's stale branch.
      setSessionAgeMinutesAgo: function (minutes) {
        if (!_sessionLastUsedAt) {
          console.warn('[MedHub data] no session to age');
          return;
        }
        _sessionLastUsedAt = Date.now() - minutes * 60 * 1000;
        console.info('[MedHub data] debug: session lastUsedAt set to', minutes, 'min ago');
      },
    };
    console.info('[MedHub data] debug hook available: window.medhubDataDebug');
  }
})();
