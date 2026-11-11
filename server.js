const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const PORT = Number(process.env.PORT || 3000);
const rooms = new Map();
/** @type {Map<string, Map<string, {ws:import('ws').WebSocket, index:number, voice:boolean, name:string}>>} */
const voiceSockets = new Map(); // code -> token -> socket meta
const SUITS = ['H','D','C','S'];
const MAX_PLAYERS = 4;
const ROLES = ['warrior','ranger','mage','cleric'];
function normalizeRole(role){
  const r=String(role||'').toLowerCase().trim();
  return ROLES.includes(r)?r:'warrior';
}

/** Multi-pass Fisher–Yates using crypto entropy (fairer than single Math.random shuffle). */
function shuffle(a, passes = 3) {
  let out = [...a];
  const n = Math.max(1, passes | 0);
  for (let p = 0; p < n; p++) {
    for (let i = out.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
  }
  return out;
}
/** Random cut after shuffle — further mixes deal order. */
function shuffleCut(a) {
  const out = shuffle(a, 3);
  if (out.length < 2) return out;
  const cut = crypto.randomInt(out.length);
  return out.slice(cut).concat(out.slice(0, cut));
}
function weightedPick(items, weights) {
  let sum = 0;
  for (const w of weights) sum += Math.max(0, w);
  if (!items.length) return null;
  if (sum <= 0) return items[crypto.randomInt(items.length)];
  let r = crypto.randomInt(1000000) / 1000000 * sum;
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
/** 0 = empty hands, 1 = full — used to soften harsh Diamond immunities when low on cards. */
function handPressure(r) {
  const lim = maxHand(r);
  const total = r.players.reduce((n, p) => n + p.hand.length, 0);
  return total / Math.max(1, lim * Math.max(1, r.players.length));
}
/**
 * Build castle as J→Q→K tiers (keeps difficulty curve), each suit order heavily shuffled.
 */
function buildCastle() {
  return ['J', 'Q', 'K'].flatMap((rank) => shuffle(SUITS.map((s) => card(rank, s)), 4));
}
/**
 * Pick next royal randomly from the current rank tier (not fixed queue order).
 * Soft-avoids Diamonds (and somewhat Clubs) when the party is low on cards.
 */
function pickNextEnemy(r) {
  if (!r.castle.length) return null;
  const rank = r.castle[0].rank;
  const tier = r.castle.filter((c) => c.rank === rank);
  const rest = r.castle.filter((c) => c.rank !== rank);
  const pressure = handPressure(r);
  const weights = tier.map((c) => {
    // Base jitter so every pick feels RNG, not deterministic weights-only
    let w = 0.85 + crypto.randomInt(1000) / 1000; // ~0.85–1.85
    if (pressure < 0.5 && c.suit === 'D') w *= 0.22; // can't Diamond-draw while immune
    if (pressure < 0.4 && c.suit === 'C') w *= 0.55; // Clubs immune hurts damage output
    if (r.enemy && c.suit === r.enemy.suit) w *= 0.65; // prefer suit variety
    if (pressure > 0.75 && c.suit === 'D') w *= 1.15; // Diamonds fine when hands are full
    return Math.max(0.04, w);
  });
  const picked = weightedPick(tier, weights);
  const leftover = shuffle(
    tier.filter((c) => c !== picked),
    2
  );
  r.castle = leftover.concat(rest);
  return picked;
}
const val = c => c.rank==='Jest'?0:c.rank==='A'?1:c.rank==='J'?10:c.rank==='Q'?15:c.rank==='K'?20:Number(c.rank);
const card = (rank,suit) => ({id:`${rank}${suit}`,rank,suit});
const jester = n => ({id:`J${n}`,rank:'Jest',suit:null});

/** @returns {{diamondsEach:boolean, jestersHouse:boolean}} */
function normalizeSettings(raw){
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    // OFF by default = official rulebook
    diamondsEach: !!s.diamondsEach,
    jestersHouse: !!s.jestersHouse,
  };
}

const newRoom = (solo=false, settings={}) => ({
  players:[], solo,
  settings: normalizeSettings(settings),
  jesters: solo ? 2 : 0,
  phase:'lobby', castle:[], enemy:null, enemyHP:0, shield:0, immune:true,
  tavern:[], discard:[], played:[], turn:0, yieldStreak:0,
  history:[], winner:false, seq:0, events:[]
});

function note(r,s){r.history.unshift(s);r.history=r.history.slice(0,18)}
function emit(r,ev){r.seq++;r.events.push({seq:r.seq,...ev});r.events=r.events.slice(-8)}
const pub = c => ({id:c.id,rank:c.rank,suit:c.suit});
const nPlayers = r => r.players.length;

/** Official: solo 8 · 2p 7 · 3p 6 · 4p 5 */
function maxHand(r){
  if(r.solo) return 8;
  const n = nPlayers(r);
  if(n <= 2) return 7;
  if(n === 3) return 6;
  return 5;
}

/** Official Jesters in Tavern: 2→0, 3→1, 4→2. House: 2→2, 3→1, 4→2 */
function jesterCountFor(r){
  if(r.solo) return 0;
  const n = nPlayers(r);
  if(r.settings.jestersHouse){
    if(n <= 2) return 2;
    if(n === 3) return 1;
    return 2;
  }
  if(n <= 2) return 0;
  if(n === 3) return 1;
  return 2;
}

const medalOf = r => !r.solo||r.phase!=='won'?null:(r.jesters===2?'gold':r.jesters===1?'silver':'bronze');

const partyHasSuit = (r,suit) => r.players.some(p=>p.hand.some(c=>c.suit===suit));

/** Pull a suited card from the Tavern into a hand by swapping out fodder (keeps hand size). */
function swapSuitIntoHand(r, player, suit){
  if(!player||player.hand.some(c=>c.suit===suit)) return false;
  const ti=r.tavern.findIndex(c=>c.suit===suit);
  if(ti<0) return false;
  const take=r.tavern.splice(ti,1)[0];
  // Prefer swapping Clubs/Spades/number fodder — keep other support cards when possible
  let hi=player.hand.findIndex(c=>c.suit&&c.suit!=='D'&&c.suit!=='H'&&c.rank!=='Jest');
  if(hi<0) hi=player.hand.findIndex(c=>c.suit!==suit);
  if(hi<0){ r.tavern.push(take); return false; }
  r.tavern.push(player.hand[hi]);
  player.hand[hi]=take;
  return true;
}

/** When the Tavern runs dry, reshuffle discard so Diamonds/draws can still work. */
function ensureTavernStock(r){
  if(r.tavern.length||!r.discard.length) return false;
  r.tavern=shuffleCut(r.discard);
  r.discard=[];
  note(r,'Tavern empty — discard reshuffled into the Tavern (anti-deadlock).');
  return true;
}

/**
 * Opening deal safety: every knight gets a ♦, party gets at least one ♥,
 * and the first royal is not Diamonds so opening draws actually work.
 */
function ensureOpeningSupport(r){
  for(const p of r.players){
    if(!p.hand.some(c=>c.suit==='D')) swapSuitIntoHand(r,p,'D');
  }
  // Solo / larger hands: try for a second ♦ on the starting player
  const starter=r.players[r.turn]||r.players[0];
  if(starter&&starter.hand.filter(c=>c.suit==='D').length<2)
    swapSuitIntoHand(r,starter,'D');
  if(!partyHasSuit(r,'H')&&starter) swapSuitIntoHand(r,starter,'H');

  if(r.enemy&&r.enemy.suit==='D'){
    const i=r.castle.findIndex(c=>c.rank===r.enemy.rank&&c.suit!=='D');
    if(i>=0){
      const swap=r.castle.splice(i,1)[0];
      r.castle.push(r.enemy);
      r.enemy=swap;
      r.enemyHP=stats(r.enemy).hp;
    }
  }
  const dCount=r.players.reduce((n,p)=>n+p.hand.filter(c=>c.suit==='D').length,0);
  const hCount=r.players.reduce((n,p)=>n+p.hand.filter(c=>c.suit==='H').length,0);
  note(r,`Opening support: ${dCount}♦ · ${hCount}♥ seeded (anti-deadlock).`);
}

/**
 * Mid-run safety: if nobody holds ♦ or ♥, seed a ♦ (then ♥) so the table can refill.
 * Call when hands are thin — avoids soft-locks with empty tavern/no support suits.
 */
function preventSupportDrought(r){
  ensureTavernStock(r);
  if(partyHasSuit(r,'D')||partyHasSuit(r,'H')) return false;
  const target=r.players.slice().sort((a,b)=>a.hand.length-b.hand.length)[0];
  if(!target) return false;
  if(swapSuitIntoHand(r,target,'D')){
    note(r,`Support seed: ${target.name} receives a ♦ to avoid a dead hand.`);
    return true;
  }
  if(swapSuitIntoHand(r,target,'H')){
    note(r,`Support seed: ${target.name} receives a ♥ to avoid a dead hand.`);
    return true;
  }
  return false;
}

/** Keep the same room + players; clear the board so everyone can Start again. */
function returnToLobby(r){
  for(const p of r.players) p.hand=[];
  r.phase='lobby';
  r.castle=[];r.enemy=null;r.enemyHP=0;r.shield=0;r.immune=true;
  r.tavern=[];r.discard=[];r.played=[];
  r.turn=0;r.yieldStreak=0;r.winner=false;
  if(!r.solo) r.jesters=0;
  r.history=[];
  note(r,'Back in the hall — same room. Start when ready.');
  emit(r,{type:'lobby'});
}

function init(r){
  const all = SUITS.flatMap(s=>['A','2','3','4','5','6','7','8','9','10'].map(k=>card(k,s)));
  const jc = jesterCountFor(r);
  for(let i=1;i<=jc;i++) all.push(jester(i));
  r.tavern=shuffleCut(all);r.discard=[];r.played=[];
  r.castle=buildCastle();
  r.enemy=pickNextEnemy(r);r.enemyHP=stats(r.enemy).hp;r.shield=0;r.immune=true;
  r.turn=r.players.length?crypto.randomInt(r.players.length):0;
  r.yieldStreak=0;r.phase='attack';r.winner=false;r.history=[];r.events=[];
  if(r.solo) r.jesters=2; else r.jesters=0;
  const deal=maxHand(r);
  // Deal one card at a time around the table for a fairer random deal
  for(const p of r.players) p.hand=[];
  for(let d=0;d<deal;d++){
    for(let step=0;step<r.players.length;step++){
      const pi=(r.turn+step)%r.players.length;
      if(r.tavern.length) r.players[pi].hand.push(r.tavern.shift());
    }
  }
  ensureOpeningSupport(r);
  for(const p of r.players) p.hand=shuffle(p.hand,2);
  const diamondNote = r.settings.diamondsEach ? 'Diamonds: each player draws up to value' : 'Diamonds: shared clockwise draw';
  const jesterNote = r.solo
    ? '2 set-aside Jesters'
    : (jc ? `${jc} Jester(s) in Tavern` : 'no Jesters (official 2p)');
  const starter=r.players[r.turn]?.name||'Player';
  note(r, r.solo
    ? `Solo assault begins. The ${r.enemy.id} appears! Hand 8 · ${jesterNote}. ${diamondNote}.`
    : `The ${r.enemy.id} appears! ${starter} first · hand ${deal} · ${jesterNote}. ${diamondNote}.`);
}

function stats(enemy){return enemy.rank==='J'?{hp:20,atk:10}:enemy.rank==='Q'?{hp:30,atk:15}:{hp:40,atk:20}}

function next(r,forcedTurn){
  if(typeof forcedTurn==='number')r.turn=((forcedTurn%nPlayers(r))+nPlayers(r))%nPlayers(r);
  else r.turn=(r.turn+1)%nPlayers(r);
  r.phase='attack';
  ensureTavernStock(r);
  if(handPressure(r)<0.45) preventSupportDrought(r);
  // Cannot continue if active player has no cards and everyone else already yielded (no yield left).
  if(r.players[r.turn].hand.length===0 && r.yieldStreak>=Math.max(1,nPlayers(r)-1)){
    // Last chance: pull any tavern card into the empty hand before declaring loss
    ensureTavernStock(r);
    const p=r.players[r.turn],lim=maxHand(r);
    while(p.hand.length===0&&r.tavern.length&&p.hand.length<lim){
      const di=r.tavern.findIndex(c=>c.suit==='D');
      const hi=r.tavern.findIndex(c=>c.suit==='H');
      const pick=di>=0?di:hi>=0?hi:0;
      p.hand.push(r.tavern.splice(pick,1)[0]);
    }
    if(p.hand.length) note(r,`${p.name} draws emergency stock from the Tavern.`);
    else{ r.phase='lost';note(r,'No cards to play and cannot yield. Game over.'); }
  }
}

function drawDiamonds(r, idx, power){
  ensureTavernStock(r);
  const lim = maxHand(r);
  let drawn = 0;
  const per = r.players.map(()=>0);
  if(r.settings.diamondsEach){
    // House: each player draws up to `power` (hand max / tavern permitting), clockwise from active.
    for(let step=0; step<nPlayers(r); step++){
      const pi=(idx+step)%nPlayers(r); let got=0;
      while(got<power && r.players[pi].hand.length<lim && r.tavern.length){
        r.players[pi].hand.push(r.tavern.shift()); got++; drawn++;
      }
      per[pi]=got;
    }
    note(r,`Diamonds (house): each draws up to ${power} (${r.players.map((p,i)=>`${p.name}+${per[i]}`).join(', ')}; ${drawn} total).`);
  } else {
    // Official: one card at a time clockwise until `power` cards drawn (skip full hands).
    let left = power, guard = 0;
    while(left>0 && r.tavern.length && guard < nPlayers(r)*power + nPlayers(r)*2){
      const pi = (idx + guard) % nPlayers(r);
      if(r.players[pi].hand.length < lim){
        r.players[pi].hand.push(r.tavern.shift());
        per[pi]++; drawn++; left--;
      }
      guard++;
      // If every hand is full, stop early
      if(r.players.every(p=>p.hand.length>=lim)) break;
    }
    note(r,`Diamonds: draw ${drawn}/${power} clockwise (${r.players.map((p,i)=>`${p.name}+${per[i]}`).join(', ')}).`);
  }
  return drawn;
}

function attack(r,idx,ids,nextPlayer){
 const p=r.players[idx],handBefore=[...p.hand],enemyBefore=r.enemy,hpBefore=r.enemyHP,shieldBefore=r.shield,
  discardBefore=r.discard.length,handsBefore=r.players.reduce((n,x)=>n+x.hand.length,0),immune=r.immune;
 attackCore(r,idx,ids,nextPlayer);
 const cards=handBefore.filter(c=>ids.includes(c.id));
 if(cards.length===1&&cards[0].rank==='Jest'){
  emit(r,{type:'jesterPlay',by:idx,name:p.name,cards:cards.map(pub),enemy:pub(enemyBefore),
   enemyMax:stats(enemyBefore).hp,enemyAtk:stats(enemyBefore).atk,hpBefore,shieldBefore,
   nextTurn:r.turn,nextName:r.players[r.turn].name});
  return;
 }
 const power=cards.reduce((n,c)=>n+val(c),0),
  allSuits=[...new Set(cards.map(c=>c.suit).filter(Boolean))],suits=allSuits.filter(s=>!immune||s!==enemyBefore.suit),
  defeated=r.enemy!==enemyBefore||r.phase==='won',damage=power*(suits.includes('C')?2:1);
 emit(r,{type:'attack',by:idx,name:p.name,cards:cards.map(pub),power,damage,suits,blocked:allSuits.filter(s=>!suits.includes(s)),
  enemy:pub(enemyBefore),enemyMax:stats(enemyBefore).hp,enemyAtk:stats(enemyBefore).atk,hpBefore,hpAfter:Math.max(0,hpBefore-damage),
  shieldBefore,shieldAdded:suits.includes('S')?power:0,
  healed:suits.includes('H')?Math.min(power,discardBefore):0,
  drawn:suits.includes('D')?r.players.reduce((n,x)=>n+x.hand.length,0)-handsBefore+cards.length:0,
  defeated,exact:defeated&&hpBefore-damage===0,victory:r.phase==='won',lost:r.phase==='lost',
  next:defeated&&r.phase!=='won'?pub(r.enemy):null,shielded:!defeated&&r.phase==='attack'});
}

function attackCore(r,idx,ids,nextPlayer){
 if(r.phase!=='attack'||r.turn!==idx)throw Error('Not your turn to attack');
 if(!Array.isArray(ids)||!ids.length||ids.length>4||new Set(ids).size!==ids.length)throw Error('Select valid cards');
 const p=r.players[idx], selected=ids.map(id=>p.hand.find(c=>c.id===id));
 if(selected.some(c=>!c))throw Error('You do not have those cards');
 if(selected.some(c=>c.rank==='Jest')){
  if(selected.length!==1)throw Error('Jester must be played alone');
  if(r.solo)throw Error('In solo, flip the set-aside Jesters instead of playing them from hand');
  const who=Number.isInteger(nextPlayer)?nextPlayer:(idx+1)%nPlayers(r);
  if(who<0||who>=nPlayers(r))throw Error('Pick who goes next');
  p.hand=p.hand.filter(c=>!ids.includes(c.id));r.played.push(...selected);
  r.immune=false;r.yieldStreak=0;
  note(r,`${p.name} plays a Jester — immunity broken. ${r.players[who].name} goes next.`);
  next(r,who);
  return;
 }
 const aces=selected.filter(c=>c.rank==='A');
 if(aces.length){if(selected.length!==1&&selected.length!==2)throw Error('Ace can be played alone or with one other card')}
 else if(selected.length>1){if(!selected.every(c=>c.rank===selected[0].rank)||selected.reduce((n,c)=>n+val(c),0)>10)throw Error('Combos require matching numbers and total value at most 10')}
 const power=selected.reduce((n,c)=>n+val(c),0);
 const suits=[...new Set(selected.map(c=>c.suit).filter(Boolean))].filter(s=>!r.immune||s!==r.enemy.suit);
 p.hand=p.hand.filter(c=>!ids.includes(c.id));r.played.push(...selected);
 if(suits.includes('H')){
  r.discard=shuffleCut(r.discard);
  const n=Math.min(power,r.discard.length); const healed=shuffle(r.discard.splice(0,n),2);
  r.tavern.push(...healed);
  note(r,`Hearts recover ${n} cards to the bottom of the Tavern.`);
 }
 if(suits.includes('D')) drawDiamonds(r, idx, power);
 // After spending support cards, keep the table from soft-locking
 if(handPressure(r)<0.4) preventSupportDrought(r);
 if(suits.includes('S'))r.shield+=power;
 const damage=power*(suits.includes('C')?2:1);r.enemyHP-=damage;
 note(r,`${p.name} plays ${selected.map(c=>c.id).join('+')} for ${damage} damage.`);
 r.yieldStreak=0;
 if(r.enemyHP<=0){
   const former=r.enemy, exact=r.enemyHP===0;
   r.discard.push(...r.played);r.played=[];
   if(exact){r.tavern.unshift(former);note(r,`Exact defeat! ${former.id} goes on top of Tavern.`)}
   else r.discard.push(former);
   if(!r.castle.length){r.phase='won';r.winner=true;note(r,'All 12 royals defeated. Victory!');return}
   r.enemy=pickNextEnemy(r);r.enemyHP=stats(r.enemy).hp;r.shield=0;r.immune=true;
   note(r,`${former.id} defeated! Next enemy (drawn): ${r.enemy.id}. ${p.name} attacks again.`);
 } else {
   r.phase='defend';
   const incoming=Math.max(0,stats(r.enemy).atk-r.shield);
   if(!incoming){note(r,'Enemy attack is fully shielded.');next(r)}
   else if(p.hand.reduce((n,c)=>n+val(c),0)<incoming){r.phase='lost';note(r,`${p.name} cannot withstand ${incoming} damage. Game over.`)}
 }
}

function yieldTurn(r,idx){
 if(r.phase!=='attack'||r.turn!==idx)throw Error('Not your turn');
 // Official: cannot yield if all other players yielded on their preceding turns.
 const maxYield = Math.max(1, nPlayers(r)-1);
 if(r.yieldStreak>=maxYield)throw Error(r.solo?'Cannot yield twice in a row':'Cannot yield — all other players already yielded');
 r.yieldStreak++;
 note(r,`${r.players[idx].name} yields.`);
 r.phase='defend';
 const incoming=Math.max(0,stats(r.enemy).atk-r.shield);
 if(!incoming){next(r)}
 else if(r.players[idx].hand.reduce((n,c)=>n+val(c),0)<incoming){r.phase='lost';note(r,'Unable to survive enemy attack. Game over.')}
 emit(r,{type:'yield',by:idx,name:r.players[idx].name,incoming,lost:r.phase==='lost'});
}

function useJester(r,idx){
 if(!r.solo)throw Error('In co-op, play Jester cards from your hand');
 if(r.phase!=='attack'&&r.phase!=='defend')throw Error('Cannot use a Jester now');
 if(r.turn!==idx)throw Error('Not your turn');
 if(r.jesters<=0)throw Error('No Jesters left');
 const p=r.players[idx],before=p.hand.length;
 r.discard.push(...p.hand);p.hand=[];
 const lim=maxHand(r);let drawn=0;
 while(p.hand.length<lim&&r.tavern.length){p.hand.push(r.tavern.shift());drawn++}
 r.jesters--;
 note(r,`${p.name} flips a Jester — discards ${before} and draws ${drawn}. (${2-r.jesters}/2 used)`);
 emit(r,{type:'jester',by:idx,name:p.name,discarded:before,drawn,jestersLeft:r.jesters,phase:r.phase});
}

function defend(r,idx,ids){
 if(r.phase!=='defend'||r.turn!==idx)throw Error('Not your turn to defend');
 if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)throw Error('Invalid cards');
 const p=r.players[idx],cards=ids.map(id=>p.hand.find(c=>c.id===id));
 if(cards.some(c=>!c))throw Error('Invalid defense cards');
 const incoming=Math.max(0,stats(r.enemy).atk-r.shield);
 const covered=cards.reduce((n,c)=>n+val(c),0);
 const survived=covered>=incoming;
 p.hand=p.hand.filter(c=>!ids.includes(c.id));r.discard.push(...cards);
 if(survived){
  note(r,`${p.name} discards ${cards.map(c=>c.id).join(', ')} (${covered}) to block ${incoming}.`);
  next(r);
 }else{
  r.phase='lost';
  note(r,`${p.name} discards ${covered} but needed ${incoming}. Struck down.`);
 }
 emit(r,{type:'defend',by:idx,name:p.name,cards:cards.map(pub),incoming,covered,survived,enemy:pub(r.enemy),lost:!survived});
}

