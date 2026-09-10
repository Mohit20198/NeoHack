// This script runs in the context of the Gmail page
(function() {
  function extractData() {
    // Attempt to get the email subject (usually in an h2 with class 'hP')
    let companyName = "Unknown Company";
    const subjectEl = document.querySelector('h2.hP');
    if (subjectEl) {
      // Basic heuristic: Subject might be "Congratulations on your placement at Microsoft!"
      const text = subjectEl.innerText || "";
      const match = text.match(/at\s+([A-Za-z0-9\s&]+)!?/i);
      if (match && match[1]) {
        companyName = match[1].trim();
      } else {
        companyName = text; // Fallback to full subject
      }
    } else {
      // Fallback: use page title
      companyName = document.title.replace(' - Gmail', '');
    }

    // Attempt to find Neo IDs or Reg Nos in the email body
    let possibleIds = [];
    
    // Look at visible email body elements (Gmail uses .a3s.aiL for email bodies)
    const bodyEls = document.querySelectorAll('.a3s.aiL');
    let fullText = "";
    if (bodyEls.length > 0) {
      bodyEls.forEach(el => fullText += " " + el.innerText);
    } else {
      fullText = document.body.innerText;
    }

    // Split text into words and look for 8-10 character alphanumeric strings
    const words = fullText.split(/[\s,.:;'"\n\r()\[\]]+/);
    for (const word of words) {
      const cleanWord = word.trim().toUpperCase();
      if (cleanWord.length >= 8 && cleanWord.length <= 10 && /^[A-Z0-9]+$/.test(cleanWord)) {
        possibleIds.push(cleanWord);
      }
    }

    // Extract the email date (usually in .g3 class in Gmail)
    let emailDate = null;
    const dateEl = document.querySelector('.g3');
    if (dateEl) {
      emailDate = dateEl.title || dateEl.innerText;
    }

    // Extract full email text for name matching and CTC extraction
    let emailText = "";
    const bodyEl = document.querySelector('.a3s');
    if (bodyEl) {
      emailText = bodyEl.innerText;
    }

    // Attempt to extract CTC or Package
    let packageCTC = "Undisclosed";
    if (emailText) {
      // Regex to find "X LPA", "X.Y LPA", "INR X,00,000", "CTC: X"
      const lpaMatch = emailText.match(/(\d+(?:\.\d+)?)\s*(?:LPA|lpa|Lacs|lacs|Lakhs|lakhs)/);
      if (lpaMatch) {
        packageCTC = lpaMatch[0].trim().toUpperCase();
      } else {
        const ctcMatch = emailText.match(/(?:CTC|Package|Compensation)[\s:]*([₹$]?\s*\d+(?:,\d+)*(?:\.\d+)?\s*(?:LPA|lpa)?)/i);
        if (ctcMatch && ctcMatch[1]) {
          packageCTC = ctcMatch[1].trim();
        }
      }
    }

    return {
      companyName: companyName,
      possibleIds: [...new Set(possibleIds)],
      emailDate: emailDate,
      emailText: emailText,
      packageCTC: packageCTC
    };
  }

  return extractData();
})();
