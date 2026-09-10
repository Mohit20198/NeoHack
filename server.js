require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const GOOGLE_CLIENT_ID = '715718536052-1e0k29fr1n1156tekg966j1vli7cql30.apps.googleusercontent.com';
const JWT_SECRET = 'neohack-super-secret-key-2026';
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

const Placement = require('./models/Placement');
const Company = require('./models/Company');

mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/neohack")
  .then(() => console.log("Connected to MongoDB!"))
  .catch(err => console.error("MongoDB Connection Error:", err));

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
    jwt.verify(token, JWT_SECRET);
    next();
  } catch(e) {
    res.status(401).json({ error: 'Invalid session' });
  }
}

function requirePageAuth(req, res, next) {
  const token = req.cookies.session;
  if (!token) return res.redirect('/login.html');
  try {
    jwt.verify(token, JWT_SECRET);
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
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = payload.email.toLowerCase();
    
    const approved = getApprovedEmails().map(e => e.toLowerCase());
    
    if (approved.includes(email)) {
      const sessionToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: '24h' });
      res.cookie('session', sessionToken, { httpOnly: true, secure: false }); 
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
app.post('/api/lookup', requireAuth, (req, res) => {
  const queries = req.body.queries || [];
  
  if (!Array.isArray(queries)) {
    return res.status(400).json({ error: "queries must be an array of Neo IDs" });
  }

  const results = {};
  
  queries.forEach(query => {
    const uppercaseQuery = query.toUpperCase();
    
    if (database[uppercaseQuery]) {
      results[uppercaseQuery] = [database[uppercaseQuery]];
    } else if (regDatabase[uppercaseQuery]) {
      results[uppercaseQuery] = [regDatabase[uppercaseQuery]];
    } else {
      // Partial name search
      const matches = Object.values(database).filter(r => r.name.toUpperCase().includes(uppercaseQuery));
      if (matches.length > 0) {
        results[uppercaseQuery] = matches;
      }
    }
  });

  res.json({ results, totalStudents });
});

// API endpoint for comprehensive branch stats
app.get('/api/stats', requireAuth, async (req, res) => {
  const placements = await Placement.find().sort({ timestamp: -1 }).lean();
  const placedNeoIds = new Set(placements.map(p => p.neoId));
    const branchStats = {};
    
    Object.values(database).forEach(student => {
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
      packageCTC: c.packageCTC || 'Undisclosed' 
    };
  });

  placements.forEach(p => {
    const comp = p.source || "Unknown";
    if (!companyStats[comp]) {
      companyStats[comp] = { totalPlaced: 0, vitBhopalPlaced: 0, packageCTC: p.packageCTC || 'Undisclosed' };
    }
    
    // Check if VIT Bhopal
    const student = database[p.neoId];
    if (student && student.offEmail && student.offEmail.toLowerCase().includes('vitbhopal.ac.in')) {
      companyStats[comp].vitBhopalPlaced += 1;
      
      // Attempt to parse package for Bhopal math
      let numericVal = 0;
      if (p.packageCTC) {
        const match = p.packageCTC.match(/[\d.]+/);
        if (match) {
          numericVal = parseFloat(match[0]);
        }
      } else {
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

  // Calculate CGPA Stats
  const cgpaStats = {
    '9-10': { placed: 0, unplaced: 0 },
    '8-9': { placed: 0, unplaced: 0 },
    '7-8': { placed: 0, unplaced: 0 },
    '6-7': { placed: 0, unplaced: 0 },
    'Below 6': { placed: 0, unplaced: 0 },
    'Unknown': { placed: 0, unplaced: 0 }
  };

  Object.values(database).forEach(student => {
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
    totalStudents: Object.keys(database).length,
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
  const placements = await Placement.find().sort({ timestamp: -1 }).lean();
  
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

const NEOHACK_API_KEY = "admin_secret_9942";

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

  let addedStudents = [];
  let trackedStudents = [];
  
  // Track Total VIT Placements in Company
  await Company.findOneAndUpdate(
    { name: companyName },
    { $set: { totalVitPlaced: possibleIds.length } },
    { upsert: true }
  );

  // 1. Check by explicit IDs (Neo ID or Reg No)
  for (let id of possibleIds) {
    const query = id.toUpperCase();
    let foundRecord = database[query] || regDatabase[query];
    
    if (foundRecord) {
      const added = await addPlacement(foundRecord, companyName, emailDate, packageCTC);
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
            const added = await addPlacement(foundRecord, companyName, emailDate, packageCTC);
            if (added) {
              addedStudents.push(foundRecord.name);
            } else {
              trackedStudents.push(foundRecord.name);
            }
          } else {
            console.log(`[WARNING] Skipped ${nameKey} because multiple students share this exact name.`);
          }
        }
      }
    }
  }

  if (addedStudents.length > 0) {
    res.json({ success: true, message: `Added ${addedStudents.length} student(s)` });
  } else if (trackedStudents.length > 0) {
    res.json({ success: true, message: `Already tracked ${trackedStudents.length} student(s)` });
  } else {
    res.status(404).json({ error: 'Student not found in database' });
  }
});

// Protect index.html
app.get('/', requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});
app.get('/index.html', requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Serve static frontend files (exclude index.html from default root behavior)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`NeoHack Backend is running on port ${PORT}`);
  console.log(`=========================================`);
});
