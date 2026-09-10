// This script runs in the context of the Neopat page (e.g., vit.neopat.ai)
(function() {
  function extractNeopatAnnouncements() {
    // Attempt 1: Find card elements by looking for containers of "Apply Before"
    const elements = Array.from(document.querySelectorAll('*'));
    const applyBeforeElements = elements.filter(el => 
      el.children.length === 0 && 
      el.textContent.includes('Apply Before')
    );

    const announcements = [];
    const seen = new Set();

    applyBeforeElements.forEach(el => {
      // Traverse up to find the card container
      let card = el.parentElement;
      for (let i = 0; i < 5; i++) {
        if (!card) break;
        if (card.textContent.includes('PA') || card.textContent.includes('LPA')) {
          break;
        }
        card = card.parentElement;
      }

      if (card) {
        const textLines = card.innerText.split('\n').map(l => l.trim()).filter(l => l);
        
        let companyName = "Unknown";
        let packageCTC = "Undisclosed";

        for (let i = 0; i < textLines.length; i++) {
          const line = textLines[i];
          if (line === "APPLIED" || line === "NOT APPLIED" || line === "SHORTLISTED") {
            if (i + 1 < textLines.length) {
              companyName = textLines[i + 1];
            }
          }
          
          if (line.includes('PA') || line.includes('LPA')) {
            const match = line.match(/(?:₹)?\s*([\d.]+(?:L|LPA|K)?(?:\s*-\s*[\d.]+(?:L|LPA|K)?)?)/i);
            if (match) {
              packageCTC = match[1].trim().toUpperCase().replace('L', ' LPA');
            } else {
              packageCTC = line.replace('PA', 'LPA').replace('₹', '').trim();
            }
          }
        }

        if (companyName !== "Unknown" && !seen.has(companyName)) {
          seen.add(companyName);
          announcements.push({
            companyName: companyName,
            packageCTC: packageCTC
          });
        }
      }
    });

    return announcements;
  }

  return extractNeopatAnnouncements();
})();
