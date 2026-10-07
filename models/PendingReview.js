const mongoose = require('mongoose');

/**
 * PendingReview — admin review queue for placements that:
 *   a) failed the regex subject parser, AND
 *   b) Groq returned medium or low confidence (not auto-written to Placement)
 *
 * Kept permanently as an audit trail even after a decision is made.
 */
const pendingReviewSchema = new mongoose.Schema({
  // Student info — may be null if no Neo IDs were found in the email body
  name:  { type: String, default: null },
  neoId: { type: String, default: null },

  // Extracted data
  extractedCompanyName: { type: String, default: null },
  extractedCTC:         { type: String, default: null },

  // Email context (for the reviewer to inspect the raw source)
  subject:         { type: String, required: true },
  extractionSource: { type: String, required: true }, // e.g. 'groq-medium', 'groq-low'
  timestamp:       { type: Date, default: Date.now },

  // Review decision
  reviewed:   { type: Boolean, default: false },
  decision:   { type: String, enum: ['approved', 'rejected', null], default: null },
  reason:     { type: String, default: null },   // populated on rejection
  decidedAt:  { type: Date,   default: null }
});

// Index for fast pending-queue queries
pendingReviewSchema.index({ reviewed: 1, timestamp: -1 });

module.exports = mongoose.model('PendingReview', pendingReviewSchema);
