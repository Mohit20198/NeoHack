const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const companies = await mongoose.connection.db.collection('companies').find().toArray();
  let count = 0;
  for (let c of companies) {
    if (c.name.toLowerCase().includes('congratulations') || c.name.toLowerCase().includes('selection list')) {
      await mongoose.connection.db.collection('companies').deleteOne({ _id: c._id });
      count++;
    }
  }
  console.log('Deleted junk companies:', count);
  process.exit(0);
});
