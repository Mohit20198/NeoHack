const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const Company = require('./models/Company');
  const Placement = require('./models/Placement');
  
  // 1. Delete all junk companies
  const companies = await Company.find().lean();
  let deleted = 0;
  for (const c of companies) {
    if (c.name.toLowerCase().includes('congratulations') || c.name.toLowerCase().includes('re:')) {
      await Company.deleteOne({ _id: c._id });
      deleted++;
    }
  }
  console.log(`Deleted ${deleted} junk companies.`);

  // 2. Refresh companies list and sort by length ascending
  const cleanCompanies = await Company.find().lean();
  cleanCompanies.sort((a, b) => a.name.length - b.name.length);

  // 3. Re-map placements
  const placements = await Placement.find().lean();
  let updated = 0;
  for (const p of placements) {
    if (p.source && (p.source.toLowerCase().includes('congratulations') || p.source.toLowerCase().includes('re:'))) {
      const matchedCompany = cleanCompanies.find(c => {
        return p.source.toLowerCase().includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(p.source.toLowerCase());
      });
      
      if (matchedCompany) {
        await Placement.updateOne({ _id: p._id }, { $set: { source: matchedCompany.name } });
        updated++;
      } else {
        console.log(`Could not find a match for placement source: ${p.source}`);
      }
    }
  }
  console.log(`Updated ${updated} placements to correct clean names.`);
  process.exit(0);
});
