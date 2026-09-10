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
        }
        
        // Find package using the full text to avoid newline split issues
        const fullText = card.innerText.replace(/\n/g, ' ');
        // Try matching with ₹ symbol first
        let match = fullText.match(/₹\s*([\d.]+(?:L|K|LPA)?(?:\s*-\s*[\d.]+(?:L|K|LPA)?)?)\s*(?:PA|LPA|PM)/i);
        // If no ₹, require an L or K to prevent matching time formats (e.g., 04:00 PM)
        if (!match) {
          match = fullText.match(/([\d.]+(?:L|K)(?:\s*-\s*[\d.]+(?:L|K)?)?)\s*(?:PA|LPA|PM)/i);
        }
        
        if (match) {
          let pkg = match[1].trim().toUpperCase();
          if (fullText.substring(match.index).toUpperCase().includes('PM') && !pkg.includes('PM')) {
            pkg = pkg.replace('L', 'L PM');
            if (!pkg.includes('PM')) pkg += ' PM';
          } else {
            pkg = pkg.replace('L', ' LPA');
            if (!pkg.includes('LPA')) pkg += ' LPA';
          }
          packageCTC = pkg;
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
