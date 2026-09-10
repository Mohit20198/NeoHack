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
    const regNoPattern = /^[0-9]{2}[A-Z]{3}[0-9]{4,5}$/;
    // Neo ID must be exactly 8 characters, alphanumeric, and contain at least one digit and one letter
    const neoIdPattern = /^(?=.*[0-9])(?=.*[A-Z])[A-Z0-9]{8}$/;

    for (const word of words) {
      const cleanWord = word.trim().toUpperCase();
      if (regNoPattern.test(cleanWord) || neoIdPattern.test(cleanWord)) {
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