function view(r,idx,code){
 const p=r.players[idx];
 return {
  code, solo:!!r.solo, jesters:r.jesters, handMax:maxHand(r), medal:medalOf(r),
  settings: {...r.settings},
  phase:r.phase, turn:r.turn, me:idx,
  players:r.players.map((pl,i)=>({name:pl.name,count:pl.hand.length,index:i,role:pl.role||ROLES[i]||ROLES[0]})),
  takenRoles:r.players.map(pl=>pl.role).filter(Boolean),
  hand:p.hand, enemy:r.enemy, enemyHP:r.enemyHP,
  enemyMax:r.enemy?stats(r.enemy).hp:0, enemyAttack:r.enemy?stats(r.enemy).atk:0,
  shield:r.shield, immune:r.immune, remaining:r.castle.length,
  tavern:r.tavern.length, discard:r.discard.length, played:r.played,
  history:r.history, seq:r.seq, events:r.events,
  yieldAllowed:r.yieldStreak < Math.max(1, nPlayers(r)-1),
  canStart:!r.solo && r.phase==='lobby' && r.players.length>=2 && r.players.length<=MAX_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  host: idx===0,
 };
}

function respond(res,status,obj){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(obj))}
function readJSON(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>{raw+=c;if(raw.length>10000){reject(Error('Request too large'));req.destroy()}});req.on('end',()=>{try{resolve(JSON.parse(raw||'{}'))}catch{reject(Error('Invalid JSON'))}})})}

