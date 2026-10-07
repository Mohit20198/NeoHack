/**
 * gmailSync.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Core Gmail sync function. Extraction pipeline:
 *
 *   1. extractCompanyFromSubject() — fast regex, runs first on every email
 *   2. If regex returns null → extractWithGroq() fallback
 *      - high confidence  → auto-write to Placement (same as regex path)
 *      - medium/low       → route to PendingReview queue, skip to next email
 *
 * Guarantees:
 *   • isSyncRunning flag prevents overlapping cron/manual runs
 *   • Every run (success or error) writes a SyncLog with extraction breakdown
 *   • extractCompanyFromSubject null + Groq null → skipped (logged, not silently lost)
 */

const { google }          = require('googleapis');
const Placement           = require('./models/Placement');
const Company             = require('./models/Company');
const SyncLog             = require('./models/SyncLog');
const PendingReview       = require('./models/PendingReview');
const { extractWithGroq } = require('./groqExtract');

// ── Overlap guard ─────────────────────────────────────────────────────────────
let isSyncRunning = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b.charAt(i - 1) === a.charAt(j - 1)
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Multi-pattern company name extractor from CDC email subjects.
 * Returns null if no known pattern matches — caller tries Groq fallback.
 */
function extractCompanyFromSubject(subject) {
  let m;

  // Pattern 1 — "Congratulations!! <Company> Super/Dream/Internship/..."
  m = subject.match(/Congratulations[!?\s]*!?\s*(.*?)\s+(?:Super|Dream|Internship|Selection|Placement|Offer)/i);
  if (m && m[1].trim()) return m[1].trim();

  // Pattern 2 — "Congratulations!! <Company> - ..."
  m = subject.match(/Congratulations[!?\s]*!?\s*(.*?)\s*[-–]/i);
  if (m && m[1].trim()) return m[1].trim();

  // Pattern 3 — "Selection List - <Company>"
  m = subject.match(/Selection\s+List\s*[-–:]\s*(.*)/i);
  if (m && m[1].trim()) return m[1].trim();

  // Pattern 4 — "Placement Drive - <Company>" / "Internship Drive - <Company>"
  m = subject.match(/(?:Placement|Internship)\s+Drive\s*[-–:]\s*(.*)/i);
  if (m && m[1].trim()) return m[1].trim();

  return null;
}

/**
 * Look up a student record by Neo ID, Reg No, or fuzzy Neo ID match.
 * Returns the record object or null.
 */
function findStudentRecord(queryId, database, regDatabase) {
  const found = database[queryId] || regDatabase[queryId];
  if (found) return found;

  // Levenshtein fuzzy match for CDC typos (distance ≤ 2)
  let minDistance = Infinity;
  let bestMatch   = null;
  for (const neoId of Object.keys(database)) {
    const dist = levenshtein(queryId, neoId);
    if (dist < minDistance) { minDistance = dist; bestMatch = neoId; }
  }
  if (minDistance <= 2 && bestMatch) {
    console.log(`[SYNC] Fuzzy: ${queryId} → ${bestMatch} (distance ${minDistance})`);
    return database[bestMatch];
  }
  return null;
}

/** Extract all unique Neo-ID-like tokens from raw email body text. */
function extractIdsFromBody(rawBody) {
  const idRegex = /\b(?![A-Za-z]+\b)(?!\d+\b)[A-Z0-9]{8,10}\b/g;
  const matches = rawBody.match(idRegex) || [];
  return [...new Set(matches)];
}

/** Insert a Placement record if this student hasn't been placed yet. */
async function addPlacement(record, companyName, emailDate, packageCTC) {
  const existing = await Placement.findOne({ neoId: record.neoId });
  if (!existing) {
    await Placement.create({
      name:       record.name,
      neoId:      record.neoId,
      regNo:      record.regNo,
      source:     companyName  || 'Unknown Company',
      packageCTC: packageCTC   || 'Undisclosed',
      timestamp:  emailDate ? new Date(emailDate) : new Date()
    });
    console.log(`[SYNC] New placement: ${record.name} (${record.neoId}) → ${companyName}`);
    return true;
  }
  return false;
}

// ── Normal placement path (shared by regex + Groq-high) ──────────────────────

