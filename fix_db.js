const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  try {
    const Placement = require('./models/Placement');
    const Company = require('./models/Company');

    // Find the bad company name
    const badName = "Congratulations!! Groww Super Dream Internship/ Placement Offer Selection List - 2027 Batch";
    const goodName = "Groww";

    // Update all placements that have the bad name as source
    const result = await mongoose.connection.db.collection('placements').updateMany(
      { source: badName },
      { $set: { source: goodName } }
    );
    console.log(`Updated ${result.modifiedCount} placements to point to Groww.`);

    // Update the totalVitPlaced for Groww
    const badCompany = await mongoose.connection.db.collection('companies').findOne({ name: badName });
    if (badCompany) {
      await mongoose.connection.db.collection('companies').updateOne(
        { name: goodName },
        { $inc: { totalVitPlaced: badCompany.totalVitPlaced || 0 } }
      );
      // Delete the bad company
      await mongoose.connection.db.collection('companies').deleteOne({ name: badName });
      console.log(`Deleted bad company row and merged its count.`);
    }

  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
});
