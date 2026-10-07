/**
 * review.js — Admin Review Portal logic
 * Loaded by /public/review.html
 */

(async function () {
  // ── Auth gate ───────────────────────────────────────────────────────────────
  // Real enforcement is requireAdmin on the server; this just redirects the UI.
  let meData = null;
  try {
    const r = await fetch('/api/me');
    if (!r.ok) { window.location.href = '/'; return; }
    meData = await r.json();
    if (!meData.isAdmin) { window.location.href = '/'; return; }
  } catch {
    window.location.href = '/';
    return;
  }

  // ── State ───────────────────────────────────────────────────────────────────
  let pendingItems = [];
  let rejectTargetId = null;

  // ── DOM refs ────────────────────────────────────────────────────────────────
  const tableContainer = document.getElementById('tableContainer');
  const statPending    = document.getElementById('statPending');
  const statApproved   = document.getElementById('statApproved');
  const statRejected   = document.getElementById('statRejected');
  const rejectModal    = document.getElementById('rejectModal');
  const rejectReason   = document.getElementById('rejectReason');
  const cancelReject   = document.getElementById('cancelReject');
  const confirmReject  = document.getElementById('confirmReject');
  const toast          = document.getElementById('toast');

  document.getElementById('refreshBtn').addEventListener('click', loadData);
  cancelReject.addEventListener('click', closeModal);
  rejectModal.addEventListener('click', e => { if (e.target === rejectModal) closeModal(); });
  confirmReject.addEventListener('click', submitReject);

  // ── Toast ───────────────────────────────────────────────────────────────────
  let toastTimer = null;
  function showToast(msg, type = 'success') {
    toast.textContent = msg;
    toast.className   = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.className = 'toast'; }, 3500);
  }

  // ── Modal ───────────────────────────────────────────────────────────────────
  function openModal(id) {
    rejectTargetId = id;
    rejectReason.value = '';
    rejectModal.classList.add('open');
    rejectReason.focus();
  }
  function closeModal() {
    rejectTargetId = null;
    rejectModal.classList.remove('open');
  }

  // ── Badge rendering ─────────────────────────────────────────────────────────
  function sourceBadge(src) {
    const cls = {
      'groq-medium': 'badge-groq-medium',
      'groq-low':    'badge-groq-low',
      'groq-high':   'badge-groq-high'
    }[src] || 'badge-groq-low';
    return `<span class="badge ${cls}">${src}</span>`;
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // ── Load pending stats + queue ──────────────────────────────────────────────
  async function loadData() {
    tableContainer.innerHTML = '<div class="loading"><div class="spinner"></div>Loading queue…</div>';

    try {
      const [pendingRes, allRes] = await Promise.all([
        fetch('/api/pending-review'),
        fetch('/api/pending-review/all').catch(() => null)  // optional endpoint
      ]);

      if (!pendingRes.ok) throw new Error('Failed to fetch queue');
      pendingItems = await pendingRes.json();

      statPending.textContent  = pendingItems.length;

      // Stats from all items (if the endpoint exists, otherwise just show pending)
      if (allRes && allRes.ok) {
        const all = await allRes.json();
        statApproved.textContent = all.filter(i => i.decision === 'approved').length;
        statRejected.textContent = all.filter(i => i.decision === 'rejected').length;
      } else {
        statApproved.textContent = '—';
        statRejected.textContent = '—';
      }

      renderTable();
    } catch (err) {
      tableContainer.innerHTML = `<div class="empty"><div class="icon">⚠️</div><div class="msg">Failed to load queue</div><div class="sub">${err.message}</div></div>`;
    }
  }

  // ── Render table ────────────────────────────────────────────────────────────
  function renderTable() {
    if (pendingItems.length === 0) {
      tableContainer.innerHTML = `
        <div class="empty">
          <div class="icon">✅</div>
          <div class="msg">Review queue is empty</div>
          <div class="sub">All extracted placements have been reviewed, or nothing landed in the queue yet.</div>
        </div>`;
      return;
    }

    const rows = pendingItems.map(item => `
      <tr id="row-${item._id}">
        <td>
          <div style="font-weight:600">${item.name || '<span style="color:var(--muted)">Unknown</span>'}</div>
          <div class="mono" style="color:var(--muted);margin-top:3px">${item.neoId || '—'}</div>
        </td>
        <td>
          <div style="font-weight:600;color:var(--accent)">${item.extractedCompanyName || '<span style="color:var(--muted)">—</span>'}</div>
          <div style="color:var(--muted);font-size:0.8rem;margin-top:3px">${item.extractedCTC || 'CTC not found'}</div>
        </td>
        <td class="subject-cell">${escapeHtml(item.subject)}</td>
        <td>${sourceBadge(item.extractionSource)}</td>
        <td style="color:var(--muted);font-size:0.82rem;white-space:nowrap">${fmtDate(item.timestamp)}</td>
        <td>
          <div class="actions">
            <button class="btn btn-approve" onclick="approveItem('${item._id}')">✓ Approve</button>
            <button class="btn btn-reject"  onclick="openRejectModal('${item._id}')">✕ Reject</button>
          </div>
        </td>
      </tr>
    `).join('');

    tableContainer.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Company / CTC</th>
              <th>Original Subject</th>
              <th>Source</th>
              <th>Date</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function escapeHtml(str) {
    if (!str) return '—';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Approve ─────────────────────────────────────────────────────────────────
  window.approveItem = async function (id) {
    const row = document.getElementById(`row-${id}`);
    const btns = row?.querySelectorAll('.btn');
    btns?.forEach(b => b.disabled = true);

    try {
      const r = await fetch(`/api/pending-review/${id}/approve`, { method: 'POST' });
      const data = await r.json();

      if (!r.ok) throw new Error(data.error || 'Approve failed');

      showToast(data.placementCreated ? '✓ Placement created!' : '✓ Approved (already placed — skipped write)');
      pendingItems = pendingItems.filter(i => i._id !== id);
      statPending.textContent = pendingItems.length;
      row?.remove();

      if (pendingItems.length === 0) renderTable();
    } catch (err) {
      showToast('✕ ' + err.message, 'error');
      btns?.forEach(b => b.disabled = false);
    }
  };

  // ── Reject ──────────────────────────────────────────────────────────────────
  window.openRejectModal = function (id) { openModal(id); };

  async function submitReject() {
    if (!rejectTargetId) return;
    const reason = rejectReason.value.trim();
    confirmReject.disabled = true;
    confirmReject.textContent = 'Rejecting…';

    try {
      const r = await fetch(`/api/pending-review/${rejectTargetId}/reject`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reason })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Reject failed');

      showToast('✓ Rejected and logged.');
      pendingItems = pendingItems.filter(i => i._id !== rejectTargetId);
      statPending.textContent = pendingItems.length;
      document.getElementById(`row-${rejectTargetId}`)?.remove();
      if (pendingItems.length === 0) renderTable();
    } catch (err) {
      showToast('✕ ' + err.message, 'error');
    } finally {
      confirmReject.disabled  = false;
      confirmReject.textContent = 'Reject';
      closeModal();
    }
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  loadData();
})();
