const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  packageCTC: { type: String, default: 'Undisclosed' },
  numericPackage: { type: Number, default: 0 },
  totalVitPlaced: { type: Number, default: 0 },
  hiringDone: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Company', companySchema);