const publicDir=path.join(__dirname,'public');
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.json':'application/json','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav'};

function serveFile(root, rel, res){
  const loc=path.resolve(root, rel);
  if(!loc.startsWith(root+path.sep) && loc!==root){res.writeHead(403);return res.end('Forbidden')}
  fs.readFile(loc,(err,data)=>{
    if(err){res.writeHead(404);return res.end('Not found')}
    res.writeHead(200,{'Content-Type':MIME[path.extname(loc).toLowerCase()]||'application/octet-stream','Cache-Control':'no-cache'});
    res.end(data);
  });
}

function iceConfig(){
  const iceServers=[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}];
  const turn=process.env.TURN_URL;
  if(turn){
    iceServers.push({
      urls:turn.split(',').map(s=>s.trim()).filter(Boolean),
      username:process.env.TURN_USER||undefined,
      credential:process.env.TURN_PASS||undefined,
    });
  }
  return {iceServers};
}

function voiceRoom(code){
  if(!voiceSockets.has(code))voiceSockets.set(code,new Map());
  return voiceSockets.get(code);
}
function voiceRoster(code){
  const m=voiceSockets.get(code);if(!m)return [];
  return [...m.values()].filter(c=>c.voice).map(c=>({index:c.index,name:c.name}));
}
function sendJson(ws,obj){if(ws.readyState===1)ws.send(JSON.stringify(obj))}
function broadcastVoice(code,obj,exceptToken=null){
  const m=voiceSockets.get(code);if(!m)return;
  for(const [tok,c] of m){
    if(!c.voice||tok===exceptToken)continue;
    sendJson(c.ws,obj);
  }
}

