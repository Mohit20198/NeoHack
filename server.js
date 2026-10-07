require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const fs         = require('fs');
const path       = require('path');
const cookieParser = require('cookie-parser');
const { OAuth2Client } = require('google-auth-library');
const { google } = require('googleapis');
const jwt        = require('jsonwebtoken');
const mongoose   = require('mongoose');
const cron       = require('node-cron');

// Verify Google ID tokens for login
const client = new OAuth2Client((process.env.GOOGLE_CLIENT_ID || '715718536052-1e0k29fr1n1156tekg966j1vli7cql30.apps.googleusercontent.com'));

const Placement    = require('./models/Placement');
const Company      = require('./models/Company');
const GmailToken   = require('./models/GmailToken');
const SyncLog      = require('./models/SyncLog');
const PendingReview = require('./models/PendingReview');
const { runGmailSync } = require('./gmailSync');
const gmailAuthRouter  = require('./routes/gmailAuth');

// Module-level OAuth client for background sync ΓÇö populated by initSyncAuth()
let syncAuth = null;

async function initSyncAuth() {
  try {
    const tokenDoc = await GmailToken.findOne();
    if (tokenDoc && tokenDoc.refreshToken) {
      syncAuth = new OAuth2Client(
        (process.env.GOOGLE_CLIENT_ID || '715718536052-1e0k29fr1n1156tekg966j1vli7cql30.apps.googleusercontent.com'),
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/api/auth/gmail-callback'
      );
      syncAuth.setCredentials({ refresh_token: tokenDoc.refreshToken });
      console.log('[SYNC] Gmail auth initialized from stored token.');
    } else {
      console.log('[SYNC] No stored Gmail token. Visit /api/auth/gmail-connect to authorize.');
    }
  } catch (err) {
    console.error('[SYNC] Failed to initialize Gmail auth:', err.message);
  }
}

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/neohack')
  .then(async () => {
    console.log('Connected to MongoDB!');
    await initSyncAuth();
  })
  .catch(err => console.error('MongoDB Connection Error:', err));

async function addPlacement(record, companyName, emailDate, packageCTC) {
  const existing = await Placement.findOne({ neoId: record.neoId });
  
  if (!existing) {
    const entry = {
      name: record.name,
      neoId: record.neoId,
      regNo: record.regNo,
      source: companyName || "Unknown Company",
      packageCTC: packageCTC || "Undisclosed",
      timestamp: emailDate ? new Date(emailDate) : new Date()
    };
    await Placement.create(entry);
    console.log(`[EXTENSION] New placement found! Added ${record.name} (${record.neoId}) at ${companyName}`);
    return true;
  }
  return false;
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(cookieParser());

// Auth Helpers
function levenshtein(a, b) {
  if(a.length === 0) return b.length;
  if(b.length === 0) return a.length;
  var matrix = [];
  var i, j;
  for(i = 0; i <= b.length; i++) matrix[i] = [i];
  for(j = 0; j <= a.length; j++) matrix[0][j] = j;
  for(i = 1; i <= b.length; i++){
      for(j = 1; j <= a.length; j++){
          if(b.charAt(i-1) == a.charAt(j-1)){
              matrix[i][j] = matrix[i-1][j-1];
          } else {
              matrix[i][j] = Math.min(matrix[i-1][j-1] + 1, Math.min(matrix[i][j-1] + 1, matrix[i-1][j] + 1));
          }
      }
  }
  return matrix[b.length][a.length];
}

function getApprovedEmails() {
  try {
    const data = fs.readFileSync(path.join(__dirname, 'approved_emails.json'), 'utf8');
    return JSON.parse(data);
  } catch(e) {
    return [];
  }
}

function requireAuth(req, res, next) {
  const token = req.cookies.session;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, (process.env.JWT_SECRET || 'neohack-super-secret-key-2026'));
    next();
  } catch(e) {
    res.status(401).json({ error: 'Invalid session' });
  }
}

// requireAdmin ΓÇö authenticated AND isAdmin:true in JWT.
// Returns 403 (not 401) for logged-in non-admin users.
function requireAdmin(req, res, next) {
  const token = req.cookies.session;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, (process.env.JWT_SECRET || 'neohack-super-secret-key-2026'));
    if (!decoded.isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    req.user = decoded;
    next();
  } catch(e) {
    res.status(401).json({ error: 'Invalid session' });
  }
}

