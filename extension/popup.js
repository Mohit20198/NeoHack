// Fetch companies on load
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('http://localhost:3000/api/companies');
    if (res.ok) {
      const companies = await res.json();
      const select = document.getElementById('companySelect');
      companies.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.name;
        opt.textContent = `${c.name} (${c.packageCTC || 'Undisclosed'})`;
        select.appendChild(opt);
      });
    }
  } catch (err) {
    console.error("Failed to load companies dropdown", err);
  }
});

async function executeExtraction(endpoint, isAnnouncement, overrideCompanyName = null) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = 'Extracting...';
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes("mail.google.com")) {
      statusEl.textContent = "Please open Gmail first!";
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    const data = results[0].result;
    
    if (!isAnnouncement && (!data.possibleIds || data.possibleIds.length === 0)) {
      statusEl.textContent = "No potential IDs found in this email.";
      return;
    }

    if (overrideCompanyName && overrideCompanyName.trim() !== "") {
      data.companyName = overrideCompanyName;
    }

    if (isAnnouncement) {
      statusEl.textContent = `Found company: ${data.companyName}. Sending...`;
    } else {
      statusEl.textContent = `Found ${data.possibleIds.length} potential IDs. Sending...`;
    }

    const response = await fetch(`http://localhost:3000${endpoint}`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-api-key': 'admin_secret_9942'
      },
      body: JSON.stringify(data)
    });

    const resultData = await response.json();
    
    if (resultData.success) {
      statusEl.textContent = `Success: ${resultData.message}`;
    } else {
      statusEl.textContent = `Error: ${resultData.error}`;
    }

  } catch (error) {
    statusEl.textContent = "Error occurred: " + error.message;
  }
}

document.getElementById('trackAnnouncementBtn').addEventListener('click', () => {
  executeExtraction('/api/add-company', true);
});

document.getElementById('trackPlacementBtn').addEventListener('click', () => {
  const selectedCompany = document.getElementById('companySelect').value;
  executeExtraction('/api/add-placement', false, selectedCompany);
});

document.getElementById('trackBulkBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('status');
  statusEl.textContent = 'Scanning inbox...';
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes("mail.google.com")) {
      statusEl.textContent = "Please open Gmail first!";
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content_bulk.js']
    });

    const data = results[0].result;
    
    if (!data || data.length === 0) {
      statusEl.textContent = "No company announcements found on this page.";
      return;
    }

    statusEl.textContent = `Found ${data.length} companies. Sending...`;

    const response = await fetch(`http://localhost:3000/api/add-companies-bulk`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-api-key': 'admin_secret_9942'
      },
      body: JSON.stringify({ companies: data })
    });

    const resultData = await response.json();
    
    if (resultData.success) {
      statusEl.textContent = `Success: ${resultData.message}`;
    } else {
      statusEl.textContent = `Error: ${resultData.error}`;
    }

  } catch (error) {
    statusEl.textContent = "Error occurred: " + error.message;
  }
});

document.getElementById('trackNeopatBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('status');
  statusEl.textContent = 'Scanning Neopat Grid...';
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes("neopat")) {
      statusEl.textContent = "Please open the Neopat website first!";
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content_neopat.js']
    });

    const data = results[0].result;
    
    if (!data || data.length === 0) {
      statusEl.textContent = "No companies found on this Neopat page.";
      return;
    }

    statusEl.textContent = `Found ${data.length} companies. Sending...`;

    const response = await fetch(`http://localhost:3000/api/add-companies-bulk`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-api-key': 'admin_secret_9942'
      },
      body: JSON.stringify({ companies: data })
    });

    const resultData = await response.json();
    
    if (resultData.success) {
      statusEl.textContent = `Success: ${resultData.message}`;
    } else {
      statusEl.textContent = `Error: ${resultData.error}`;
    }

  } catch (error) {
    statusEl.textContent = "Error occurred: " + error.message;
  }
});
