document.getElementById('trackBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('status');
  statusEl.textContent = 'Extracting...';
  
  try {
    // Get current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes("mail.google.com")) {
      statusEl.textContent = "Please open Gmail first!";
      return;
    }

    // Execute content script in the active tab
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    const data = results[0].result;
    
    if (!data.possibleIds || data.possibleIds.length === 0) {
      statusEl.textContent = "No potential IDs found in this email.";
      return;
    }

    statusEl.textContent = `Found ${data.possibleIds.length} potential IDs. Sending to server...`;

    // Send data to backend
    const response = await fetch('http://localhost:3000/api/add-placement', {
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
});
