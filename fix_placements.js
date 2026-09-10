const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const Company = require('./models/Company');
  const Placement = require('./models/Placement');
  
  const existingCompanies = await Company.find().lean();
  existingCompanies.sort((a, b) => a.name.length - b.name.length);
  
  const placements = await Placement.find().lean();
  let updatedCount = 0;
  
  for (let p of placements) {
    if (p.source && (p.source.toLowerCase().includes('congratulations') || p.source.toLowerCase().includes('selection list'))) {
      const matchedCompany = existingCompanies.find(c => {
        const cNameLower = c.name.toLowerCase();
        const pSourceLower = p.source.toLowerCase();
        return pSourceLower.includes(cNameLower) || cNameLower.includes(pSourceLower);
      });
      
      if (matchedCompany) {
        await Placement.updateOne({ _id: p._id }, { $set: { source: matchedCompany.name } });
        updatedCount++;
      }
    }
  }
  console.log(`Updated ${updatedCount} placements with correct company names.`);
  process.exit(0);
});
