const mongoose = require('mongoose');

const placementSchema = new mongoose.Schema({
  name: { type: String, required: true },
  neoId: { type: String, required: true },
  regNo: { type: String },
  source: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Placement', placementSchema);
