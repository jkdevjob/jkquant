import fs from 'node:fs';
import {normalizeGptReport} from '../functions/api/_gpt_morning_report.js';
const report=normalizeGptReport(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));
process.stdout.write(JSON.stringify(report));
