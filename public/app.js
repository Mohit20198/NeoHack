// ──────────────────────────────────────────────
//  NeoHack Placement Lookup  ·  app.js (Client)
// ──────────────────────────────────────────────

const $id = id => document.getElementById(id);

let searchesToday = parseInt(localStorage.getItem("lookups_today") || "0");
let lastDate = localStorage.getItem("lookups_date") || "";

const today = new Date().toISOString().slice(0, 10);
if (lastDate !== today) {
  searchesToday = 0;
  localStorage.setItem("lookups_date", today);
  localStorage.setItem("lookups_today", "0");
}
$id("statSearches").textContent = searchesToday;

// Initialize state
$id("statDB").textContent = "Live";
$id("statTotal").textContent = "API"; // Will be updated on first search

// ── Branch Stats ───────────────────────────────
async function loadBranchStats() {
  try {
    const res = await fetch('/api/stats');
    if (res.status === 401) { window.location.href = '/login.html'; return; }
    if (!res.ok) return;
    const data = await res.json();
    
    const grid = $id("branchStatsGrid");
    grid.innerHTML = "";
    
    // Sort branches by placed students (descending)
    const branches = Object.keys(data.branchStats).sort((a, b) => {
      return data.branchStats[b].placed - data.branchStats[a].placed;
    });
    
    branches.forEach(branch => {
      const stat = data.branchStats[branch];
      const percent = Math.round((stat.placed / stat.total) * 100) || 0;
            // Build students list HTML for branch
        const safeId = "branch-" + branch.replace(/[^a-zA-Z0-9]/g, "");
        let studentsListHtml = `<div class="company-students-list">`;
        if (stat.placedStudents && stat.placedStudents.length > 0) {
          stat.placedStudents.forEach(s => {
            studentsListHtml += `<div class="company-student-item">
              <div><strong>${s.name}</strong> <span>(${s.regNo || s.neoId})</span></div>
              <div style="font-size: 0.8rem; color: var(--primary); text-align: right;">${s.source}</div>
            </div>`;
          });
        } else {
          studentsListHtml += `<div style="text-align:center; color:var(--text-muted); font-size: 0.9rem;">No students placed yet</div>`;
        }
        studentsListHtml += `</div>`;

        const html = `
          <div class="branch-card" style="cursor: pointer;" onclick="document.getElementById('${safeId}').classList.toggle('hidden')">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div class="branch-name">${branch}</div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.5">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </div>
            <div class="branch-numbers">
              <div><span class="highlight">${stat.placed}</span> Placed</div>
              <div><span class="dim">${stat.unplaced}</span> Unplaced</div>
            </div>
            <div class="branch-total">Total Students: ${stat.total}</div>
            <div class="progress-bar-container">
              <div class="progress-bar" style="width: ${percent}%"></div>
            </div>
            <div class="branch-percent">${percent}% Placed</div>
            <div id="${safeId}" class="hidden branch-details-dropdown" style="margin-top: 15px; border-top: 1px solid var(--border); padding-top: 10px;">
              ${studentsListHtml}
            </div>
          </div>
        `;
        grid.insertAdjacentHTML("beforeend", html);
    });
  } catch (err) {
    console.error("Failed to load branch stats:", err);
  }
}

// ── Tab Switching ──────────────────────────────
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      // Deactivate all
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => {
        c.classList.add("hidden");
        c.classList.remove("active");
      });
      
      // Activate clicked
      btn.classList.add("active");
      const targetId = btn.getAttribute("data-tab") || btn.getAttribute("data-target");
      if ($id(targetId)) {
        $id(targetId).classList.remove("hidden");
        $id(targetId).classList.add("active");
      }
      
      // Load feed/stats if those tabs are clicked
      if (targetId === "feedTab" || targetId === "statsTab" || targetId === "companiesTab") {
        loadRecentPlacements();
      }
    });
  });

// Initialization
loadRecentPlacements();


