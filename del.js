const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const result = await mongoose.connection.db.collection('companies').deleteMany({
    name: { $regex: /congratulations|re:|selection list/i }
  });
  console.log('Deleted junk companies:', result.deletedCount);
  process.exit(0);
});
