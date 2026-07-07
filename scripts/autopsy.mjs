// Leak autopsy: grade every special + per-leg breakdown for multiLeg accas.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const jiti = require('jiti')(process.cwd(), { interopDefault: true, alias: { '@': process.cwd() } });
const bets = jiti('./lib/bets.ts');
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('data/bets.json','utf8'));
const specials = (data.specials||[]).filter(s=>!s.punter); // Rj only

let staked=0, ret=0, wonN=0, lostN=0, pendN=0, voidN=0;
const kindStats = {}; // kind -> {won,lost,pending}
const legCount = {won:{},lost:{}}; // legs-per-slip histogram by outcome
const lostSlips=[];

for (const s of specials) {
  const status = bets.gradeSpecial(s);
  staked += s.stake||0;
  if (status==='won'){ wonN++; ret += (s.stake||0)*(s.odds||0); }
  else if (status==='lost') lostN++;
  else if (status==='void'){ voidN++; ret += s.stake||0; }
  else pendN++;

  const g=s.grade; if(!g) continue;
  const nLegs = g.legs? g.legs.length : 1;
  if(status==='won') legCount.won[nLegs]=(legCount.won[nLegs]||0)+1;
  if(status==='lost') legCount.lost[nLegs]=(legCount.lost[nLegs]||0)+1;

  if (g.type==='multiLeg') {
    for (const leg of g.legs) {
      const one = { ...s, statusOverride: undefined, grade: { type:'multiLeg', legs:[leg] } };
      let st; try { st = bets.gradeSpecial(one); } catch(e){ st='err:'+e.message.slice(0,40); }
      const k = leg.kind + (leg.negate?'-neg':'');
      kindStats[k] = kindStats[k]||{won:0,lost:0,pending:0,err:0};
      kindStats[k][st==='won'?'won':st==='lost'?'lost':String(st).startsWith('err')?'err':'pending']++;
      if (status==='lost' && st==='lost') {
        lostSlips.push({slip:s.slipNo, stake:s.stake, odds:s.odds, kind:k, leg: bets && leg.player? (leg.kind+':'+leg.player): leg.kind+':'+(leg.line??leg.outcome??leg.side??''), matchId:leg.matchId});
      }
    }
  } else {
    const k='(single) '+g.type;
    kindStats[k]=kindStats[k]||{won:0,lost:0,pending:0,err:0};
    kindStats[k][status==='won'?'won':status==='lost'?'lost':'pending']++;
  }
}
console.log('=== RJ SLIPS:', specials.length, 'won',wonN,'lost',lostN,'pending',pendN,'void',voidN);
console.log('=== MONEY: staked RM'+staked.toFixed(0), 'returned RM'+ret.toFixed(0), 'P/L RM'+(ret-staked).toFixed(0));
console.log('\n=== legs-per-slip: WON', JSON.stringify(legCount.won), ' LOST', JSON.stringify(legCount.lost));
console.log('\n=== per-leg-kind win rates (settled legs only) ===');
const rows=Object.entries(kindStats).map(([k,v])=>({kind:k,...v,settled:v.won+v.lost,rate:v.won+v.lost?Math.round(100*v.won/(v.won+v.lost)):null}));
rows.sort((a,b)=>(a.rate??101)-(b.rate??101));
for(const r of rows) console.log(String(r.rate??'--').padStart(3)+'%','won',String(r.won).padStart(3),'lost',String(r.lost).padStart(3),'pend',String(r.pending).padStart(3),' ',r.kind);
console.log('\n=== killer legs in lost slips (what actually died) ===');
const killers={};
for(const l of lostSlips){ killers[l.kind]=(killers[l.kind]||0)+1; }
console.log(Object.entries(killers).sort((a,b)=>b[1]-a[1]).map(([k,n])=>k+': '+n).join('\n'));
