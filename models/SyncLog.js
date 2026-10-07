const mongoose = require('mongoose');

const syncLogSchema = new mongoose.Schema({
  startedAt:     { type: Date, required: true },
  finishedAt:    { type: Date },
  status:        { type: String, enum: ['success', 'error'], required: true },

  // Top-level counts
  emailsScanned: { type: Number, default: 0 },
  newPlacements: { type: Number, default: 0 },
  error:         { type: String },             // populated only on status:'error'

  // Extraction breakdown — shows how much work Groq is doing vs regex
  regexMatches:      { type: Number, default: 0 }, // subject parsed by regex, auto-written
  groqHighConfidence:{ type: Number, default: 0 }, // Groq high → auto-written
  routedToReview:    { type: Number, default: 0 }, // Groq medium/low → PendingReview queue
  skipped:           { type: Number, default: 0 }  // unaccounted (e.g. Groq error + no students)
});

module.exports = mongoose.model('SyncLog', syncLogSchema);
