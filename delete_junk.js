const mongoose = require('mongoose');
require('dotenv').config();

const junkNames = [
  "Date & batch Update : AU Small Finance Bank Limited physical selection process is scheduled on 15th September @ Chennai office",
  "Congratulations!! Aumovio Dream internship selection list 2027 Batch",
  "Congratulations!! Dell Technologies Super Dream (Summer Internship) PPO selection list 2027 batch",
  "Voxela next round of selection process is scheduled on 11th September 2026 by 9.30 am - CDC Office (SJT717)",
  "Congratulations !! Danfoss Super Dream Internship selection list 2027 batch !!",
  "Congratulations!! MUFG Super Dream Internship Selection List 2027 Batch !! (SET 6) !!",
  "Re: 9 CGPA and above meeting (LC202 & Lc203)",
  "Congratulations!! Kinaxis Super Dream Internship Selection List – 2027 !!",
  "Congratulations !! Flipkart Super Dream Internship / Placement Offer selection list ( Assistant Manager NEEV ) 2027 batch !!",
  "Congratulations!! CHUBB Super Dream Internship Selection List – 2027",
  "Congratulations!! Incedo Super Dream Internship Selection List - 2027 Batch.",
  "Re: Placed students in hostel and nearby",
  "Embitel Technologies Super Dream Internship Registration - 2027 Batch",
  "Neostats next round of selection process (assignment round) is scheduled on 10th September 2026 from 11:30 AM - Virtual mode @ Own location",
  "Tata imagination challenge 2026",
  "Bottomline Next round of selection process is scheduled on 10th September 2026 at SJT 719 @ VIT Vellore campus",
  "Squadstack.ai interview is scheduled on 10th Sep 2026 by 9.00am @ SJT 717 Vellore CDC office",
  "Congratulations!! Honeywell Super Dream Internship Additional Selection List 2027 batch.",
  "Congratulations!! Fractal Analytics Super Dream Offer Selection List 2027 Batch",
  "Congratulations !! Futures First Super Dream Internship selection list 2027 batch!!",
  "Restricted offer - unplaced only",
  "Virtusa Jatayu Season - 6 registrations are now open",
  "Palo Alto Next round of selection process is scheduled on 10th & 11th September 2026 by 9.00 am - Respective campus",
  "Paytm Innovation Challenge 2026 - Registrations Open till 5th September",
  "Pon Pure Chemicals Group - Dream Core Offer - B.Tech Chemical 2027 Batch",
  "Sigmoid Analytics Dream Internship - 2027 Batch",
  "Infoedge India Limited - Dream Offer - MBA - 2027 Batch",
  "Congratulations !! Futures First Super Dream Internship selection list 2027 batch - Set - 2!!",
  "Congratulations !! Colgate Palmolive Super Dream Internship Selection List!!",
  "Revised Time: Bottomline Next round of selection process is scheduled on 9th September 2026 SJT 703 @ VIT Vellore campus - Report Immediately"
];

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  try {
    const result = await mongoose.connection.db.collection('companies').deleteMany({
      name: { $in: junkNames }
    });
    console.log(`Deleted ${result.deletedCount} junk entries.`);
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
});