// ── Search ─────────────────────────────────────
async function doSearch() {
  const raw = $id("neoIdInput").value.trim();

  if (!raw) {
    $id("neoIdInput").focus();
    shake($id("neoIdInput"));
    return;
  }

  // Split by commas, spaces, or newlines
  const queries = raw.split(/[\s,]+/).filter(q => q.trim().length > 0).map(q => q.toUpperCase());

  if (queries.length === 0) return;

  hideCards();
  $id("resultsToolbar").classList.add("hidden");
  if($id("resultsFilter")) $id("resultsFilter").value = "";
  showStatus("Searching database...");

  try {
    const response = await fetch('/api/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries })
    });

    if (response.status === 401) {
      window.location.href = '/login.html';
      return;
    }

    if (!response.ok) throw new Error("API Error");

    const data = await response.json();
    hideStatus();

    // Update stats from backend
    if (data.totalStudents) {
      $id("statTotal").textContent = data.totalStudents.toLocaleString();
    }

    // Update local counter
    searchesToday += queries.length;
    localStorage.setItem("lookups_today", searchesToday);
    $id("statSearches").textContent = searchesToday;

    currentSearchData = data;
    currentSearchQueries = queries;
    renderSearchResults();

  } catch (error) {
    console.error("Search failed:", error);
    showStatus("Error: Could not connect to backend server.", true);
  }
}

let currentSearchData = null;
let currentSearchQueries = [];

function renderSearchResults() {
  if (!currentSearchData || currentSearchQueries.length === 0) return;

  $id("resultsContainer").innerHTML = "";

  const data = currentSearchData;
  const queries = currentSearchQueries;

  // Separate found vs not found
  const foundQueries = queries.filter(q => data.results[q] && data.results[q].length > 0);
  const notFoundQueries = queries.filter(q => !data.results[q] || data.results[q].length === 0);

  let allFoundRecords = [];
  foundQueries.forEach(query => {
    allFoundRecords = allFoundRecords.concat(data.results[query]);
  });

  // Filter logic
  const filterInput = $id("resultsFilter");
  const filterText = filterInput ? filterInput.value.toLowerCase() : "";
  if (filterText) {
    allFoundRecords = allFoundRecords.filter(r => 
      (r.name && r.name.toLowerCase().includes(filterText)) ||
      (r.neoId && r.neoId.toLowerCase().includes(filterText)) ||
      (r.regNo && r.regNo.toLowerCase().includes(filterText)) ||
      (r.email && r.email.toLowerCase().includes(filterText))
    );
  }

  // Sort logic
  const sortSelect = $id("sortCgpa");
  const sortVal = sortSelect ? sortSelect.value : "";
  if (sortVal) {
    allFoundRecords.sort((a, b) => {
      const ca = parseFloat(a.cgpa) || 0;
      const cb = parseFloat(b.cgpa) || 0;
      return sortVal === 'desc' ? cb - ca : ca - cb;
    });
  }

  // Render Table for Found Records
  if (allFoundRecords.length > 0) {
    let tableHtml = `
      <div style="overflow-x: auto; margin-bottom: 20px;">
        <table class="results-table" style="width: 100%; border-collapse: collapse; background: var(--card); border-radius: 8px; overflow: hidden; border: 1px solid var(--border);">
          <thead style="background: rgba(255,255,255,0.05); text-align: left; border-bottom: 1px solid var(--border);">
            <tr>
              <th style="padding: 12px 15px;">Name</th>
              <th style="padding: 12px 15px;">Neo ID</th>
              <th style="padding: 12px 15px;">Reg No</th>
              <th style="padding: 12px 15px;">Email</th>
              <th style="padding: 12px 15px;">CGPA</th>
              <th style="padding: 12px 15px;">10th/12th</th>
            </tr>
          </thead>
          <tbody>
    `;

    allFoundRecords.forEach(r => {
      const cgpaNum = parseFloat(r.cgpa) || 0;
      const cgpaColor = cgpaNum >= 8.5 ? '#10b981' : (cgpaNum > 0 ? 'var(--text)' : 'var(--text-muted)');
      const isPlacedStyle = r.isPlaced ? 'color: #10b981;' : '';
      const placedBadge = r.isPlaced ? ` <span style="background: rgba(16, 185, 129, 0.1); color: #10b981; font-size: 0.75em; padding: 2px 6px; border-radius: 4px; margin-left: 8px;">Placed at ${r.placementSource || 'Company'}</span>` : '';
      
      tableHtml += `
        <tr style="border-bottom: 1px solid var(--border); transition: background 0.2s; ${isPlacedStyle}">
          <td style="padding: 12px 15px; font-weight: 600;">${r.name}${placedBadge}</td>
          <td style="padding: 12px 15px; font-family: monospace; ${r.isPlaced ? 'color: #10b981;' : 'color: var(--primary);'}">${r.neoId || '-'}</td>
          <td style="padding: 12px 15px;">${r.regNo || '-'}</td>
          <td style="padding: 12px 15px; font-size: 0.9em; ${r.isPlaced ? 'color: #10b981;' : 'color: var(--text-muted);'}">${r.email || '-'}</td>
          <td style="padding: 12px 15px; font-weight: 600; color: ${r.isPlaced ? '#10b981' : cgpaColor};">${r.cgpa || '-'}</td>
          <td style="padding: 12px 15px; font-size: 0.9em; ${r.isPlaced ? 'color: #10b981;' : 'color: var(--text-muted);'}">
            ${r.tenth && r.tenth !== '-' ? r.tenth + (r.tenth.includes('%') ? '' : '%') : '-'} / 
            ${r.twelfth && r.twelfth !== '-' ? r.twelfth + (r.twelfth.includes('%') ? '' : '%') : '-'}
          </td>
        </tr>
      `;
    });

    tableHtml += `</tbody></table></div>`;
    $id("resultsContainer").insertAdjacentHTML("beforeend", tableHtml);
  }

  // Render Not Found
  if (notFoundQueries.length > 0) {
    let notFoundHtml = `<div style="display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px;">`;
    notFoundQueries.forEach(query => {
      notFoundHtml += `
        <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); padding: 10px 15px; border-radius: 8px; display: flex; align-items: center; gap: 10px;">
          <div style="color: #ef4444;">⚠</div>
          <div>
            <div style="font-weight: 600; font-size: 0.9em;">No Record Found</div>
            <div style="font-size: 0.8em; color: var(--text-muted);">${query}</div>
          </div>
        </div>
      `;
    });
    notFoundHtml += `</div>`;
    $id("resultsContainer").insertAdjacentHTML("beforeend", notFoundHtml);
  }

  // Update Toolbar
  if ($id("resultsCount") && $id("resultsToolbar")) {
    $id("resultsCount").textContent = `Found ${allFoundRecords.length} student${allFoundRecords.length !== 1 ? 's' : ''}`;
    $id("resultsToolbar").classList.remove("hidden");
  }
}

