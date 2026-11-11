import fs from 'node:fs';
import {flattenClosingLedger,closingDaySummary} from '../../functions/api/_closing30-ledger.js';
const ledgers=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const records=ledgers.flatMap(flattenClosingLedger);
const daily=ledgers.flatMap(ledger=>['closing30','closing_bet'].map(strategy=>({strategy,...closingDaySummary(ledger,strategy)})));
fs.writeFileSync(process.argv[3],JSON.stringify({records,daily}));
