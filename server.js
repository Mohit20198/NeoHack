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

mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/neohack")
  .then(() => console.log("Connected to MongoDB!"))
  .catch(err => console.error("MongoDB Connection Error:", err));

async function addPlacement(record, companyName, emailDate) {
  const existing = await Placement.findOne({ neoId: record.neoId });
  
  if (!existing) {
    const entry = {
      name: record.name,
      neoId: record.neoId,
      regNo: record.regNo,
      source: companyName || "Unknown Company",
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
    
    const lines = csvData.split(/\r?\n/).filter(l => l.trim());
    for (let i = 1; i < lines.length; i++) {
      const cols = splitCSVLine(lines[i]);
      if (cols.length < 5) continue;
      
      const email = cols[0].trim();
      const name = cols[1].trim();
      const regNo = cols[2].trim();
      const neoId = cols[3].trim().toUpperCase();
      const offEmail = cols[4].trim();
      
      if (!neoId) continue;
      
      const record = { name, regNo, email, offEmail, neoId };
      database[neoId] = record;
      
      if (regNo && regNo !== "-") {
        regDatabase[regNo.toUpperCase()] = record;
      }

      // Populate name database for reverse-lookup by name
      const lowerName = name.toLowerCase();
      if (!nameDatabase[lowerName]) {
        nameDatabase[lowerName] = [];
      }
      nameDatabase[lowerName].push(record);
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

  res.json({
    totalStudents: Object.keys(database).length,
    totalPlaced: placedNeoIds.size,
    branchStats
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

// API endpoint for Chrome Extension to add a placement
app.post('/api/add-placement', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== NEOHACK_API_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized Extension' });
  }

  const { possibleIds, companyName, emailDate, emailText } = req.body;
  if (!possibleIds || !Array.isArray(possibleIds)) {
    return res.status(400).json({ error: 'Missing possible IDs' });
  }

  let addedStudents = [];
  let trackedStudents = [];
  
  // 1. Check by explicit IDs (Neo ID or Reg No)
  for (let id of possibleIds) {
    const query = id.toUpperCase();
    let foundRecord = database[query] || regDatabase[query];
    
    if (foundRecord) {
      const added = await addPlacement(foundRecord, companyName, emailDate);
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
            const added = await addPlacement(foundRecord, companyName, emailDate);
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
