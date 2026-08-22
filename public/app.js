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
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // Remove active class from all buttons and content
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    // Add active class to clicked button and target content
    btn.classList.add('active');
    const targetId = btn.getAttribute('data-target');
    $id(targetId).classList.remove('hidden');
    $id(targetId).classList.add('active');
    
    // Load stats if stats tab is opened
    if (targetId === 'statsTab') {
      loadBranchStats();
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

    // Clear results
    $id("resultsContainer").innerHTML = "";

    // Render results (data.results[query] is now an array)
    queries.forEach(query => {
      const records = data.results[query];
      if (records && records.length > 0) {
        records.forEach(record => showResult(query, record));
      } else {
        showNotFound(query);
      }
    });

  } catch (error) {
    console.error("Search failed:", error);
    showStatus("Error: Could not connect to backend server.", true);
  }
}

// ── Display Result ─────────────────────────────
function showResult(query, r) {
  const initials = r.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const html = `
    <div class="result-card">
      <div class="result-header">
        <div class="result-avatar">${initials}</div>
        <div class="result-title-block">
          <div class="result-found-badge">✓ Student Found</div>
          <h2 class="result-name">${r.name}</h2>
          <div class="result-neo">Neo ID: ${r.neoId || query}</div>
        </div>
      </div>
      <div class="result-grid">
        <div class="result-field">
          <div class="field-label">Registration Number</div>
          <div class="field-value mono">${r.regNo}</div>
        </div>
        <div class="result-field">
          <div class="field-label">Personal Email</div>
          <div class="field-value">${r.email}</div>
        </div>
        <div class="result-field full-width">
          <div class="field-label">Official College Email</div>
          <div class="field-value">${r.offEmail}</div>
        </div>
      </div>
    </div>
  `;
  $id("resultsContainer").insertAdjacentHTML("beforeend", html);
}

// ── Display Not Found ──────────────────────────
function showNotFound(query) {
  const html = `
    <div class="not-found-card">
      <div class="not-found-icon">⚠</div>
      <div class="not-found-title">No Record Found</div>
      <div class="not-found-sub">No student with ID "<span>${query}</span>" exists in the database.</div>
    </div>
  `;
  $id("resultsContainer").insertAdjacentHTML("beforeend", html);
}

// ── Recent Placements & Stats ──────────────────────────
async function loadRecentPlacements() {
  try {
    const res = await fetch('/api/recent');
    if (res.status === 401) { window.location.href = '/login.html'; return; }
    if (!res.ok) return;
    const data = await res.json();
    
    // Update Total Placed
    $id("statPlaced").textContent = data.totalPlaced || 0;

    // Render Company Stats
    if (data.companyStats && Object.keys(data.companyStats).length > 0) {
      $id("companyStatsSection").classList.remove("hidden");
      const container = $id("companyStatsList");
      
      // Sort companies by count descending
      const sortedCompanies = Object.entries(data.companyStats)
        .sort((a, b) => b[1] - a[1]);

      let tableHtml = `
        <table class="company-table">
          <thead>
            <tr>
              <th>Company Name</th>
              <th style="text-align: right;">Total Placements</th>
            </tr>
          </thead>
          <tbody>
      `;
      
      sortedCompanies.forEach(([comp, count]) => {
        // Filter students for this company
        const students = data.placements.filter(p => p.source === comp);
        let studentsListHtml = `<div class="company-students-list">`;
        students.forEach(s => {
          studentsListHtml += `<div class="company-student-item"><strong>${s.name}</strong> <span>(${s.regNo || s.neoId})</span></div>`;
        });
        studentsListHtml += `</div>`;

        // Create safe ID for the accordion
        const safeId = "comp-" + comp.replace(/[^a-zA-Z0-9]/g, "");

        tableHtml += `
          <tr class="company-row" onclick="document.getElementById('${safeId}').classList.toggle('hidden')">
            <td style="cursor: pointer;">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <span>${comp}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.5">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
            </td>
            <td style="text-align: right; cursor: pointer;"><span class="comp-count-badge">${count}</span></td>
          </tr>
          <tr id="${safeId}" class="hidden company-details-row">
            <td colspan="2" style="padding: 0; border: none;">
              ${studentsListHtml}
            </td>
          </tr>
        `;
      });
      
      tableHtml += `
          </tbody>
        </table>
      `;
      
      container.innerHTML = tableHtml;
    }

    // Render Recent Placements Feed
    const placements = data.recent || [];
    if (placements.length > 0) {
      $id("recentPlacementsSection").classList.remove("hidden");
      const list = $id("recentPlacementsList");
      list.innerHTML = "";
      
      placements.forEach(p => {
        const date = new Date(p.timestamp).toLocaleDateString();
        const html = `
          <div class="recent-item">
            <div class="recent-avatar">★</div>
            <div class="recent-details">
              <strong>${p.name}</strong> (${p.neoId}) placed at <strong>${p.source}</strong>!<br/>
              <small>Reg: ${p.regNo} · ${date}</small>
            </div>
          </div>
        `;
        list.insertAdjacentHTML("beforeend", html);
      });
    }
  } catch (err) {
    console.error("Failed to load recent placements and stats:", err);
  }
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
});

const style = document.createElement("style");
style.textContent = `@keyframes shake {0%,100%{transform:translateX(0)} 20%{transform:translateX(-6px)} 40%{transform:translateX(6px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)}} .shake{animation:shake 0.35s ease;}`;
document.head.appendChild(style);
