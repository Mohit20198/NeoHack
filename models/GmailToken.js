const mongoose = require('mongoose');

// Single-document collection — always upserted, never duplicated.
// Stores the admin's Gmail refresh token so the cron can authenticate
// headlessly without re-prompting.
const gmailTokenSchema = new mongoose.Schema({
  accountEmail: { type: String, required: true },
  refreshToken: { type: String, required: true },
  updatedAt:    { type: Date, default: Date.now }
});

module.exports = mongoose.model('GmailToken', gmailTokenSchema);