// Bind Filter & Sort Events
if ($id("resultsFilter")) {
  $id("resultsFilter").addEventListener("input", renderSearchResults);
}
if ($id("sortCgpa")) {
  $id("sortCgpa").addEventListener("change", renderSearchResults);
}

// ── Recent Placements & Stats ──────────────────────────
let currentBatch = "";

async function loadRecentPlacements() {
  try {
    const resRecent = await fetch(`/api/recent?batch=${currentBatch}`);
    const resStats = await fetch(`/api/stats?batch=${currentBatch}`);
    if (resRecent.status === 401 || resStats.status === 401) { window.location.href = '/login.html'; return; }
    if (!resRecent.ok || !resStats.ok) return;
    
    const recentData = await resRecent.json();
    const statsData = await resStats.json();
    
    // Update Total Placed
    $id("statPlaced").textContent = statsData.totalPlaced || 0;
    if ($id("feedTotalCount")) $id("feedTotalCount").textContent = (statsData.totalPlaced || 0) + " Placed";

    if (statsData.companyStats) {
      $id("statTotalCompanies").textContent = Object.keys(statsData.companyStats).length;
    }

    // Render CTC Math
    if (statsData.ctcStats) {
      $id("statAvgPackage").textContent = statsData.ctcStats.avg > 0 ? `${statsData.ctcStats.avg} LPA` : '--';
      $id("statMedianPackage").textContent = statsData.ctcStats.median > 0 ? `${statsData.ctcStats.median} LPA` : '--';
      $id("statHighestPackage").textContent = statsData.ctcStats.highest > 0 ? `${statsData.ctcStats.highest} LPA` : '--';
    }

    // Render Company Stats
    if (statsData.companyStats && Object.keys(statsData.companyStats).length > 0) {
      $id("companyStatsSection").classList.remove("hidden");
      const container = $id("companyStatsList");
      
      // Sort companies by total placed descending
      const sortedCompanies = Object.entries(statsData.companyStats)
        .sort((a, b) => b[1].totalPlaced - a[1].totalPlaced);

      let companyHtml = '';
      sortedCompanies.forEach(([comp, stats], index) => {
        const badgeColor = stats.hiringDone ? 'var(--success)' : 'var(--warning)';
        const badgeText = stats.hiringDone ? 'Done' : 'Pending';
        const badgeBg = stats.hiringDone ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)';

        companyHtml += `
          <tr class="company-row">
            <td style="padding: 15px; border-bottom: 1px solid var(--border);"><strong>${index + 1}. ${comp}</strong></td>
            <td style="padding: 15px; border-bottom: 1px solid var(--border);"><span class="badge badge-package">${stats.packageCTC || 'Undisclosed'}</span></td>
            <td style="padding: 15px; border-bottom: 1px solid var(--border);">${stats.totalPlaced}</td>
            <td style="padding: 15px; border-bottom: 1px solid var(--border);">${stats.vitBhopalPlaced} <span style="color:var(--text-muted);font-size:0.85em;">(${(stats.vitBhopalPlaced/Math.max(1, stats.totalPlaced)*100).toFixed(0)}%)</span></td>
            <td style="padding: 15px; border-bottom: 1px solid var(--border);">
              <span style="background: ${badgeBg}; color: ${badgeColor}; padding: 4px 8px; border-radius: 4px; font-size: 0.8em; font-weight: 600; border: 1px solid ${badgeColor};">${badgeText}</span>
            </td>
          </tr>
        `;
      });
      container.innerHTML = companyHtml;
    }

    // Render CGPA Stats
    if (statsData.cgpaStats) {
      $id("cgpaStatsSection").classList.remove("hidden");
      const container = $id("cgpaStatsList");
      let cgpaHtml = '';
      
      const order = ['9-10', '8-9', '7-8', '6-7', 'Below 6', 'Unknown'];
      order.forEach(range => {
        const stats = statsData.cgpaStats[range];
        if (stats) {
          const total = stats.placed + stats.unplaced;
          const percentage = total > 0 ? ((stats.placed / total) * 100).toFixed(1) : 0;
          
          cgpaHtml += `
            <tr>
              <td style="padding: 15px; border-bottom: 1px solid var(--border);"><strong>${range}</strong></td>
              <td style="padding: 15px; border-bottom: 1px solid var(--border); color: var(--success);">${stats.placed}</td>
              <td style="padding: 15px; border-bottom: 1px solid var(--border); color: var(--danger);">${stats.unplaced}</td>
              <td style="padding: 15px; border-bottom: 1px solid var(--border);">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <span>${total}</span>
                  <div style="flex: 1; height: 6px; background: var(--bg); border-radius: 3px; overflow: hidden;">
                    <div style="height: 100%; width: ${percentage}%; background: var(--success);"></div>
                  </div>
                  <span style="font-size: 0.8em; color: var(--text-muted);">${percentage}% Placed</span>
                </div>
              </td>
            </tr>
          `;
        }
      });
      container.innerHTML = cgpaHtml;
    }

    // Render Recent Placements Feed
    const placements = recentData.recent || [];
    if (placements.length > 0) {
      $id("recentPlacementsSection").classList.remove("hidden");
      const list = $id("recentPlacementsList");
      list.innerHTML = "";
      
      placements.forEach(p => {
        const date = new Date(p.timestamp).toLocaleDateString();
        const regInfo = p.regNo ? ` · ${p.regNo}` : '';
        const html = `
          <div class="recent-item">
            <div class="recent-avatar">★</div>
            <div class="recent-details">
              <strong>${p.name}</strong> (${p.neoId}${regInfo}) placed at <strong>${p.source}</strong>!<br/>
              <small>Package: <strong>${p.packageCTC || 'Undisclosed'}</strong> · ${date}</small>
            </div>
          </div>
        `;
        list.insertAdjacentHTML("beforeend", html);
      });
    } else if (currentBatch) {
      $id("recentPlacementsSection").classList.remove("hidden");
      const list = $id("recentPlacementsList");
      list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);">No placed students found for batch ${currentBatch}</div>`;
    }
  } catch (err) {
    console.error("Failed to load recent placements and stats:", err);
  }
}