const server=http.createServer(async (req,res)=>{
 try{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname==='/ice-config'&&req.method==='GET'){
    return respond(res,200,iceConfig());
  }
  if(u.pathname==='/api'&&req.method==='POST'){
   const b=await readJSON(req),name=String(b.name||'Player').trim().slice(0,22)||'Player';
   if(b.action==='create'||b.action==='solo'){
    const solo=b.action==='solo';
    const role=normalizeRole(b.role);
    let code;do{code=crypto.randomBytes(3).toString('hex').toUpperCase()}while(rooms.has(code));
    const r=newRoom(solo, b.settings),token=crypto.randomBytes(20).toString('hex');
    r.players.push({name,token,hand:[],role});rooms.set(code,r);
    if(solo)init(r);
    return respond(res,200,{code,token,state:view(r,0,code)});
   }
   const code=String(b.code||'').toUpperCase(),r=rooms.get(code);
   if(!r)throw Error('Room not found');
   if(b.action==='join'){
    if(r.solo)throw Error('This is a solo game');
    if(r.phase!=='lobby')throw Error('Game already started');
    if(r.players.length>=MAX_PLAYERS)throw Error('Room is full (max 4)');
    const role=normalizeRole(b.role);
    if(r.players.some(p=>p.role===role))throw Error(`${role[0].toUpperCase()+role.slice(1)} is already taken — pick another character`);
    const token=crypto.randomBytes(20).toString('hex');r.players.push({name,token,hand:[],role});note(r,`${name} (${role}) joined (${r.players.length}/${MAX_PLAYERS}).`);
    return respond(res,200,{code,token,state:view(r,r.players.length-1,code)});
   }
   const idx=r.players.findIndex(p=>p.token===b.token);if(idx<0)throw Error('Invalid player session');
   if(b.action==='start'){
     if(r.solo||r.phase!=='lobby')throw Error('Cannot start');
     if(r.players.length<2||r.players.length>MAX_PLAYERS)throw Error('Need 2–4 players');
     init(r);
   }
   else if(b.action==='play')attack(r,idx,b.ids,b.next);
   else if(b.action==='yield')yieldTurn(r,idx);
   else if(b.action==='defend')defend(r,idx,b.ids);
   else if(b.action==='jester')useJester(r,idx);
   else if(b.action==='restart'){
     if(!['won','lost'].includes(r.phase))throw Error('Game not finished');
     // Solo rematches immediately; co-op returns to the same room lobby so Start can be used again.
     if(r.solo) init(r);
     else returnToLobby(r);
   }
   else if(b.action!=='state')throw Error('Unknown action');
   return respond(res,200,{state:view(r,idx,code)});
  }
  if(req.method!=='GET')return respond(res,405,{error:'Method not allowed'});
  if(u.pathname==='/art-list'){
   return fs.readdir(path.join(publicDir,'asset','art'),(err,files)=>respond(res,200,err?{}:Object.fromEntries(files.filter(f=>/^((?:10|[2-9AJQK])[HDCS]|J[12])\.(png|jpe?g|webp|svg)$/i.test(f)).map(f=>{
     const id=f.replace(/\.(png|jpe?g|webp|svg)$/i,'').toUpperCase();
     return [id,'/asset/art/'+f];
   }))));
  }
  const asset=u.pathname==='/'?'index.html':u.pathname.slice(1);
  return serveFile(publicDir, asset, res);
 }catch(e){respond(res,400,{error:e.message||'Unknown error'})}
});

