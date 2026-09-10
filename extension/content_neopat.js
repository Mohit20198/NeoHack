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
        if (card.textContent.includes('PA') || card.textContent.includes('LPA') || card.textContent.includes('PM')) {
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
          const statusMatch = ["APPLIED", "NOT APPLIED", "SHORTLISTED", "NOT ELIGIBLE"].includes(line.toUpperCase());
          if (statusMatch) {
            if (i + 1 < textLines.length) {
              companyName = textLines[i + 1];
            }
          }
          
          if (line.includes('PA') || line.includes('LPA') || line.includes('PM')) {
            const match = line.match(/(?:₹)?\s*([\d.]+(?:L|LPA|K|PM)?(?:\s*-\s*[\d.]+(?:L|LPA|K|PM)?)?)/i);
            if (match) {
              let pkg = match[1].trim().toUpperCase();
              if (line.includes('PM')) pkg = pkg.replace('L', 'L PM');
              else pkg = pkg.replace('L', ' LPA');
              packageCTC = pkg;
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