// ── Feed Batch Tabs ─────────────────────────────
if ($id("btnFeedAll") && $id("btnFeed23") && $id("btnFeed22")) {
  $id("btnFeedAll").addEventListener("click", () => {
    $id("btnFeedAll").classList.add("active");
    $id("btnFeed23").classList.remove("active");
    $id("btnFeed22").classList.remove("active");
    currentBatch = "";
    loadRecentPlacements();
  });
  $id("btnFeed23").addEventListener("click", () => {
    $id("btnFeed23").classList.add("active");
    $id("btnFeedAll").classList.remove("active");
    $id("btnFeed22").classList.remove("active");
    currentBatch = "23";
    loadRecentPlacements();
  });
  $id("btnFeed22").addEventListener("click", () => {
    $id("btnFeed22").classList.add("active");
    $id("btnFeedAll").classList.remove("active");
    $id("btnFeed23").classList.remove("active");
    currentBatch = "22";
    loadRecentPlacements();
  });
}

// ── Helpers ─────────────────────────────────────
function showStatus(msg, isError = false) {
  $id("statusText").textContent = msg;
  $id("statusBar").classList.remove("hidden");
  const spinner = $id("statusBar").querySelector(".spinner");
  spinner.style.display = isError ? "none" : "";
}

function hideStatus() {
  $id("statusBar").classList.add("hidden");
}

