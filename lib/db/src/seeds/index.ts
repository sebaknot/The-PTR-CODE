import { seedPorterBoxes } from "./porterBoxes";
import { pool } from "../index";

async function main() {
  console.log("Running seeds...");
  await seedPorterBoxes();
  console.log("Seeds complete.");
  await pool.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