function requirePageAuth(req, res, next) {
  const token = req.cookies.session;
  if (!token) return res.redirect('/login.html');
  try {
    jwt.verify(token, (process.env.JWT_SECRET || 'neohack-super-secret-key-2026'));
    next();
  } catch(e) {
    res.redirect('/login.html');
  }
}

// requireAdminPage ΓÇö like requireAdmin but redirects instead of returning JSON
function requireAdminPage(req, res, next) {
  const token = req.cookies.session;
  if (!token) return res.redirect('/login.html');
  try {
    const decoded = jwt.verify(token, (process.env.JWT_SECRET || 'neohack-super-secret-key-2026'));
    if (!decoded.isAdmin) {
      return res.redirect('/');
    }
    req.user = decoded;
    next();
  } catch(e) {
    res.redirect('/login.html');
  }
}

// Auth Routes
app.post('/api/auth/google', async (req, res) => {
  const { token } = req.body;
  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: (process.env.GOOGLE_CLIENT_ID || '715718536052-1e0k29fr1n1156tekg966j1vli7cql30.apps.googleusercontent.com') || '715718536052-1e0k29fr1n1156tekg966j1vli7cql30.apps.googleusercontent.com',
    });
    const payload = ticket.getPayload();
    const email = payload.email.toLowerCase();
    
    const approved = getApprovedEmails().map(e => e.toLowerCase());
    
    if (approved.includes(email)) {
      // isAdmin derived server-side — never trust any flag from the client
      const isAdmin = (email === (process.env.ADMIN_EMAIL || 'mohit.23bai10262@vitbhopal.ac.in').toLowerCase());
      const sessionToken = jwt.sign({ email, isAdmin }, (process.env.JWT_SECRET || 'neohack-super-secret-key-2026') || 'neohack-super-secret-key-2026', { expiresIn: '24h' });
      res.cookie('session', sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production'
      });
      res.json({ success: true });
    } else {
      res.status(403).json({ error: 'Access denied: Email not approved by admin.' });
    }
  } catch (err) {
    res.status(401).json({ error: 'Invalid Google token.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ success: true });
});

app.get('/api/user', requireAuth, (req, res) => {
  res.json({ email: req.user.email, isAdmin: req.user.isAdmin });
});

app.post('/api/sync/manual', requireAuth, async (req, res) => {
  // Only allow mohit.23bai10262
  if (!req.user.email.toLowerCase().includes('mohit.23bai10262')) {
    return res.status(403).json({ error: 'Only mohit.23bai10262 can trigger manual sync.' });
  }
  
  if (!syncAuth) {
    return res.status(400).json({ error: 'Gmail auth not configured. Visit /api/auth/gmail-connect.' });
  }

  try {
    await runGmailSync(syncAuth, database, regDatabase, nameDatabase);
    res.json({ success: true, message: 'Sync completed successfully!' });
  } catch (error) {
    console.error('Manual sync failed:', error);
    res.status(500).json({ error: 'Manual sync failed: ' + error.message });
  }
});

// /api/me ΓÇö returns current session email + isAdmin flag.
// Used by the frontend to conditionally render admin-only UI.
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ email: req.user.email, isAdmin: req.user.isAdmin || false });
});

// /api/health ΓÇö public keepalive endpoint.
// Ping this from UptimeRobot / cron-job.org every 10 min to prevent
// Render free-tier from spinning down the instance (which would kill the cron).
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Debug endpoint to verify batch filtering
app.get('/api/debug-batch', requireAuth, async (req, res) => {
  const allPlacements = await Placement.find().lean();
  const batch23 = [];
  const batch22 = [];
  const noMatch = [];
  
  allPlacements.forEach(p => {
    const key = (p.neoId || '').toUpperCase();
    const student = database[key];
    const regNo = student ? student.regNo : p.regNo;
    
    if (regNo && regNo.startsWith('23')) batch23.push({ neoId: p.neoId, regNo, name: p.name });
    else if (regNo && regNo.startsWith('22')) batch22.push({ neoId: p.neoId, regNo, name: p.name });
    else noMatch.push({ neoId: p.neoId, regNoFromDB: p.regNo, regNoFromCSV: student ? student.regNo : 'NOT_IN_CSV', name: p.name });
  });
  
  res.json({
    totalPlacements: allPlacements.length,
    totalInMemoryDB: Object.keys(database).length,
    batch23Count: batch23.length,
    batch22Count: batch22.length,
    noMatchCount: noMatch.length,
    batch23Sample: batch23.slice(0, 5),
    batch22Sample: batch22.slice(0, 5),
    noMatchSample: noMatch.slice(0, 10)
  });
});