function hideCards() {
  $id("resultsContainer").innerHTML = "";
}

function shake(el) {
  el.classList.add("shake");
  el.addEventListener("animationend", () => el.classList.remove("shake"), { once: true });
}

// ── Events ─────────────────────────────────────
$id("searchBtn").addEventListener("click", doSearch);
$id("neoIdInput").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSearch(); } });
$id("neoIdInput").addEventListener("input", () => {
  const val = $id("neoIdInput").value;
  $id("clearBtn").classList.toggle("visible", val.length > 0);
  const start = $id("neoIdInput").selectionStart;
  $id("neoIdInput").value = val.toUpperCase();
  $id("neoIdInput").setSelectionRange(start, start);
  hideCards();
  hideStatus();
});
$id("clearBtn").addEventListener("click", () => {
  $id("neoIdInput").value = "";
  $id("clearBtn").classList.remove("visible");
  $id("neoIdInput").focus();
  hideCards();
  hideStatus();
  if($id("resultsToolbar")) $id("resultsToolbar").classList.add("hidden");
});

if ($id('syncGmailBtn')) {
  $id('syncGmailBtn').addEventListener('click', async () => {
    showStatus('Syncing with Gmail...');
    try {
      const res = await fetch('/api/sync-gmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.status === 403) {
        showStatus('Access denied: admin only.', true);
        return;
      }
      if (res.status === 503) {
        showStatus('Gmail not configured — visit /api/auth/gmail-connect first.', true);
        return;
      }
      const data = await res.json();
      if (data.success) {
        hideStatus();
        alert(data.message);
        loadRecentPlacements();
      } else {
        showStatus('Sync Failed: ' + (data.error || 'Unknown'), true);
      }
    } catch (e) {
      showStatus('Sync Error: ' + e.message, true);
    }
  });
}

if($id("resultsFilter")) {
  $id("resultsFilter").addEventListener("input", (e) => {
    const filterText = e.target.value.toLowerCase();
    const cards = document.querySelectorAll("#resultsContainer .result-card");
    
    cards.forEach(card => {
      if (card.innerText.toLowerCase().includes(filterText)) {
        card.style.display = "";
      } else {
        card.style.display = "none";
      }
    });
  });
}

