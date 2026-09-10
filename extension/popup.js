async function executeExtraction(endpoint, isAnnouncement) {
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

    if (isAnnouncement) {
      statusEl.textContent = `Found company: ${data.companyName}. Sending...`;
    } else {
      statusEl.textContent = `Found ${data.possibleIds.length} potential IDs. Sending...`;
    }

    const response = await fetch(`https://neohack.onrender.com${endpoint}`, {
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
  executeExtraction('/api/add-placement', false);
});