// Gmail OAuth routes (connect + callback)
app.use('/api/auth', gmailAuthRouter);

// In-memory database
let database = {}; // Neo ID -> record
let regDatabase = {}; // Reg No -> record
let nameDatabase = {}; // Name (lowercase) -> array of records
let totalStudents = 0;

function splitCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { result.push(current); current = ""; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

function loadDatabase() {
    try {
      const csvPath = path.join(__dirname, 'Bain shortlist.xlsx - Sheet2.csv');
      const csvData = fs.readFileSync(csvPath, 'utf8');
      
      let isFormat2 = false;
      const lines = csvData.split(/\r?\n/).filter(l => l.trim());
      for (let i = 0; i < lines.length; i++) {
        const cols = splitCSVLine(lines[i]);

        // Detect transition to the new format
        if (cols[0] && cols[0].trim().toLowerCase() === 'username' && cols[1] && cols[1].trim().toLowerCase() === 'name') {
          isFormat2 = true;
          continue;
        }

        if (cols.length < 4) continue;
        
        let email = "", name = "", regNo = "", neoId = "", offEmail = "";
        let tenth = null, twelfth = null, cgpa = null;

        if (!isFormat2) {
          email = cols[0] ? cols[0].trim() : "";
          name = cols[1] ? cols[1].trim() : "";
          regNo = cols[2] ? cols[2].trim() : "";
          neoId = cols[3] ? cols[3].trim().toUpperCase() : "";
          offEmail = cols[4] ? cols[4].trim() : "";
        } else {
          // Format 2: Username,Name,Neo ID,Reg No,10th marks,Type 1,CGPA,Type 2,12th marks,Type 3
          email = cols[0] ? cols[0].trim() : "";
          name = cols[1] ? cols[1].trim() : "";
          neoId = cols[2] ? cols[2].trim().toUpperCase() : "";
          regNo = cols[3] ? cols[3].trim() : "";
          tenth = (cols[4] && cols[4].trim() !== '-') ? cols[4].trim() : null;
          cgpa = (cols[6] && cols[6].trim() !== '-') ? cols[6].trim() : null;
          twelfth = (cols[8] && cols[8].trim() !== '-') ? cols[8].trim() : null;
        }
        
        if (!neoId || neoId === '-') continue;
        
        const record = { name, regNo, email, offEmail, neoId, tenth, twelfth, cgpa };
        
        // If the record already exists, merge the new fields instead of completely overwriting
        if (database[neoId]) {
          if (tenth) database[neoId].tenth = tenth;
          if (twelfth) database[neoId].twelfth = twelfth;
          if (cgpa) database[neoId].cgpa = cgpa;
        } else {
          database[neoId] = record;
        }
        
        if (regNo && regNo !== '-') regDatabase[regNo.toUpperCase()] = database[neoId];
        
        const lowerName = name.toLowerCase();
        if (!nameDatabase[lowerName]) nameDatabase[lowerName] = [];
        nameDatabase[lowerName].push(database[neoId]);
      }
      
      totalStudents = Object.keys(database).length;
      console.log(`Successfully loaded ${totalStudents} students into memory.`);
    } catch (err) {
      console.error("Failed to load database. Make sure the CSV file exists.", err);
    }
}

// Load DB on startup
loadDatabase();

// API endpoint for looking up Neo IDs
app.post('/api/lookup', requireAuth, async (req, res) => {
  const queries = req.body.queries || [];
  
  if (!Array.isArray(queries)) {
    return res.status(400).json({ error: "queries must be an array of Neo IDs" });
  }

  const results = {};
  const allFoundStudents = [];
  
  queries.forEach(query => {
    const uppercaseQuery = query.toUpperCase();
    
    if (database[uppercaseQuery]) {
      const student = { ...database[uppercaseQuery] };
      results[uppercaseQuery] = [student];
      allFoundStudents.push(student);
    } else if (regDatabase[uppercaseQuery]) {
      const student = { ...regDatabase[uppercaseQuery] };
      results[uppercaseQuery] = [student];
      allFoundStudents.push(student);
    } else {
      // Partial name search
      const matches = Object.values(database)
        .filter(r => r.name.toUpperCase().includes(uppercaseQuery))
        .map(r => ({ ...r }));
      if (matches.length > 0) {
        results[uppercaseQuery] = matches;
        allFoundStudents.push(...matches);
      }
    }
  });

  // Cross-reference with Placements to see if they are placed
  if (allFoundStudents.length > 0) {
    const neoIds = allFoundStudents.map(s => s.neoId).filter(Boolean);
    if (neoIds.length > 0) {
      const placements = await Placement.find({ neoId: { $in: neoIds } }).lean();
      const placementMap = {};
      placements.forEach(p => {
        if (p.neoId) placementMap[p.neoId.toUpperCase()] = p;
      });
      
      allFoundStudents.forEach(student => {
        if (student.neoId && placementMap[student.neoId.toUpperCase()]) {
          student.isPlaced = true;
          student.placementSource = placementMap[student.neoId.toUpperCase()].source;
        }
      });
    }
  }

  res.json({ results, totalStudents });
});

app.get('/api/companies', async (req, res) => {
  try {
    const companies = await Company.find().sort({ name: 1 }).lean();
    res.json(companies);
  } catch (err) {
    res.status(500).json({ error: 'Server error fetching companies' });
  }
});

// API endpoint for comprehensive branch stats
app.get('/api/stats', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const batchFilter = req.query.batch;
  
  let placements = await Placement.find().sort({ timestamp: -1 }).lean();
  let studentsToConsider = Object.values(database);
  
  if (batchFilter) {
    placements = placements.filter(p => {
      const key = (p.neoId || '').toUpperCase();
      const student = database[key];
      const actualRegNo = student ? student.regNo : p.regNo;
      return actualRegNo && actualRegNo.startsWith(batchFilter);
    });
    studentsToConsider = studentsToConsider.filter(s => s.regNo && s.regNo.startsWith(batchFilter));
  }
  
  const placedNeoIds = new Set(placements.map(p => (p.neoId || '').toUpperCase()));
    const branchStats = {};
    
    studentsToConsider.forEach(student => {
      const match = student.regNo.match(/[0-9]{2}([A-Z]+)[0-9]+/);
      const branch = match ? match[1] : "OTHER";
      
      if (!branchStats[branch]) {
        branchStats[branch] = { total: 0, placed: 0, unplaced: 0, placedStudents: [] };
      }
      
      branchStats[branch].total += 1;
      if (placedNeoIds.has(student.neoId)) {
        branchStats[branch].placed += 1;
        // Find company they were placed at from placements array
        const placement = placements.find(p => p.neoId === student.neoId);
        branchStats[branch].placedStudents.push({
          name: student.name,
          neoId: student.neoId,
          regNo: student.regNo,
          source: placement ? placement.source : "Unknown"
        });
      } else {
        branchStats[branch].unplaced += 1;
      }
    });

  // Calculate Student-based CTC Math for VIT Bhopal
  let numericPackages = [];
  let highestPackage = 0;

  // Calculate Company Stats
  const companiesFromDB = await Company.find().lean();
  const companyStats = {};
  
  // Pre-fill companies from DB
  companiesFromDB.forEach(c => {
    companyStats[c.name] = { 
      totalPlaced: c.totalVitPlaced, 
      vitBhopalPlaced: 0, 
      packageCTC: c.packageCTC || 'Undisclosed',
      hiringDone: c.hiringDone || false
    };
  });

  placements.forEach(p => {
    const comp = p.source || "Unknown";
    if (!companyStats[comp]) {
      companyStats[comp] = { totalPlaced: 0, vitBhopalPlaced: 0, packageCTC: p.packageCTC || 'Undisclosed', hiringDone: false };
    }
    
    // Check if VIT Bhopal
    const student = database[(p.neoId || '').toUpperCase()];
    if (student && student.offEmail && student.offEmail.toLowerCase().includes('vitbhopal.ac.in')) {
      companyStats[comp].vitBhopalPlaced += 1;
      
      // Attempt to parse package for Bhopal math
      let numericVal = 0;
      if (p.packageCTC && p.packageCTC !== 'Undisclosed') {
        const match = p.packageCTC.match(/[\d.]+/);
        if (match) {
          numericVal = parseFloat(match[0]);
        }
      } 
      
      if (numericVal === 0) {
        // Fallback to company DB if exist
        const dbComp = companiesFromDB.find(c => c.name === comp);
        if (dbComp && dbComp.numericPackage > 0) numericVal = dbComp.numericPackage;
      }

      if (numericVal > 0) {
        numericPackages.push(numericVal);
        if (numericVal > highestPackage) highestPackage = numericVal;
      }
    }
  });
  
  // Average and Median
  let avgPackage = 0;
  let medianPackage = 0;
  if (numericPackages.length > 0) {
    numericPackages.sort((a, b) => a - b);
    const sum = numericPackages.reduce((acc, val) => acc + val, 0);
    avgPackage = (sum / numericPackages.length).toFixed(2);
    
    const mid = Math.floor(numericPackages.length / 2);
    medianPackage = numericPackages.length % 2 !== 0 
        ? numericPackages[mid] 
        : ((numericPackages[mid - 1] + numericPackages[mid]) / 2).toFixed(2);
  }

  const cgpaStats = {
    '9-10': { placed: 0, unplaced: 0 },
    '8-9': { placed: 0, unplaced: 0 },
    '7-8': { placed: 0, unplaced: 0 },
    '6-7': { placed: 0, unplaced: 0 },
    'Below 6': { placed: 0, unplaced: 0 },
    'Unknown': { placed: 0, unplaced: 0 }
  };

  studentsToConsider.forEach(student => {
    let bin = 'Unknown';
    if (student.cgpa) {
      const gpa = parseFloat(student.cgpa);
      if (!isNaN(gpa)) {
        if (gpa >= 9) bin = '9-10';
        else if (gpa >= 8) bin = '8-9';
        else if (gpa >= 7) bin = '7-8';
        else if (gpa >= 6) bin = '6-7';
        else bin = 'Below 6';
      }
    }
    
    if (placedNeoIds.has(student.neoId)) {
      cgpaStats[bin].placed += 1;
    } else {
      cgpaStats[bin].unplaced += 1;
    }
  });

  res.json({
    totalStudents: studentsToConsider.length,
    totalPlaced: placedNeoIds.size,
    branchStats,
    companyStats,
    cgpaStats,
    ctcStats: {
      avg: avgPackage,
      median: medianPackage,
      highest: highestPackage
    }
  });
});