const style = document.createElement("style");
style.textContent = `@keyframes shake {0%,100%{transform:translateX(0)} 20%{transform:translateX(-6px)} 40%{transform:translateX(6px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)}} .shake{animation:shake 0.35s ease;}`;
document.head.appendChild(style);

// ── Admin UI init ───────────────────────────────────────────────────────────
// Calls /api/me to determine if the current session is admin.
// Hides the Sync Gmail button for non-admin users.
// The server-side requireAdmin middleware is the real security gate;
// this is purely UX — non-admins should not even see the button.
async function initAdminUI() {
  const syncBtn = $id('syncGmailBtn');
  if (!syncBtn) return;
  // Default: hide until we confirm admin status
  syncBtn.style.display = 'none';
  try {
    const res = await fetch('/api/me');
    if (!res.ok) return; // unauthenticated — page will redirect to login anyway
    const { isAdmin } = await res.json();
    if (isAdmin) {
      syncBtn.style.display = '';
      syncBtn.classList.remove('hidden');
    } else {
      syncBtn.style.display = 'none';
      syncBtn.classList.add('hidden');
    }

    if (isAdmin) {
      // Fetch pending review count and inject badge
      try {
        const r     = await fetch('/api/pending-review');
        const items = r.ok ? await r.json() : [];
        if (items.length > 0) {
          const badge = document.createElement('a');
          badge.href  = '/review.html';
          badge.id    = 'reviewBadge';
          badge.title = 'Open admin review portal';
          badge.style.cssText = [
            'display:inline-flex;align-items:center;gap:6px',
            'background:rgba(245,158,11,0.15)',
            'border:1px solid rgba(245,158,11,0.35)',
            'color:#f59e0b',
            'padding:6px 14px',
            'border-radius:8px',
            'font-size:0.82rem',
            'font-weight:600',
            'text-decoration:none',
            'margin-left:8px',
            'cursor:pointer',
            'transition:background 0.2s'
          ].join(';');
          badge.innerHTML = `⚠ Pending Review <span style="background:rgba(245,158,11,0.3);padding:1px 7px;border-radius:20px">${items.length}</span>`;
          badge.onmouseenter = () => badge.style.background = 'rgba(245,158,11,0.25)';
          badge.onmouseleave = () => badge.style.background = 'rgba(245,158,11,0.15)';
          syncBtn.insertAdjacentElement('afterend', badge);
        }
      } catch (_) { /* badge is non-critical */ }
    }
  } catch (e) {
    // Fail safe: keep button hidden if /api/me is unreachable
    syncBtn.style.display = 'none';
  }

  // Bind manual sync logic
  syncBtn.addEventListener('click', async () => {
    const originalText = syncBtn.innerHTML;
    syncBtn.innerHTML = `
      <svg style="width:16px;height:16px;margin-right:6px; animation: spin 1s linear infinite;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
      Syncing...
    `;
    syncBtn.disabled = true;
    syncBtn.style.opacity = '0.7';
    
    try {
      const res = await fetch('/api/sync/manual', { method: 'POST' });
      const data = await res.json();
      
      if (res.ok) {
        showStatus('Sync completed successfully!', false);
        setTimeout(() => location.reload(), 1500);
      } else {
        if (res.status === 400 && data.error.includes('auth not configured')) {
           window.location.href = '/api/auth/gmail-connect';
        } else {
           showStatus('Sync failed: ' + data.error, true);
        }
      }
    } catch (e) {
      showStatus('Network error during sync', true);
    } finally {
      syncBtn.innerHTML = originalText;
      syncBtn.disabled = false;
      syncBtn.style.opacity = '1';
    }
  });
}
initAdminUI();

// Add global spin animation for the sync button loader
const spinStyle = document.createElement("style");
spinStyle.textContent = `@keyframes spin { 100% { transform: rotate(360deg); } }`;
document.head.appendChild(spinStyle);
