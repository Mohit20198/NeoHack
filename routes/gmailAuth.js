/**
 * routes/gmailAuth.js
 * ─────────────────────────────────────────────────────────────────────────────
 * One-time offline OAuth 2.0 consent flow so the background cron can
 * authenticate without user interaction.
 *
 * Endpoints (mounted at /api/auth in server.js):
 *   GET /api/auth/gmail-connect   — requireAdmin — redirects to Google consent
 *   GET /api/auth/gmail-callback  — Google redirects here with auth code
 *
 * After a successful callback the refresh token is stored in MongoDB
 * (GmailToken collection). The server reads it on startup via initSyncAuth().
 *
 * One-time setup steps:
 *   1. Make sure GOOGLE_CLIENT_SECRET and GMAIL_REDIRECT_URI are in .env
 *   2. Add the GMAIL_REDIRECT_URI to your OAuth 2.0 client's "Authorized
 *      redirect URIs" in the Google Cloud Console
 *   3. While logged in as the admin account, visit /api/auth/gmail-connect
 *   4. Approve the Gmail readonly scope
 *   5. Restart the server — initSyncAuth() will load the token automatically
 */

require('dotenv').config();
const express    = require('express');
const router     = express.Router();
const jwt        = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const GmailToken = require('../models/GmailToken');

// ── Local requireAdmin (avoids circular dependency with server.js) ────────────
function requireAdmin(req, res, next) {
  const token = req.cookies.session;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid session' });
  }
}

function getOAuthClient() {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/api/auth/gmail-callback'
  );
}

// ── GET /api/auth/gmail-connect ───────────────────────────────────────────────
// Admin only. Redirects to Google's consent page requesting offline access.
router.get('/gmail-connect', requireAdmin, (req, res) => {
  if (!process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).send(
      '<h2>❌ GOOGLE_CLIENT_SECRET is not set in .env</h2>' +
      '<p>Add it from your Google Cloud Console OAuth 2.0 credentials, then restart the server.</p>'
    );
  }
  const oAuth2Client = getOAuthClient();
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent',   // force re-issue of refresh_token even if previously granted
    scope:       ['https://www.googleapis.com/auth/gmail.readonly']
  });
  res.redirect(authUrl);
});

// ── GET /api/auth/gmail-callback ──────────────────────────────────────────────
// Google redirects here after the user approves. No auth middleware — Google
// sends the code as a query param; we exchange it for tokens immediately.
router.get('/gmail-callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('<h2>❌ Missing authorization code.</h2>');
  }

  try {
    const oAuth2Client    = getOAuthClient();
    const { tokens }      = await oAuth2Client.getToken(code);

    if (!tokens.refresh_token) {
      return res.status(400).send(
        '<h2>❌ No refresh token received.</h2>' +
        '<p>This usually means the account already granted access without <code>prompt: consent</code>. ' +
        'Revoke access at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a> ' +
        'and then visit <a href="/api/auth/gmail-connect">/api/auth/gmail-connect</a> again.</p>'
      );
    }

    // Persist to MongoDB — single document, always upserted
    await GmailToken.findOneAndUpdate(
      {},
      {
        refreshToken: tokens.refresh_token,
        accountEmail: process.env.ADMIN_EMAIL || 'admin',
        updatedAt:    new Date()
      },
      { upsert: true, new: true }
    );

    console.log('[AUTH] ✔ Gmail refresh token stored. Restart server to activate background sync.');

    res.send(
      '<h2>✅ Gmail authorization successful!</h2>' +
      '<p>The refresh token has been stored in MongoDB.</p>' +
      '<p><strong>Restart the server</strong> to activate the background cron job, ' +
      'then close this tab.</p>'
    );
  } catch (err) {
    console.error('[AUTH] Gmail callback error:', err.message);
    res.status(500).send('<h2>❌ Authorization failed</h2><pre>' + err.message + '</pre>');
  }
});

module.exports = router;
