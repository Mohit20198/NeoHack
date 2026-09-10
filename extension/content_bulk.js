// This script runs in the context of the Gmail page (Inbox view)
(function() {
  function extractBulkAnnouncements() {
    const rows = document.querySelectorAll('tr.zA');
    const announcements = [];
    
    // Keywords indicating a placement announcement
    const keywords = ["dream", "super dream", "offer", "selection", "registration", "placement", "internship", "hiring"];

    rows.forEach(row => {
      // Find subject
      let subject = "";
      const subjectEl = row.querySelector('.bog') || row.querySelector('.bqe') || row.querySelector('.y6');
      if (subjectEl) {
        // Some subject elements contain the snippet inside them, so we just get the direct text node or child spans without the .y2 class
        subject = subjectEl.innerText.split('\n')[0].trim();
      }

      // Find snippet
      let snippet = "";
      const snippetEl = row.querySelector('.y2');
      if (snippetEl) {
        snippet = snippetEl.innerText.trim();
      }

      const fullText = subject + " " + snippet;
      const lowerText = fullText.toLowerCase();

      // Check if it matches our keywords
      const isAnnouncement = keywords.some(kw => lowerText.includes(kw));

      if (isAnnouncement && subject) {
        let companyName = subject;
        
        // Extract the email date
        let emailDate = null;
        const dateEl = row.querySelector('.xW.xY span');
        if (dateEl) {
          emailDate = dateEl.title || dateEl.innerText;
        }

        announcements.push({
          companyName: companyName,
          packageCTC: 'Undisclosed'
        });
      }
    });

    // Remove duplicates based on companyName
    const uniqueAnnouncements = [];
    const seen = new Set();
    announcements.forEach(a => {
      if (!seen.has(a.companyName)) {
        seen.add(a.companyName);
        uniqueAnnouncements.push(a);
      }
    });

    return uniqueAnnouncements;
  }

  return extractBulkAnnouncements();
})();