// API endpoint for recent placements
app.get('/api/recent', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const batchFilter = req.query.batch;
  let placements = await Placement.find().sort({ timestamp: -1 }).lean();
  
  // Enrich every placement with regNo from CSV database
  placements = placements.map(p => {
    const key = (p.neoId || '').toUpperCase();
    const student = database[key];
    if (student && student.regNo) {
      p.regNo = student.regNo;
    }
    return p;
  });
  
  // Now filter by regNo prefix
  if (batchFilter) {
    placements = placements.filter(p => p.regNo && p.regNo.startsWith(batchFilter));
  }
  
  // Calculate company stats
  const companyStats = {};
  placements.forEach(p => {
    const comp = p.source || "Unknown";
    companyStats[comp] = (companyStats[comp] || 0) + 1;
  });

  res.json({
    recent: placements,
    totalPlaced: placements.length,
    companyStats: companyStats,
    placements: placements
  });
});

const NEOHACK_API_KEY = process.env.NEOHACK_API_KEY || 'admin_secret_9942';

app.post('/api/add-company', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== NEOHACK_API_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized Extension' });
  }
  const { companyName, packageCTC } = req.body;
  if (!companyName) {
    return res.status(400).json({ error: 'Missing companyName' });
  }

  try {
    let numericPackage = 0;
    if (packageCTC) {
      const match = packageCTC.match(/[\d.]+/);
      if (match) numericPackage = parseFloat(match[0]);
    }
    
    await Company.findOneAndUpdate(
      { name: companyName },
      { packageCTC: packageCTC || 'Undisclosed', numericPackage },
      { upsert: true, new: true }
    );
    res.json({ success: true, message: `Company ${companyName} tracked!` });
  } catch(err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/add-companies-bulk', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== NEOHACK_API_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized Extension' });
  }

  const { companies } = req.body;
  if (!companies || !Array.isArray(companies)) {
    return res.status(400).json({ error: 'Missing or invalid companies array' });
  }

  try {
    const operations = companies.map(comp => {
      let numericPackage = 0;
      if (comp.packageCTC) {
        const match = comp.packageCTC.match(/[\d.]+/);
        if (match) numericPackage = parseFloat(match[0]);
      }
      return {
        updateOne: {
          filter: { name: comp.companyName },
          update: { 
            $set: { 
              packageCTC: comp.packageCTC || 'Undisclosed', 
              numericPackage: numericPackage 
            } 
          },
          upsert: true
        }
      };
    });

    if (operations.length > 0) {
      await Company.bulkWrite(operations);
    }
    
    res.json({ success: true, message: `Successfully tracked ${companies.length} companies!` });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during bulk insert' });
  }
});

