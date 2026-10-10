import { loadConfig } from "../config.ts";
import { Db } from "./database.ts";
import { Ledger } from "../rewards/ledger.ts";

const cfg = loadConfig();
const db = new Db(cfg.databasePath);
const applied = db.migrate();
new Ledger(db).ensureCampaigns();
console.log(applied.length ? `Applied migrations: ${applied.join(", ")}` : "Database up to date.", `(${cfg.databasePath})`);
db.close();