async function processPlacementEmail(finalCompanyName, rawBody, emailDate, database, regDatabase, existingCompanies, nameDatabase) {
  // Map to canonical company name if we already track it
  let resolvedName = finalCompanyName;
  const matchedCompany = existingCompanies.find(c => {
    const cLow = c.name.toLowerCase();
    const eLow = finalCompanyName.toLowerCase();
    return eLow.includes(cLow) || cLow.includes(eLow);
  });
  if (matchedCompany) resolvedName = matchedCompany.name;

  // Mark hiring as confirmed
  await Company.findOneAndUpdate(
    { name: resolvedName },
    { $set: { hiringDone: true } },
    { upsert: true }
  );

  const possibleIds = extractIdsFromBody(rawBody);
  let addedCount = 0;

  // 1. Check by ID
  for (const id of possibleIds) {
    const rec = findStudentRecord(id.toUpperCase(), database, regDatabase);
    if (rec) {
      const added = await addPlacement(rec, resolvedName, emailDate, 'Undisclosed');
      if (added) addedCount++;
    }
  }

  // 2. Check by Name
  if (nameDatabase && rawBody) {
    const textLower = rawBody.toLowerCase();
    for (const [nameKey, studentsArray] of Object.entries(nameDatabase)) {
      if (nameKey.length >= 4 && textLower.includes(nameKey)) {
        const safeName = nameKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${safeName}\\b`, 'i');
        
        if (regex.test(rawBody)) {
          if (studentsArray.length === 1) {
            const rec = studentsArray[0];
            const added = await addPlacement(rec, resolvedName, emailDate, 'Undisclosed');
            if (added) addedCount++;
          }
        }
      }
    }
  }

  if (addedCount === 0 && possibleIds.length === 0) {
    console.log(`[SYNC] No IDs or names found in email for "${resolvedName}"`);
    return 0;
  }

  if (addedCount > 0) {
    await Company.findOneAndUpdate(
      { name: resolvedName },
      { $inc: { totalVitPlaced: addedCount } }
    );
  }

  return addedCount;
}

// ── Core sync function ────────────────────────────────────────────────────────

async function runGmailSync(auth, database, regDatabase, nameDatabase) {
  // ── Overlap guard ──────────────────────────────────────────────────────────
  if (isSyncRunning) {
    console.log(`[SYNC] ${new Date().toISOString()} — sync already in progress, skipping tick`);
    return null;
  }

  isSyncRunning = true;
  const startedAt = new Date();

  // Extraction breakdown counters
  const syncStats = {
    emailsScanned:      0,
    newPlacements:      0,
    regexMatches:       0,
    groqHighConfidence: 0,
    routedToReview:     0,
    skipped:            0
  };

  try {
    const gmail = google.gmail({ version: 'v1', auth });

    // Find the last successful sync to avoid rescanning old emails
    const lastSync = await SyncLog.findOne({ status: 'success' }).sort({ startedAt: -1 });
    let query = '(from:noreply.cdcinfo@vit.ac.in OR from:cdc@vitbhopal.ac.in OR from:vitlions2027@vitbhopal.ac.in) subject:"Congratulations"';
    
    if (lastSync) {
      // Gmail 'after' query expects seconds (UNIX timestamp)
      // We subtract 1 hour to provide a safe buffer for emails that might have arrived during the last sync
      const afterTimestamp = Math.floor(lastSync.startedAt.getTime() / 1000) - 3600;
      query += ` after:${afterTimestamp}`;
    }

    const response = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 50 });

    if (!response.data.messages) {
      console.log(`[SYNC] No new matching CDC emails found since last sync.`);
      await SyncLog.create({ startedAt, finishedAt: new Date(), status: 'success', ...syncStats });
      return syncStats;
    }

    const existingCompanies = await Company.find().lean();
    existingCompanies.sort((a, b) => a.name.length - b.name.length); // shortest-first for substring match

    for (const msg of response.data.messages) {
      syncStats.emailsScanned++;

      const msgData = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
      const payload = msgData.data.payload;

      let subject    = 'Unknown';
      let dateHeader = null;
      payload.headers.forEach(h => {
        if (h.name.toLowerCase() === 'subject') subject    = h.value;
        if (h.name.toLowerCase() === 'date')    dateHeader = h.value;
      });
      const emailDate = dateHeader ? new Date(dateHeader) : new Date();

      // Decode body (plain-text preferred)
      let rawBody = '';
      if (payload.parts) {
        const textPart = payload.parts.find(p => p.mimeType === 'text/plain');
        if (textPart?.body?.data) {
          rawBody = Buffer.from(textPart.body.data, 'base64').toString('utf8');
        } else if (payload.parts[0]?.body?.data) {
          rawBody = Buffer.from(payload.parts[0].body.data, 'base64').toString('utf8');
        }
      } else if (payload.body?.data) {
        rawBody = Buffer.from(payload.body.data, 'base64').toString('utf8');
      }

      // ── Step 1: Regex extraction ──────────────────────────────────────────
      let finalCompanyName = extractCompanyFromSubject(subject);

      if (finalCompanyName) {
        // ── Regex success → auto-write path ──────────────────────────────────
        syncStats.regexMatches++;
        const added = await processPlacementEmail(finalCompanyName, rawBody, emailDate, database, regDatabase, existingCompanies, nameDatabase);
        syncStats.newPlacements += added;

      } else {
        // ── Step 2: Groq fallback ─────────────────────────────────────────────
        console.log(`[SYNC] Regex miss — trying Groq for: "${subject}"`);
        const groqResult = await extractWithGroq(subject, rawBody);

        if (groqResult.confidence === 'high' && groqResult.companyName) {
          // ── Groq high → auto-write path (same trust as regex) ─────────────
          syncStats.groqHighConfidence++;
          console.log(`[SYNC] Groq high: "${groqResult.companyName}" from "${subject}"`);
          const added = await processPlacementEmail(groqResult.companyName, rawBody, emailDate, database, regDatabase, existingCompanies, nameDatabase);
          syncStats.newPlacements += added;

        } else {
          // ── Groq medium/low → route to admin review queue ─────────────────
          // Extract student IDs first so we can create per-student review records
          const possibleIds   = extractIdsFromBody(rawBody);
          const foundStudents = [];
          for (const id of possibleIds) {
            const rec = findStudentRecord(id.toUpperCase(), database, regDatabase);
            if (rec) foundStudents.push(rec);
          }

          if (foundStudents.length > 0) {
            for (const student of foundStudents) {
              await PendingReview.create({
                name:                 student.name,
                neoId:                student.neoId,
                extractedCompanyName: groqResult.companyName,
                extractedCTC:         groqResult.ctc,
                subject,
                extractionSource:     `groq-${groqResult.confidence}`,
                timestamp:            emailDate
              });
            }
            syncStats.routedToReview += foundStudents.length;
          } else if (groqResult.companyName) {
            // Company name found but no student IDs — still worth a human look
            await PendingReview.create({
              extractedCompanyName: groqResult.companyName,
              extractedCTC:         groqResult.ctc,
              subject,
              extractionSource:     `groq-${groqResult.confidence}`,
              timestamp:            emailDate
            });
            syncStats.routedToReview++;
          } else {
            // Nothing useful from regex or Groq — skip
            syncStats.skipped++;
          }

          console.log(
            `[SYNC] Routed to review (${groqResult.confidence}): "${subject}" ` +
            `(${foundStudents.length} students)`
          );
        }
      }
    }

    console.log(
      `[SYNC] ✔ Done — ${syncStats.emailsScanned} scanned | ` +
      `${syncStats.newPlacements} placed | ` +
      `regex:${syncStats.regexMatches} groq-high:${syncStats.groqHighConfidence} ` +
      `review:${syncStats.routedToReview} skipped:${syncStats.skipped}`
    );

    await SyncLog.create({ startedAt, finishedAt: new Date(), status: 'success', ...syncStats });
    return syncStats;

  } catch (err) {
    console.error('[SYNC] ✗ Run failed:', err.message);
    await SyncLog.create({
      startedAt,
      finishedAt: new Date(),
      status:     'error',
      ...syncStats,
      error:      err.message
    });
    return null;

  } finally {
    isSyncRunning = false; // always release the lock, even on error
  }
}

module.exports = { runGmailSync };