// API endpoint for Chrome Extension to add a placement
app.post('/api/add-placement', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== NEOHACK_API_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized Extension' });
  }

  const { possibleIds, companyName, emailDate, emailText, packageCTC } = req.body;
  if (!possibleIds || !Array.isArray(possibleIds)) {
    return res.status(400).json({ error: 'Missing possible IDs' });
  }

  try {
    let finalCompanyName = companyName;
    let addedStudents = [];
    let trackedStudents = [];

  // Auto-map if the email subject contains a tracked company's name
  const existingCompanies = await Company.find().lean();
  // Sort by name length ascending so we match 'Incedo' before 'Congratulations!! Incedo...'
  existingCompanies.sort((a, b) => a.name.length - b.name.length);
  
  const matchedCompany = existingCompanies.find(c => {
    const cNameLower = c.name.toLowerCase();
    const emailLower = companyName.toLowerCase();
    // E.g. "Groww" is in "Congratulations!! Groww Super Dream Internship"
    return emailLower.includes(cNameLower) || cNameLower.includes(emailLower);
  });

  if (matchedCompany) {
    finalCompanyName = matchedCompany.name;
  }
  
  // Track Total VIT Placements in Company
  // $inc (not $set) ΓÇö accumulate across calls rather than overwriting.
  // The overlap guard in gmailSync.js prevents double-counting from cron.
  await Company.findOneAndUpdate(
    { name: finalCompanyName },
    { $inc: { totalVitPlaced: possibleIds.length } },
    { upsert: true }
  );

  // 1. Check by explicit IDs (Neo ID or Reg No)
  for (let id of possibleIds) {
    const query = id.toUpperCase();
    let foundRecord = database[query] || regDatabase[query];
    
    if (!foundRecord) {
      // Fuzzy matching for CDC typos in Neo IDs (max distance 2)
      let minDistance = Infinity;
      let bestMatch = null;
      for (const neoId of Object.keys(database)) {
        const dist = levenshtein(query, neoId);
        if (dist < minDistance) {
          minDistance = dist;
          bestMatch = neoId;
        }
      }
      if (minDistance <= 2 && bestMatch) {
        console.log(`[FUZZY MATCH] CDC typo detected: ${query} matched to ${bestMatch} (distance: ${minDistance})`);
        foundRecord = database[bestMatch];
      }
    }

    if (foundRecord) {
      const added = await addPlacement(foundRecord, finalCompanyName, emailDate, packageCTC);
      if (added) {
        addedStudents.push(foundRecord.name);
      } else {
        trackedStudents.push(foundRecord.name);
      }
    }
  }

  // 2. Check by exact name match in email text (if provided)
  if (emailText) {
    const textLower = emailText.toLowerCase();
    for (const [nameKey, studentsArray] of Object.entries(nameDatabase)) {
      // Only process names that are at least 4 characters to avoid false matches on short words
      if (nameKey.length >= 4 && textLower.includes(nameKey)) {
        // Use a word boundary regex to ensure we matched the full name, not a substring
        // Escape the nameKey for regex safety
        const safeName = nameKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${safeName}\\b`, 'i');
        
        if (regex.test(emailText)) {
          // Rule: "dont add if duplicate names"
          if (studentsArray.length === 1) {
            const foundRecord = studentsArray[0];
            const added = await addPlacement(foundRecord, finalCompanyName, emailDate, packageCTC);
            if (added) {
              addedStudents.push(foundRecord.name);
            } else {
              trackedStudents.push(foundRecord.name);
            }
          }
        }
      }
    }
  }

    res.json({ 
      success: true, 
      message: `Tracked ${addedStudents.length} new placements for ${finalCompanyName}. Found ${trackedStudents.length} total.` 
    });
  } catch (error) {
    console.error("Error in /api/add-placement:", error);
    res.status(500).json({ success: false, error: 'Internal server error while tracking placements' });
  }
});

// Protect index.html
app.get('/', requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/index.html', requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/review.html', requireAdminPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'review.html'));
});

// POST /api/sync-gmail ΓÇö admin only manual trigger.
// The background cron calls runGmailSync directly; this endpoint is an
// admin escape hatch for on-demand syncs.
app.post('/api/sync-gmail', requireAdmin, async (req, res) => {
  try {
    if (!syncAuth) {
      return res.status(503).json({
        error: 'Gmail sync not configured. Visit /api/auth/gmail-connect to authorize.'
      });
    }
    const result = await runGmailSync(syncAuth, database, regDatabase, nameDatabase);
    if (result === null) {
      return res.json({ success: true, message: 'Sync already in progress ΓÇö skipping.' });
    }
    res.json({
      success: true,
      message: `Synced! ${result.newPlacements} new placements from ${result.emailsScanned} emails scanned.`
    });
  } catch (error) {
    console.error('Gmail Sync Error:', error);
    res.status(500).json({ error: 'Failed to sync with Gmail.' });
  }
});

// GET /api/sync-logs ΓÇö admin only; last 20 cron run records.
app.get('/api/sync-logs', requireAdmin, async (req, res) => {
  try {
    const logs = await SyncLog.find().sort({ startedAt: -1 }).limit(20).lean();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sync logs.' });
  }
});

// ΓöÇΓöÇ Admin Review Queue ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

// GET /api/pending-review ΓÇö unreviewed items, newest first
app.get('/api/pending-review', requireAdmin, async (req, res) => {
  try {
    const items = await PendingReview.find({ reviewed: false })
      .sort({ timestamp: -1 })
      .lean();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch review queue.' });
  }
});

// POST /api/pending-review/:id/approve
// Dedup check ΓåÆ write to Placement ΓåÆ mark reviewed:true, decision:'approved'
app.post('/api/pending-review/:id/approve', requireAdmin, async (req, res) => {
  try {
    const item = await PendingReview.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Review item not found.' });
    if (item.reviewed) return res.status(409).json({ error: 'Already reviewed.' });

    let placementCreated = false;

    if (item.neoId) {
      // Dedup ΓÇö skip if already placed
      const existing = await Placement.findOne({ neoId: item.neoId });
      if (!existing) {
        await Placement.create({
          name:       item.name,
          neoId:      item.neoId,
          source:     item.extractedCompanyName || 'Unknown Company',
          packageCTC: item.extractedCTC         || 'Undisclosed',
          timestamp:  item.timestamp
        });

        if (item.extractedCompanyName) {
          await Company.findOneAndUpdate(
            { name: item.extractedCompanyName },
            { $inc: { totalVitPlaced: 1 }, $set: { hiringDone: true } },
            { upsert: true }
          );
        }
        placementCreated = true;
        console.log(`[REVIEW] Approved: ${item.name} (${item.neoId}) ΓåÆ ${item.extractedCompanyName}`);
      } else {
        console.log(`[REVIEW] Approved but already placed: ${item.neoId} ΓÇö skipping Placement write.`);
      }
    }

    await PendingReview.findByIdAndUpdate(req.params.id, {
      reviewed:  true,
      decision:  'approved',
      decidedAt: new Date()
    });

    res.json({ success: true, placementCreated });
  } catch (err) {
    console.error('[REVIEW] Approve error:', err.message);
    res.status(500).json({ error: 'Failed to approve review item.' });
  }
});

// POST /api/pending-review/:id/reject
// Marks reviewed:true, decision:'rejected' ΓÇö never writes to Placement
app.post('/api/pending-review/:id/reject', requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const item = await PendingReview.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Review item not found.' });
    if (item.reviewed) return res.status(409).json({ error: 'Already reviewed.' });

    await PendingReview.findByIdAndUpdate(req.params.id, {
      reviewed:  true,
      decision:  'rejected',
      reason:    reason || null,
      decidedAt: new Date()
    });

    console.log(`[REVIEW] Rejected: ${item.neoId || 'no-id'} | reason: ${reason || 'none'}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[REVIEW] Reject error:', err.message);
    res.status(500).json({ error: 'Failed to reject review item.' });
  }
});

// Serve static frontend files (exclude index.html from default root behavior)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`NeoHack Backend is running on port ${PORT}`);
  console.log(`=========================================`);
});
