const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const Placement = require('./models/Placement');
  const Company = require('./models/Company');
  
  const placements = await Placement.find({});
  let updated = 0;
  
  for (let p of placements) {
    if (p.source && p.source.toLowerCase().includes('congratulations')) {
      const match = p.source.match(/Congratulations\s*!!\s*(.*?)\s+(?:Super|Dream|Internship|Selection|Placement|Offer)/i);
      if (match) {
        const cleanName = match[1].trim();
        p.source = cleanName;
        await p.save();
        updated++;
        console.log(`Updated placement source to: ${cleanName}`);
      }
    }
  }
  
  const companies = await Company.find({});
  for (let c of companies) {
    if (c.name.toLowerCase().includes('congratulations')) {
      const match = c.name.match(/Congratulations\s*!!\s*(.*?)\s+(?:Super|Dream|Internship|Selection|Placement|Offer)/i);
      if (match) {
        const cleanName = match[1].trim();
        
        // check if cleanName company already exists
        const existing = await Company.findOne({ name: cleanName });
        if (existing) {
          existing.totalVitPlaced += c.totalVitPlaced;
          await existing.save();
          await Company.deleteOne({ _id: c._id });
          console.log(`Merged ${c.name} into ${cleanName}`);
        } else {
          c.name = cleanName;
          await c.save();
          console.log(`Renamed company to: ${cleanName}`);
        }
      }
    }
  }

  console.log(`Fixed ${updated} mismatched placement sources!`);
  process.exit(0);
});