const wss=new WebSocketServer({server,path:'/ws'});
wss.on('connection',(ws,req)=>{
  let meta=null;
  try{
    const u=new URL(req.url,'http://localhost');
    const code=String(u.searchParams.get('code')||'').toUpperCase();
    const token=String(u.searchParams.get('token')||'');
    const r=rooms.get(code);
    if(!r||r.solo){ws.close(4001,'Invalid room');return}
    const index=r.players.findIndex(p=>p.token===token);
    if(index<0){ws.close(4003,'Unauthorized');return}
    const player=r.players[index];
    const roomMap=voiceRoom(code);
    // Replace stale socket for same token (refresh)
    const prev=roomMap.get(token);
    if(prev?.ws&&prev.ws!==ws)try{prev.ws.close(4000,'Replaced')}catch{}
    meta={ws,code,token,index,name:player.name,voice:false};
    roomMap.set(token,meta);
    sendJson(ws,{type:'hello',index,name:player.name,ice:iceConfig()});
  }catch{
    ws.close(4002,'Bad request');return;
  }

  ws.on('message',raw=>{
    if(!meta)return;
    let msg;try{msg=JSON.parse(String(raw))}catch{return}
    const r=rooms.get(meta.code);
    if(!r){ws.close(4001,'Room gone');return}
    // Re-auth index in case seats shifted (shouldn't for this game)
    const idx=r.players.findIndex(p=>p.token===meta.token);
    if(idx<0){ws.close(4003,'Unauthorized');return}
    meta.index=idx;meta.name=r.players[idx].name;

    if(msg.type==='voice-join'){
      meta.voice=true;
      const roster=voiceRoster(meta.code);
      sendJson(ws,{type:'voice-roster',self:meta.index,peers:roster.filter(p=>p.index!==meta.index)});
      broadcastVoice(meta.code,{type:'voice-peer-joined',peer:{index:meta.index,name:meta.name}},meta.token);
      return;
    }
    if(msg.type==='voice-leave'){
      if(meta.voice){
        meta.voice=false;
        broadcastVoice(meta.code,{type:'voice-peer-left',index:meta.index},meta.token);
      }
      return;
    }
    if(msg.type==='voice-speaking'){
      if(!meta.voice)return;
      broadcastVoice(meta.code,{type:'voice-speaking',from:meta.index,speaking:!!msg.speaking},meta.token);
      return;
    }
    if(msg.type==='signal'){
      if(!meta.voice)return;
      const to=Number(msg.to);
      if(!Number.isInteger(to)||to===meta.index)return;
      const roomMap=voiceSockets.get(meta.code);if(!roomMap)return;
      for(const [tok,c] of roomMap){
        if(c.voice&&c.index===to){
          sendJson(c.ws,{type:'signal',from:meta.index,data:msg.data});
          return;
        }
      }
    }
  });

  ws.on('close',()=>{
    if(!meta)return;
    const roomMap=voiceSockets.get(meta.code);
    if(!roomMap)return;
    const cur=roomMap.get(meta.token);
    if(cur?.ws!==ws)return; // replaced
    if(cur.voice)broadcastVoice(meta.code,{type:'voice-peer-left',index:cur.index},meta.token);
    roomMap.delete(meta.token);
    if(!roomMap.size)voiceSockets.delete(meta.code);
  });
});

server.listen(PORT,'0.0.0.0',()=>console.log(`Regicide running at http://localhost:${PORT}`));
