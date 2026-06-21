import { settleAll, slipTotals } from "@/lib/bets";
import betsJson from "@/data/bets.json";
import ruhanJson from "@/data/bets-ruhan.json";

const main = settleAll(betsJson as any);
const mt = slipTotals(main);
let ruhan: any = null;
try { ruhan = slipTotals(settleAll(ruhanJson as any)); } catch (e) {}
console.log(JSON.stringify({ main: mt, ruhan }, null, 0));
