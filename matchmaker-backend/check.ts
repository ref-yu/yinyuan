import { db } from './src/db.js';

async function check() {
  const users = await db.user.findMany();
  console.log("Users:", users);
  const records = await db.matchRecord.findMany();
  console.log("MatchRecords:", records);
}
check().finally(() => process.exit(0));
