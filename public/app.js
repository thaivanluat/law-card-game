import { CombatOrchestrator } from './js/game/animations/CombatOrchestrator.js';
import { VoiceChat } from './js/voice/VoiceChat.js';
import { registry as assetRegistry } from './js/game/assets/AssetRegistry.js';

/* ---------- state & helpers ---------- */
const $=id=>document.getElementById(id);
let session=JSON.parse(localStorage.getItem('regicideSession')||'null'),state=null,selected=new Set(),busy=false;
let lastSeq=null,queue=[],animating=false,pendingFrom={},shownEnemyId=null,prevHandIds=null,customArt={},endPending=null;
let lastTurnKey=null,pickJesterNext=false;
const suit=SUITCH,isRed=s=>s==='H'||s==='D';
const v=c=>c.rank==='Jest'?0:c.rank==='A'?1:c.rank==='J'?10:c.rank==='Q'?15:c.rank==='K'?20:Number(c.rank);
const statsOf=r=>r==='J'?{hp:20,atk:10}:r==='Q'?{hp:30,atk:15}:{hp:40,atk:20};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rnd=(a,b)=>a+Math.random()*(b-a);
const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sortHand=h=>[...h].sort((a,b)=>{
  const ja=a.rank==='Jest'?1:0,jb=b.rank==='Jest'?1:0;if(ja!==jb)return ja-jb;
  return v(a)-v(b)||'HDCS'.indexOf(a.suit||'')-'HDCS'.indexOf(b.suit||'');
});
const isJest=c=>c.rank==='Jest';
const isTouchUi=()=>!!window.matchMedia?.('(pointer: coarse)')?.matches;

/* ---------- card rendering ---------- */
const P6=[[0,0],[2,0],[0,.5],[2,.5],[0,1],[2,1]],P9=[[0,0],[2,0],[0,1/3],[2,1/3],[0,2/3],[2,2/3],[0,1],[2,1]];
const PIPS={A:[[1,.5]],2:[[1,0],[1,1]],3:[[1,0],[1,.5],[1,1]],4:[[0,0],[2,0],[0,1],[2,1]],5:[[0,0],[2,0],[1,.5],[0,1],[2,1]],6:P6,
  7:[...P6,[1,.25]],8:[...P6,[1,.25],[1,.75]],9:[...P9,[1,.5]],10:[...P9,[1,1/6],[1,5/6]]};
function cardInner(c){
  if(isJest(c))return `<div class="idx tl"><b>🃏</b></div><div class="idx br"><b>🃏</b></div>`;
  const s=suit[c.suit];
  const pips=(PIPS[c.rank]||[]).map(([x,y])=>`<span class="pip ${y>.5?'flip':''} ${c.rank==='A'?'big':''}" style="left:${32+x*18}%;top:${17+y*66}%">${s}</span>`).join('');
  return `<div class="idx tl"><b>${c.rank}</b><i>${s}</i></div>${pips}<div class="idx br"><b>${c.rank}</b><i>${s}</i></div>`;
}
const cardArtSrc=c=>customArt[c.id]||`/asset/art/${c.id}.png`;
function makeCard(c,{tag='div',cls=''}={}){
  const el=document.createElement(tag);
  el.className=`card illustrated ${c.suit&&isRed(c.suit)?'red':''} ${cls}`.trim();
  el.dataset.id=c.id;
  const img=document.createElement('img');
  img.alt=c.id;img.draggable=false;img.src=cardArtSrc(c);
  img.onerror=()=>{el.classList.remove('illustrated');el.innerHTML=cardInner(c)};
  el.appendChild(img);
  return el;
}
const backCard=()=>{const d=document.createElement('div');d.className='card mini back';return d};

/* ---------- sound ---------- */
const sfx=(()=>{
  let ac;
  const sfxOn=()=>localStorage.getItem('regicideMute')!=='1';
  const bgmAllowed=()=>localStorage.getItem('regicideBgmMute')!=='1'&&sfxOn();
  const ctx=()=>{if(!ac){try{ac=new(window.AudioContext||window.webkitAudioContext)()}catch{}}if(ac&&ac.state==='suspended')ac.resume().catch(()=>{});return ac};
  let bgm=null,bgmWant=false;
  function ensureBgm(){
    if(bgm)return bgm;
    bgm=new Audio('/asset/audio/battle-trance.mp3');
    bgm.loop=true;bgm.preload='auto';bgm.volume=0.42;
    bgm.addEventListener('error',()=>console.warn('BGM failed to load',bgm.error));
    return bgm;
  }
  function syncBgm(){
    const a=ensureBgm();
    if(!bgmWant||!bgmAllowed()){a.pause();return}
    const p=a.play();
    if(p&&p.catch)p.catch(()=>{/* autoplay blocked until unlock */});
  }
  function tone(f,d,type='sine',vol=.18,slide=0,delay=0){if(!sfxOn())return;const a=ctx();if(!a)return;const t=a.currentTime+delay,o=a.createOscillator(),g=a.createGain();
    o.type=type;o.frequency.setValueAtTime(f,t);if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(30,f+slide),t+d);
    g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.0001,t+d);o.connect(g).connect(a.destination);o.start(t);o.stop(t+d+.02)}
  function noise(d,vol=.25,freq=1500,delay=0,q=.7){if(!sfxOn())return;const a=ctx();if(!a)return;const t=a.currentTime+delay,n=Math.floor(a.sampleRate*d),buf=a.createBuffer(1,n,a.sampleRate),ch=buf.getChannelData(0);
    for(let i=0;i<n;i++)ch[i]=(Math.random()*2-1)*(1-i/n);const s=a.createBufferSource(),f=a.createBiquadFilter(),g=a.createGain();
    s.buffer=buf;f.type='bandpass';f.frequency.value=freq;f.Q.value=q;g.gain.value=vol;s.connect(f).connect(g).connect(a.destination);s.start(t)}
  return{
    unlock(){ctx();syncBgm()},
    setMute(m){localStorage.setItem('regicideMute',m?'1':'0');syncBgm()},
    setBgmMute(m){localStorage.setItem('regicideBgmMute',m?'1':'0');syncBgm()},
    isMuted(){return !sfxOn()},
    isBgmMuted(){return localStorage.getItem('regicideBgmMute')==='1'},
    /** Loop Battle Trance during combat; call startBgm(false) in lobby/setup. */
    startBgm(onBattle=true){bgmWant=!!onBattle;syncBgm()},
    tick(){tone(900,.05,'square',.05)},
    whoosh(){noise(.28,.18,2200,0,.45)},
    /** Player swing into the royal */
    attack(){
      noise(.26,.32,2600,0,.55);
      tone(480,.14,'sawtooth',.16,-320);
      tone(210,.2,'triangle',.12,-90,.04);
      noise(.12,.2,4800,.06,1.1);
    },
    hit(big){noise(.22,big?.55:.38,big?420:900);tone(big?85:125,.28,'sine',big?.55:.38,-70)},
    slash(){noise(.2,.3,4500,0,.95);tone(620,.08,'sawtooth',.1,-400)},
    shield(){tone(660,.35,'triangle',.18);tone(990,.45,'triangle',.12,0,.05);noise(.15,.1,6000)},
    /** Raise block / discard to cover */
    block(){
      tone(500,.1,'triangle',.22);
      tone(760,.2,'triangle',.18,0,.03);
      tone(1100,.18,'sine',.1,0,.07);
      noise(.14,.22,5200,0,1.3);
    },
    heal(){[523,659,784,1046].forEach((f,i)=>tone(f,.28,'sine',.13,0,i*.08))},
    draw(){[0,.07,.14].forEach(d=>noise(.07,.18,3000,d))},
    /** Clubs double-damage smash — heavy layered boom */
    club(){
      noise(.6,.62,160,0,.25);
      noise(.45,.48,80,.04,.2);
      noise(.25,.3,900,.08,.5);
      tone(42,.85,'sawtooth',.5,-12);
      tone(62,.65,'square',.28,-28,.03);
      tone(95,.35,'sawtooth',.2,-40,.1);
      tone(28,1,'sine',.32,0,.02);
    },
    growl(){tone(110,.6,'sawtooth',.22,-60);tone(80,.6,'square',.12,-40,.05);noise(.4,.15,400)},
    /** Royal winds up and strikes */
    bossStrike(){
      noise(.4,.42,380,0,.35);
      tone(95,.5,'sawtooth',.32,-55);
      tone(58,.6,'square',.2,-25,.05);
      tone(140,.18,'sawtooth',.14,0,.12);
    },
    /** Strike lands on the player's shield */
    bossBlock(){
      noise(.28,.4,1100,0,.75);
      tone(200,.22,'triangle',.26);
      tone(150,.4,'sawtooth',.22,-45);
      tone(920,.16,'sine',.14,0,.06);
      noise(.16,.24,3800,.05,1.1);
    },
    jester(){tone(220,.15,'square',.12);tone(330,.2,'triangle',.14,0,.08);tone(440,.35,'sine',.16,0,.16);noise(.2,.12,1800)},
    turn(){tone(523,.18,'triangle',.14);tone(784,.28,'triangle',.12,0,.1)},
    defeat(){tone(330,.7,'sawtooth',.2,-260);noise(.6,.3,700);[523,659,784].forEach((f,i)=>tone(f,.35,'triangle',.12,0,.5+i*.1))},
    win(){[523,659,784,1046,1318].forEach((f,i)=>tone(f,.5,'triangle',.16,0,i*.14))},
    lose(){[392,349,330,262].forEach((f,i)=>tone(f,.6,'sawtooth',.12,0,i*.28))}
  };
})();
document.addEventListener('pointerdown',()=>sfx.unlock(),{once:true});
function renderSoundBtn(){
  const muted=sfx.isMuted();
  const sound=$('sound');
  if(sound){sound.textContent=muted?'🔇':'🔊';sound.title=muted?'Unmute sound':'Mute sound';sound.setAttribute('aria-pressed',muted?'true':'false')}
  renderBgmBtn();
}
function renderBgmBtn(){
  const off=sfx.isBgmMuted()||sfx.isMuted();
  const btn=$('bgmBtn');
  if(!btn)return;
  btn.textContent=off?'🔇':'🎵';
  btn.title=off?'Turn music on':'Turn music off';
  btn.setAttribute('aria-pressed',off?'true':'false');
  btn.classList.toggle('isOff',off);
}
$('sound').onclick=()=>{
  const muted=sfx.isMuted();
  sfx.setMute(!muted);renderSoundBtn();
  if(muted)sfx.tick();
};
$('bgmBtn')?.addEventListener('click',()=>{
  if(sfx.isMuted()){sfx.setMute(false);sfx.setBgmMute(false)}
  else sfx.setBgmMute(!sfx.isBgmMuted());
  renderSoundBtn();
  if(!sfx.isBgmMuted()&&!sfx.isMuted())sfx.tick();
});
renderSoundBtn();

/* ---------- rules modal ---------- */
function fillRulesArt(){
  const suits=[
    {s:'H',title:'♥ Hearts',blurb:'Return discarded cards under the Tavern',ex:'AH'},
    {s:'D',title:'♦ Diamonds',blurb:'Official: shared clockwise draw. Home: each draws up to value',ex:'AD'},
    {s:'C',title:'♣ Clubs',blurb:'Double attack damage',ex:'AC'},
    {s:'S',title:'♠ Spades',blurb:'Reduce enemy attack this fight',ex:'AS'}
  ];
  $('ruleSuits').innerHTML=suits.map(x=>`<div class="ruleSuit"><img src="${customArt[x.ex]||`/asset/art/${x.ex}.png`}" alt="${x.title}"><b style="color:${SUITFX[x.s]}">${x.title}</b><span>${x.blurb}</span></div>`).join('');
  $('ruleJesters').innerHTML=`<img src="${customArt.J1||'/asset/art/J1.png'}" alt="Jester 1"><img src="${customArt.J2||'/asset/art/J2.png'}" alt="Jester 2">`;
}
$('rulesBtn').onclick=()=>{fillRulesArt();$('rulesModal').showModal()};
function toggleLog(force){
  const d=$('logModal');if(!d)return;
  const want=typeof force==='boolean'?force:!d.open;
  if(want){try{d.showModal()}catch{d.setAttribute('open','')} }
  else{try{d.close()}catch{d.removeAttribute('open')} }
}
$('logBtn')?.addEventListener('click',()=>toggleLog(true));
$('logBtn2')?.addEventListener('click',()=>toggleLog(true));
$('logClose')?.addEventListener('click',()=>toggleLog(false));
$('endingLog')?.addEventListener('click',()=>toggleLog(true));
$('logModal')?.addEventListener('click',(e)=>{if(e.target===$('logModal'))toggleLog(false)});
$('leaveBattle')?.addEventListener('click',()=>$('leave')?.click());

/* ---------- fx primitives ---------- */
function fxEl(cls,html='',css={}){const d=document.createElement('div');d.className=cls;d.innerHTML=html;Object.assign(d.style,css);$('fx').appendChild(d);return d}
const rm=(el,a)=>a.finished.then(()=>el.remove(),()=>el.remove());
function center(el){const r=el.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height}}
function burst(x,y,color,n=14,dist=90,life=650){
  for(let i=0;i<n;i++){const s=rnd(4,11),a=rnd(0,Math.PI*2),d=dist*rnd(.4,1.2);
    const el=fxEl('p','',{left:x+'px',top:y+'px',width:s+'px',height:s+'px',background:color,boxShadow:`0 0 10px ${color}`});
    rm(el,el.animate([{transform:'translate(-50%,-50%) scale(1)',opacity:1},{transform:`translate(calc(-50% + ${Math.cos(a)*d}px),calc(-50% + ${Math.sin(a)*d+34}px)) scale(0)`,opacity:0}],{duration:life*rnd(.7,1.3),easing:'cubic-bezier(.1,.8,.3,1)'}))}
}
function floatText(x,y,text,{color='#fff',size=36,rise=70,ms=1100}={}){
  const el=fxEl('float',text,{left:x+'px',top:y+'px',color,fontSize:size+'px'});
  rm(el,el.animate([{transform:'translate(-50%,-50%) scale(.4)',opacity:0},{transform:'translate(-50%,-50%) scale(1.3)',opacity:1,offset:.18},{transform:'translate(-50%,-50%) scale(1)',opacity:1,offset:.62},{transform:`translate(-50%,calc(-50% - ${rise}px)) scale(1)`,opacity:0}],{duration:ms,easing:'ease-out'}));
}
function ring(x,y,color,size=260,ms=600){
  const el=fxEl('ring','',{left:x+'px',top:y+'px',color});
  rm(el,el.animate([{width:'20px',height:'20px',opacity:1},{width:size+'px',height:size+'px',opacity:0}],{duration:ms,easing:'ease-out'}));
}
function slash(x,y,color,angle=-20,size=280){
  const el=fxEl('slash',`<svg width="${size}" height="${size}" viewBox="0 0 200 200"><path d="M14 192 Q108 104 188 8" stroke="${color}" stroke-width="11"/><path d="M34 192 Q118 112 192 36" stroke="#fff" stroke-width="3.5"/></svg>`,{left:x+'px',top:y+'px',transform:`translate(-50%,-50%) rotate(${angle}deg)`});
  setTimeout(()=>el.remove(),520);
}
function shakeShell(amp=8){$('shell').animate([{transform:'translate(0,0)'},{transform:`translate(${-amp}px,${amp/3}px)`},{transform:`translate(${amp}px,${-amp/3}px)`},{transform:`translate(${-amp/2}px,${amp/4}px)`},{transform:'translate(0,0)'}],{duration:420,easing:'ease-out'})}
function hitStage(amp=10){const st=document.querySelector('.stage');
  st.animate([{transform:'translate(0,0)',filter:'brightness(3) saturate(.3)'},{transform:`translate(${-amp}px,${amp/3}px) rotate(-1.5deg)`,filter:'brightness(1.5)'},{transform:`translate(${amp}px,${-amp/3}px) rotate(1.5deg)`},{transform:`translate(${-amp/2}px,0)`},{transform:'translate(0,0)',filter:'brightness(1)'}],{duration:380,easing:'ease-out'})}
function pulsePile(id){const el=$(id);el.classList.remove('pulse');void el.offsetWidth;el.classList.add('pulse')}
function flyIcons(from,toEl,html,n,{size=28,color='#fff',ms=900}={}){
  const t=center(toEl);let last=Promise.resolve();
  for(let i=0;i<n;i++){
    const el=fxEl('float',html,{left:from.x+'px',top:from.y+'px',fontSize:size+'px',color,webkitTextStroke:'0',textShadow:`0 0 12px ${color}`});
    const mx=(t.x-from.x)/2+rnd(-90,90),my=Math.min(0,t.y-from.y)-rnd(40,110);
    const a=el.animate([{transform:'translate(-50%,-50%) scale(.3)',opacity:0},{transform:`translate(calc(-50% + ${mx}px),calc(-50% + ${my}px)) scale(1.1)`,opacity:1,offset:.35},{transform:`translate(calc(-50% + ${t.x-from.x}px),calc(-50% + ${t.y-from.y}px)) scale(.5)`,opacity:.9}],{duration:ms,delay:i*80,easing:'ease-in-out',fill:'backwards'});
    rm(el,a);last=a.finished.catch(()=>{});
  }
  return last;
}
function banner(text,sub='',color='#e6c27a',ms=1500){
  $('banner').innerHTML=`<div class="b" style="--bc:${color};animation-duration:${ms}ms">${text}${sub?`<small>${sub}</small>`:''}</div>`;
  return sleep(ms*.62);
}
function confetti(n=110){
  const cols=['#ffe29a','#e6c27a','#ff6b80','#b7e86a','#bcdcff','#fff'];
  for(let i=0;i<n;i++){const el=fxEl('confetti','',{left:rnd(0,100)+'vw',background:cols[i%cols.length]});
    rm(el,el.animate([{transform:'translateY(0) rotate(0)',opacity:1},{transform:`translate(${rnd(-120,120)}px,${innerHeight+60}px) rotate(${rnd(360,1080)}deg)`,opacity:1}],{duration:rnd(2200,4200),delay:rnd(0,900),easing:'cubic-bezier(.3,.5,.6,1)'}))}
}
function vignette(){const el=fxEl('vignette');rm(el,el.animate([{opacity:0},{opacity:1,offset:.2},{opacity:0}],{duration:900}))}

/* ---------- ghost cards ---------- */
const GW=92,GH=GW*1.4;
const place=(cx,cy,s=1,r=0,o=1)=>({transform:`translate(${cx-GW/2}px,${cy-GH/2}px) scale(${s}) rotate(${r}deg)`,opacity:o});
function ghostCard(c){const g=makeCard(c,{cls:'ghost'});g.style.setProperty('--w',GW+'px');$('fx').appendChild(g);return g}
function startPoint(c,mine,i,n){
  const f=pendingFrom[c.id];
  if(mine&&f)return{x:f.x,y:f.y,s:f.w/GW};
  const p=center($('players'));return{x:p.x+(i-(n-1)/2)*20,y:p.y,s:.45};
}
async function flyCardsTo(ev,mine,targetOf,{ms=480,gap:g=80}={}){
  const n=ev.cards.length,out=[];
  const ghosts=ev.cards.map((c,i)=>{const el=ghostCard(c),st=startPoint(c,mine,i,n),to=targetOf(i,n),r=rnd(-8,8);
    el.style.opacity=0;out.push({el,to,r});
    const a=el.animate([place(st.x,st.y,st.s,rnd(-25,25),1),place(to.x,to.y,to.s||1,r,1)],{duration:ms,delay:i*g,easing:'cubic-bezier(.2,.9,.3,1.08)',fill:'both'});
    return a.finished.catch(()=>{})});
  pendingFrom={};
  await Promise.all(ghosts);
  return out;
}

/* ---------- enemy / piles ---------- */
function setHpInstant(hp,max){
  const gh=$('hpGhost');gh.style.transition='none';
  const pct=Math.max(0,hp)/max*100+'%';gh.style.width=pct;$('hpBar').style.width=pct;void gh.offsetWidth;gh.style.transition='';
  $('hpText').textContent=`${Math.max(0,Math.round(hp))} / ${max}`;
}
function tweenHp(from,to,max,ms=850){
  return new Promise(res=>{
    const fill=$('hpBar'),t0=performance.now(),w=$('hpWrap');
    $('hpGhost').style.width=Math.max(0,to)/max*100+'%';
    w.classList.remove('flash');void w.offsetWidth;w.classList.add('flash');
    const step=t=>{const k=Math.min(1,(t-t0)/ms),h=from+(to-from)*(1-Math.pow(1-k,3));
      fill.style.width=Math.max(0,h)/max*100+'%';$('hpText').textContent=`${Math.max(0,Math.round(h))} / ${max}`;k<1?requestAnimationFrame(step):res()};
    requestAnimationFrame(step);setTimeout(res,ms+400);
  });
}
function renderAttackIntent(atk,shield){
  const now=Math.max(0,atk-shield),box=$('intent').querySelector('.intentAtk');
  box.classList.toggle('shielded',shield>0);
  $('atkDisplay').innerHTML=shield>0?`<span class="atkBase">${atk}</span><span class="atkNow">${now}</span>`:`<span class="atkNow">${atk}</span>`;
}
function setBossBackground(suitCode){
  document.body.classList.remove('suit-S','suit-H','suit-D','suit-C');
  if(suitCode)document.body.classList.add('suit-'+suitCode);
}
function renderPileStack(el,n,maxShow=5){
  el.innerHTML='';
  const show=Math.min(maxShow,Math.max(0,n));
  for(let i=0;i<show;i++){const d=document.createElement('div');d.className='pc';d.style.transform=`translate(${i*2}px,${-i*2}px)`;el.appendChild(d)}
}
function showEnemy({enemy:e,hp,max,atk,shield}){
  const title=`${RANKNAME[e.rank]} of ${SUITNAME[e.suit]}`;
  const bt=$('bossTitle');if(bt)bt.textContent=title;
  if(shownEnemyId!==e.id){
    const card=$('enemyCard'), wrap=document.createElement('div');wrap.className='art';
    const src=customArt[e.id]||`/asset/art/${e.id}.png`;
    const img=new Image();
    img.alt=title;
    img.onerror=()=>{wrap.innerHTML=royalArt(e.rank,e.suit)};
    img.src=src;wrap.appendChild(img);
    card.innerHTML='';card.appendChild(wrap);
    card.style.setProperty('--aura',SUITFX[e.suit]+'66');
    $('enemyName').innerHTML=title;
    $('immunity').innerHTML=`Immune to <b style="color:${SUITFX[e.suit]}">${suit[e.suit]}</b>`;
    setBossBackground(e.suit);
    const first=shownEnemyId===null;shownEnemyId=e.id;
    card.classList.remove('enter');void card.offsetWidth;card.classList.add('enter');
    card.onanimationend=ev=>{if(ev.animationName==='enemyIn')card.classList.remove('enter')};
    if(!first)sfx.whoosh();
  }
  setHpInstant(hp,max);
  renderAttackIntent(atk,shield);
}

function renderCastle(){
  const d=11-state.remaining;let h='';
  for(let i=0;i<12;i++){const r=i<4?'J':i<8?'Q':'K';if(i===4||i===8)h+='<span class="slotgap"></span>';h+=`<div class="slot ${r==='K'?'k':''} ${i<d?'done':i===d?'cur':''}">${r}</div>`}
  $('castle').innerHTML=h;
}
function renderBoard(){
  const s=state;
  $('enemiesLeft').textContent=s.remaining+1;
  $('tavern').textContent=s.tavern;$('discard').textContent=s.discard;
  renderPileStack($('tavernStack'),s.tavern);renderPileStack($('discardStack'),s.discard);
  showEnemy({enemy:s.enemy,hp:s.enemyHP,max:s.enemyMax,atk:s.enemyAttack,shield:s.shield});
  const pl=$('played');pl.innerHTML='';
  if(s.played.length)s.played.forEach(c=>pl.appendChild(makeCard(c,{cls:'mini'})));else pl.innerHTML='<span class="muted">—</span>';
  renderCastle();
  $('history').innerHTML=s.history.map(h=>`<div>${escapeHTML(h)}</div>`).join('');
}
function renderJesters(){
  const box=$('jesters'),solo=!!state.solo,battle=state.phase==='attack'||state.phase==='defend';
  box.classList.toggle('hidden',!solo||['lobby','won','lost'].includes(state.phase));
  if(!solo){$('jesterBtn').classList.add('hidden');return}
  const left=state.jesters|0,can=battle&&state.turn===state.me&&left>0&&!animating;
  box.innerHTML=`<span class="hint">Solo Jesters · discard hand &amp; refill to 8</span>`;
  for(let i=0;i<2;i++){
    const used=i>=left,id=i===0?'J1':'J2',b=document.createElement('button');
    b.className='jester illustrated'+(used?' used':'');b.disabled=used||!can;
    const img=document.createElement('img');img.src=customArt[id]||`/asset/art/${id}.png`;img.alt=`Jester ${i+1}`;img.draggable=false;
    img.onerror=()=>{b.textContent=used?'✕':'🃏'};
    b.appendChild(img);
    if(used){const stamp=document.createElement('span');stamp.className='usedStamp';stamp.textContent='USED';b.appendChild(stamp)}
    b.title=used?'Already flipped':can?'Flip to discard your hand and draw up to 8':'Available on your attack or defend step';
    if(!used)b.onclick=()=>doAction('jester');
    box.appendChild(b);
  }
  $('jesterBtn').classList.toggle('hidden',!solo||!battle);
  $('jesterBtn').disabled=!can;
}
function maybeAnnounceTurn(){
  if(!state||state.solo||animating)return;
  const key=`${state.phase}:${state.turn}`;
  if(key===lastTurnKey)return;
  const prev=lastTurnKey;lastTurnKey=key;
  if(!prev)return; // skip first paint after join/start
  if(state.turn!==state.me||(state.phase!=='attack'&&state.phase!=='defend'))return;
  sfx.turn();
  banner(state.phase==='defend'?'Defend!':'Your turn',escapeHTML(state.players[state.me].name),'#ffe29a',1400);
}
function updateNextPick(){
  const ids=[...selected],cards=state.hand.filter(c=>ids.includes(c.id));
  const want=!!state&&!state.solo&&state.phase==='attack'&&state.turn===state.me&&cards.length===1&&isJest(cards[0]);
  pickJesterNext=want;
  $('nextPick').classList.toggle('hidden',!want);
  if(!want)return;
  $('nextPickBtns').innerHTML=state.players.map((p,i)=>`<button data-next="${i}">${i===state.me?'You':escapeHTML(p.name)}</button>`).join('');
  $('nextPickBtns').querySelectorAll('button').forEach(b=>b.onclick=()=>{
    captureFrom();doAction('play',{ids:[...selected],next:+b.dataset.next});
  });
}
function ensureBattle(){
  const host=$('phaserHost');
  if(!host||!window.RegicideBattle)return;
  if(!host.dataset.mounted){
    window.RegicideBattle.mount(host);
    host.dataset.mounted='1';
    let resizeQueued=false;
    const onResize=()=>{
      if(resizeQueued)return;
      resizeQueued=true;
      requestAnimationFrame(()=>{
        resizeQueued=false;
        window.RegicideBattle.resize();
        window.RegicideBattle.sync(state);
      });
    };
    window.addEventListener('resize',onResize,{passive:true});
    window.addEventListener('orientationchange',()=>setTimeout(onResize,200));
    if(window.visualViewport)window.visualViewport.addEventListener('resize',onResize,{passive:true});
  }
  window.RegicideBattle.sync(state);
  requestAnimationFrame(()=>{
    window.RegicideBattle.resize();
    window.RegicideBattle.sync(state);
  });
}
const voiceSpeaking=new Set();
function renderPlayersHud(){
  const box=$('playersHud');if(!box||!state)return;
  const ROLE={warrior:'W',ranger:'R',mage:'M',cleric:'C'};
  box.innerHTML=state.players.map((p,i)=>{
    const on=state.turn===i&&(state.phase==='attack'||state.phase==='defend');
    const speaking=voiceSpeaking.has(i)?' speaking':'';
    const src=`/asset/players/${p.role||'warrior'}_idle.png?v=7`;
    return `<div class="av ${on?'on':''}${speaking}" data-seat="${i}" title="${escapeHTML(p.name)} · ${p.role||''} (${p.count})"><img src="${src}" alt=""><span class="srOnly">${ROLE[p.role]||'P'}${i+1}</span></div>`;
  }).join('');
}
const voice=new VoiceChat({
  getSession:()=>session,
  onStatus:(s)=>{
    const map={joined:'Voice on',left:'',muted:'Muted',unmuted:'Voice on',reconnecting:'Reconnecting…'};
    setVoiceStatus(map[s]??s);
    renderVoiceUi();
  },
  onSpeaking:(index,speaking)=>{
    if(speaking)voiceSpeaking.add(index);else voiceSpeaking.delete(index);
    document.querySelectorAll(`.playersHud .av[data-seat="${index}"]`).forEach(el=>el.classList.toggle('speaking',speaking));
  },
  onRoster:()=>renderVoiceUi(),
  onError:(err)=>{
    setVoiceStatus(err?.message||String(err));
    handleError(err instanceof Error?err:new Error(String(err)),session?'gameError':'setupError');
    renderVoiceUi();
  },
});
function renderVoiceUi(){
  const coOp=!!session&&state&&!state.solo;
  $('voiceControls')?.classList.toggle('hidden',!coOp);
  $('voiceControlsBattle')?.classList.toggle('hidden',!coOp);
  const on=!!voice.joined;
  ['voiceJoin','voiceJoin2'].forEach(id=>$(id)?.classList.toggle('hidden',on));
  ['voiceLeave','voiceLeave2'].forEach(id=>$(id)?.classList.toggle('hidden',!on));
  ['voiceMute','voiceMute2'].forEach(id=>{
    const el=$(id);if(!el)return;
    el.classList.toggle('hidden',!on);
    el.textContent=id.endsWith('2')?(voice.muted?'🔇':'🎤'):(voice.muted?'Unmute':'Mute');
    el.title=voice.muted?'Unmute mic':'Mute mic';
  });
}
function setVoiceStatus(msg){
  const el=$('voiceStatus');if(el)el.textContent=msg||'';
}
async function voiceJoin(){
  try{await voice.join()}catch(e){/* onError already fired */}
}
function voiceLeave(){voice.leave();voiceSpeaking.clear();renderPlayersHud()}
function voiceMuteToggle(){voice.toggleMute();renderVoiceUi()}
$('voiceJoin')?.addEventListener('click',voiceJoin);
$('voiceJoin2')?.addEventListener('click',voiceJoin);
$('voiceLeave')?.addEventListener('click',voiceLeave);
$('voiceLeave2')?.addEventListener('click',voiceLeave);
$('voiceMute')?.addEventListener('click',voiceMuteToggle);
$('voiceMute2')?.addEventListener('click',voiceMuteToggle);
function updatePhaseBanner(){
  const el=$('phaseBanner');if(!el||!state)return;
  const own=state.turn===state.me;
  let msg='';
  if(state.phase==='attack'&&own)msg='Your Turn — Play cards, then the royal will attack.';
  else if(state.phase==='defend'&&own)msg='Defend — Discard cards to cover the royal’s attack.';
  else if(state.phase==='attack')msg=`${state.players[state.turn]?.name||'Player'} is attacking…`;
  else if(state.phase==='defend')msg=`${state.players[state.turn]?.name||'Player'} must defend…`;
  el.textContent=msg;
  el.classList.toggle('show',!!msg);
}
function settingsSummary(s){
  const st=s?.settings||{};
  const d=st.diamondsEach?'Diamonds: each draws':'Diamonds: official';
  const j=s.solo?'Solo Jesters: set-aside':(st.jestersHouse?'Jesters: house':'Jesters: official');
  return `${d} · ${j}`;
}
function comboLegal(cards){
  if(!cards.length||cards.length>4)return false;
  if(cards.some(isJest))return cards.length===1;
  const aces=cards.filter(c=>c.rank==='A');
  if(aces.length)return cards.length===1||cards.length===2;
  if(cards.length===1)return true;
  return cards.every(c=>c.rank===cards[0].rank)&&cards.reduce((n,c)=>n+v(c),0)<=10;
}
function render(){
  $('setup').classList.toggle('hidden',!!session);$('game').classList.toggle('hidden',!session);
  if(!session||!state){renderVoiceUi();return}
  $('code').textContent=state.code;
  const solo=!!state.solo,lobby=state.phase==='lobby',ending=['lost','won'].includes(state.phase);
  const battle=state.phase==='attack'||state.phase==='defend',own=state.turn===state.me;
  const n=state.players.length;
  // Keep fullscreen battle shell through endgame so the result card is a popup (no page scroll)
  const inBattleView=!lobby;
  document.body.classList.toggle('inBattle',!!session&&inBattleView);
  document.body.classList.toggle('isEnding',!!session&&ending);
  sfx.startBgm(!!session&&inBattleView&&!ending);
  renderVoiceUi();
  $('modeTag').textContent=solo?'SOLO ASSAULT':`PRIVATE CO-OP · ${n} PLAYER${n===1?'':'S'}`;
  $('roomLabel').textContent=solo?'Solo':'Room';
  $('copy').classList.toggle('hidden',solo);
  const rc=$('rulesChip');if(rc)rc.textContent=settingsSummary(state);
  const ROLE={warrior:'Warrior',ranger:'Ranger',mage:'Mage',cleric:'Cleric'};
  $('players').innerHTML=state.players.map((p,i)=>`<div class="pl ${battle&&state.turn===i?'turn':''}"><div class="nm">${escapeHTML(p.name)}<small>${ROLE[p.role]||'Knight'}${i===state.me?' · You':''} · ${p.count}/${state.handMax||7}</small></div>${!solo&&i!==state.me&&!lobby?`<div class="backs" data-backs="${p.count}"></div>`:''}</div>`).join('');
  document.querySelectorAll('[data-backs]').forEach(b=>{for(let i=0;i<Math.min(8,+b.dataset.backs);i++)b.appendChild(backCard())});
  $('lobby').classList.toggle('hidden',!lobby||solo);$('active').classList.toggle('hidden',lobby&&!solo);
  $('ending').classList.toggle('hidden',!ending||animating);$('start').disabled=!state.canStart;
  if(lobby&&!solo){
    setBossBackground(null);
    document.body.classList.remove('inBattle');
    sfx.startBgm(false);
    const lr=$('lobbyRules');if(lr)lr.textContent=settingsSummary(state);
    const lc=$('lobbyCount');if(lc)lc.textContent=`${n} / ${state.maxPlayers||4} knights · need at least 2 to start`;
    return;
  }
  ensureBattle();
  renderPlayersHud();
  updatePhaseBanner();
  if(!animating){renderBoard();if(state.phase!=='won')$('enemyCard').style.opacity=''}
  maybeAnnounceTurn();
  const me=state.players[state.me];
  $('turnBadge').textContent=ending?'Battle finished':own?(state.phase==='defend'?'Defend!':'Your Turn'):`${state.players[state.turn].name}'s turn`;
  if(own&&me)$('turnBadge').textContent=(state.phase==='defend'?'Defend · ':'Your Turn · ')+`${me.name} · ${(ROLE[me.role]||'')} (${me.count}/${state.handMax||7})`;
  $('turnBadge').className='turnBadge'+(!ending&&own?(state.phase==='defend'?' defend':' mine'):'');
  const blockedSuit=state.immune&&state.enemy?state.enemy.suit:null;
  const hand=$('hand'),first=prevHandIds===null;hand.innerHTML='';
  const sorted=sortHand(state.hand),nCards=sorted.length;
  sorted.forEach((c,i)=>{
    const b=makeCard(c,{tag:'button'});
    if(selected.has(c.id))b.classList.add('selected');
    if(blockedSuit&&c.suit===blockedSuit)b.classList.add('powerBlocked');
    b.disabled=!own||!battle;
    const mid=(nCards-1)/2,t=nCards<=1?0:(i-mid)/Math.max(mid,1);
    const rot=t*9, lift=Math.abs(t)*10;
    b.style.setProperty('--fan-rot',rot+'deg');
    b.style.transform=`translateY(${lift}px) rotate(${rot}deg)`;
    b.style.zIndex=String(10+i);
    if((first||!prevHandIds.has(c.id))&&!isTouchUi()){
      b.classList.add('deal');b.style.animationDelay=((first?i*55:0)+(animating?1400:0))+'ms'
    }
    b.onclick=()=>{
      if(isJest(c)){selected.clear();selected.add(c.id)}
      else{
        [...selected].forEach(id=>{const x=state.hand.find(h=>h.id===id);if(x&&isJest(x))selected.delete(id)});
        if(selected.has(c.id))selected.delete(c.id);else selected.add(c.id);
      }
      sfx.tick();render();
    };
    hand.appendChild(b);
  });
  prevHandIds=new Set(state.hand.map(c=>c.id));
  renderJesters();
  updateNextPick();
  const cards=state.hand.filter(c=>selected.has(c.id));
  const sum=cards.reduce((n,c)=>n+v(c),0),need=Math.max(0,state.enemyAttack-state.shield);
  const onlyJest=cards.length===1&&isJest(cards[0]);
  const legal=comboLegal(cards);
  const immune=!!state.immune;
  const suits=[...new Set(cards.map(c=>c.suit).filter(Boolean))];
  const activeSuits=suits.filter(s=>!immune||s!==state.enemy?.suit);
  const dmg=onlyJest?0:sum*(activeSuits.includes('C')?2:1);
  const kill=state.enemy&&dmg>0&&dmg>=state.enemyHP;
  const pp=$('playPreview');
  if(pp){
    if(state.phase==='defend'&&own)pp.textContent=`Discard value ${sum} / need ${need}`;
    else if(!selected.size)pp.textContent='';
    else if(onlyJest)pp.textContent='Jester — cancel immunity, skip strike, pick next';
    else pp.textContent=`${legal?'✓':'✗'} Value ${sum} · dmg ${dmg}${activeSuits.length?` · ${activeSuits.map(s=>suit[s]).join('')}`:''}${kill?' · defeats royal':''}${!legal?' · illegal combo':''}`;
  }
  $('selection').textContent=state.phase==='defend'&&own
    ?(sum>=need?`Discard ${sum} covers the ${need} strike — you live`
      :selected.size?`Discard ${sum} < ${need} — you will be struck down`:`Select cards to discard (need ${need})`)
    :onlyJest?'Jester selected — cancel immunity, skip enemy strike, choose next player'
    :`Selected: ${selected.size} · value ${sum}${blockedSuit?` · ${suit[blockedSuit]} powers blocked`:''}`;
  $('attack').classList.toggle('hidden',state.phase!=='attack'||pickJesterNext);
  $('defend').classList.toggle('hidden',state.phase!=='defend');
  $('yield').classList.toggle('hidden',state.phase!=='attack');
  if(state.phase==='defend')$('defend').textContent=sum>=need?'🛡️ Block':'☠ Discard (die)';
  $('attack').disabled=!own||!selected.size||!legal||animating;
  // Free discard: any selection allowed — shortfall kills on confirm
  $('defend').disabled=!own||!selected.size||animating;
  $('yield').disabled=!own||!state.yieldAllowed||animating;
  if(state.phase==='won'){
    const m=state.medal,label={gold:'🥇 Gold victory — no Jesters used',silver:'🥈 Silver victory — 1 Jester used',bronze:'🥉 Bronze victory — 2 Jesters used'}[m];
    $('endingText').innerHTML=solo&&label?`🏆 Victory! The castle has fallen.<div class="medal ${m}">${label}</div>`:'🏆 Victory! The castle has fallen.';
  }else $('endingText').textContent='YOU DIED';
  $('endingSub').textContent=solo
    ?'Assault the castle again?'
    :'Back to the same room — keep your code, then Start when everyone is ready.';
  const rb=$('restart');if(rb)rb.textContent=solo?'Play again':'Back to room';
  $('ending').classList.toggle('won',state.phase==='won');$('ending').classList.toggle('lost',state.phase==='lost');
}

/* ---------- combat animation (DOM cards + Phaser AnimationDirector) ---------- */
async function fxAttackCards(ev){
  const mine=ev.by===state.me,stage=document.querySelector('.stage');
  showEnemy({enemy:ev.enemy,hp:ev.hpBefore,max:ev.enemyMax,atk:ev.enemyAtk,shield:ev.shieldBefore});
  const ec=center(stage);
  floatText(ec.x,ec.y-ec.h/2-6,mine?'You attack!':`${escapeHTML(ev.name)} attacks!`,{size:22,color:'#ffe29a',rise:24,ms:1000});
  sfx.attack();sfx.whoosh();
  const stagePos=(i,n)=>({x:ec.x+(i-(n-1)/2)*74,y:ec.y+ec.h*.3,s:1});
  const g=await flyCardsTo(ev,mine,stagePos);
  await sleep(200);
  const col=c=>c.suit?SUITFX[c.suit]:'#ffe29a',n=g.length;
  for(let i=0;i<n;i++){
    const c=ev.cards[i],{el}=g[i];
    await el.animate([place(g[i].to.x,g[i].to.y,1,g[i].r,1),place(ec.x,ec.y,.75,rnd(-20,20),0)],{duration:170,easing:'ease-in',fill:'forwards'}).finished.catch(()=>{});
    el.remove();
    const last=i===n-1,ang=rnd(-60,20);
    sfx.slash();sfx.hit(last||ev.suits.includes('C'));
    slash(ec.x+rnd(-14,14),ec.y+rnd(-14,14),col(c),ang+(i%2?70:0));
    burst(ec.x,ec.y,col(c),last?20:12,last?140:90);hitStage(last?16:9);if(last)shakeShell(ev.suits.includes('C')?14:7);
    await sleep(60);
  }
}
async function fxAttackAftermath(ev){
  const stage=document.querySelector('.stage'),ec=center(stage);
  const club=ev.suits.includes('C');
  floatText(ec.x,ec.y-30,`-${ev.damage}`,{color:club?'#ffb84d':'#ff5a4d',size:club?86:70,rise:90,ms:1400});
  if(club){
    sfx.club();
    shakeShell(18);
    ring(ec.x,ec.y,SUITFX.C,420,700);
    floatText(ec.x,ec.y+50,'CLUB SMASH ×2',{color:SUITFX.C,size:28,rise:40,ms:1400});
  }
  if(ev.blocked?.length)ev.blocked.forEach((s,i)=>floatText(ec.x,ec.y+(club?96:60)+i*32,`IMMUNE ${suit[s]}`,{color:'#cfd8d2',size:24,rise:20,ms:1500}));
  await tweenHp(ev.hpBefore,ev.hpAfter,ev.enemyMax);
  const power=[];
  if(ev.suits.includes('S')){
    sfx.shield();
    ring(ec.x,ec.y,SUITFX.S,220,700);
    floatText(ec.x,ec.y+70,`🛡️ −${ev.shieldAdded} attack`,{color:SUITFX.S,size:28,rise:50,ms:1300});
    renderAttackIntent(ev.enemyAtk,ev.shieldBefore+ev.shieldAdded);
    power.push(sleep(500));
  }
  if(ev.suits.includes('H')&&ev.healed){
    sfx.heal();const t=center($('stTavern'));
    power.push(flyIcons({x:ec.x,y:ec.y},$('stTavern'),'♥',Math.min(8,ev.healed),{color:SUITFX.H,size:34}).then(()=>{pulsePile('stTavern');floatText(t.x,t.y,`+${ev.healed}`,{color:SUITFX.H,size:26,rise:50})}));
  }
  if(ev.suits.includes('D')){
    sfx.draw();const h=center($('hand'));
    power.push(flyIcons({x:ec.x,y:ec.y},$('hand'),'♦',Math.max(2,Math.min(8,ev.drawn)),{color:SUITFX.D,size:34}).then(()=>{burst(h.x,h.y,SUITFX.D,16,120);floatText(h.x,h.y-40,`+${ev.drawn} cards`,{color:SUITFX.D,size:30,rise:50})}));
  }
  await Promise.all(power);
  if(!ev.defeated){
    if(ev.shielded)floatText(ec.x,ec.y+10,'Attack fully shielded!',{color:SUITFX.S,size:26,ms:1500});
    await sleep(200);
  }else{
    sfx.defeat();shakeShell(16);
    burst(ec.x,ec.y,'#ffe29a',30,200,900);ring(ec.x,ec.y,'#ffe29a',520,800);
  }
}
async function fxBossDefeatedBanner(ev){
  await banner(ev.victory?'Victory!':ev.exact?'Exact Kill!':'Defeated',ev.exact?`${RANKNAME[ev.enemy.rank]} of ${SUITNAME[ev.enemy.suit]} joins the Tavern`:`${RANKNAME[ev.enemy.rank]} of ${SUITNAME[ev.enemy.suit]}`,ev.exact?'#ffd36b':'#e6c27a',1400);
  if(ev.victory){
    const card=$('enemyCard');card.classList.remove('dissolve');card.style.opacity=0;
    window.RegicideBattle?.holdBossSpawn(false);
  }
}
function showNextEnemy(next,st){
  shownEnemyId=null;
  showEnemy({enemy:next,hp:st.hp,max:st.hp,atk:st.atk,shield:0});
  window.RegicideBattle?.holdBossSpawn(false);
  window.RegicideBattle?.sync(state);
}
async function fxDefendCards(ev){
  const mine=ev.by===state.me,stage=document.querySelector('.stage'),ec=center(stage);
  const covered=ev.covered??ev.incoming;
  const survived=ev.survived!==false&&!ev.lost;
  sfx.block();
  if(survived)sfx.shield();
  banner(survived?'Block!':'Last stand…',survived?`Discarded ${covered} to cover ${ev.incoming}`:`Discarded ${covered} — needed ${ev.incoming}`,'#8ec8ff',1000);
  const target=(i,n)=>({x:ec.x+(i-(n-1)/2)*74,y:ec.y+ec.h*.62,s:1});
  const g=await flyCardsTo(ev,mine,target,{ms:400,gap:50});
  await sleep(200);
  const t=center($('stDiscard'));
  await Promise.all(g.map(({el,to},i)=>el.animate([place(to.x,to.y,1,0,1),place(t.x,t.y,.3,rnd(-40,40),0)],{duration:400,delay:i*45,easing:'ease-in',fill:'forwards'}).finished.catch(()=>{})));
  g.forEach(({el})=>el.remove());pulsePile('stDiscard');
  await sleep(160);
}
async function fxDefendAftermath(ev,survived){
  const stage=document.querySelector('.stage'),ec=center(stage);
  sfx.growl();
  sfx.bossStrike();
  if(survived){
    banner('Enemy strikes!',`${ev.incoming} damage blocked`,'#ff6b60',1000);
    floatText(ec.x,ec.y+ec.h*.3,`Blocked ${ev.incoming}`,{color:'#b8dcff',size:42,rise:56,ms:1100});
    await sleep(80);
    sfx.bossBlock();
    shakeShell(10);
  }else{
    banner('Struck down!',`${ev.covered??0} could not stop ${ev.incoming}`,'#ff3b30',1200);
    sfx.hit(true);vignette();shakeShell(16);
    floatText(ec.x,ec.y+ec.h*.3,'FATAL',{color:'#ff5a4d',size:56,rise:60,ms:1200});
  }
  await sleep(350);
}
async function fxYield(ev){
  await banner(`${escapeHTML(ev.name)} yields`,ev.incoming?`Enemy attacks for ${ev.incoming}`:'Enemy attack fully shielded','#9fb3a8',1500);
  await sleep(200);
}
async function fxJester(ev){
  sfx.jester();
  const hand=center($('hand'));
  await banner('Jester flipped!',`Discard hand · draw ${ev.drawn} · ${ev.jestersLeft} left`,'#ff8a9c',1400);
  burst(hand.x,hand.y,'#ff8a9c',22,140);ring(hand.x,hand.y,'#ffe29a',280,700);
  pulsePile('stDiscard');pulsePile('stTavern');
  await sleep(700);
}
async function fxJesterPlay(ev){
  const mine=ev.by===state.me,stage=document.querySelector('.stage'),ec=center(stage);
  sfx.jester();
  await flyCardsTo(ev,mine,()=>({x:ec.x,y:ec.y,s:1.05}),{ms:420,gap:0});
  document.querySelectorAll('#fx .card.ghost').forEach(g=>g.remove());
  ring(ec.x,ec.y,'#c9a0ff',420,800);burst(ec.x,ec.y,'#c9a0ff',24,150);
  await banner('Immunity broken!',`${escapeHTML(ev.nextName)} goes next`,'#d7b3ff',1600);
  await sleep(300);
}

const combatOrch=new CombatOrchestrator(
  ()=>window.RegicideBattle?.getDirector?.()||null,
  {
    fxAttackCards, fxAttackAftermath, fxBossDefeatedBanner, showNextEnemy, statsOf,
    fxDefendCards, fxDefendAftermath, fxYield, fxJester, fxJesterPlay,
    markEnd:(k)=>{endPending=k},
    onQueueIdle:async()=>{
      animating=false;
      if(endPending&&state&&['won','lost'].includes(state.phase)){
        const w=endPending==='won';endPending=null;
        if(w){sfx.win();confetti();await banner('Victory!','The castle has fallen','#ffe29a',2200)}
        else{sfx.lose();vignette();shakeShell(10);await youDied()}
      }else endPending=null;
      render();
    }
  }
);

async function runQueue(){
  if(animating)return;animating=true;
  while(queue.length){
    const ev=queue.shift();
    if(document.hidden){pendingFrom={};continue}
    if(ev.victory)endPending='won';
    if(ev.lost)endPending='lost';
    const r=$('arena').getBoundingClientRect();
    if(r.top<0||r.bottom>innerHeight){$('arena').scrollIntoView({behavior:'smooth',block:'center'});await sleep(350)}
    try{
      await combatOrch.play(ev);
    }catch(e){console.error(e)}
    document.querySelectorAll('#fx .card.ghost').forEach(g=>g.remove());
    $('enemyCard').classList.remove('dissolve');
    if(!(state&&state.phase==='won'))$('enemyCard').style.opacity='';
  }
  animating=false;
  if(endPending&&state&&['won','lost'].includes(state.phase)){
    const w=endPending==='won';endPending=null;
    if(w){sfx.win();confetti();await banner('Victory!','The castle has fallen','#ffe29a',2200)}
    else{sfx.lose();vignette();shakeShell(10);await youDied()}
  }else endPending=null;
  render();
}
async function youDied(){
  const el=$('youDied');if(!el){await banner('Defeat','The castle still stands','#ff6b60',2200);return}
  el.classList.remove('show');void el.offsetWidth;el.classList.add('show');
  await sleep(3200);
  el.classList.remove('show');
  window.RegicideBattle?.fxDarken?.(false);
}

/* ---------- networking ---------- */
async function api(action,extra={}){
  const res=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...(session||{}),...extra})});
  const json=await res.json();if(!res.ok)throw Error(json.error);return json;
}
function handleError(e,id='gameError'){$(id).textContent=e.message;setTimeout(()=>{if($(id).textContent===e.message)$(id).textContent=''},4500)}
const IDLE=['lobby','won','lost'];
function applyState(s){
  const prev=state;state=s;
  if(prev&&IDLE.includes(prev.phase)&&!IDLE.includes(s.phase)){prevHandIds=null;shownEnemyId=null;lastTurnKey=null}
  // Someone hit Play again → everyone lands back in the shared room lobby
  if(s.phase==='lobby'&&prev&&prev.phase!=='lobby'){
    endPending=null;queue=[];animating=false;selected.clear();
    shownEnemyId=null;prevHandIds=null;lastTurnKey=null;pickJesterNext=false;
    window.RegicideBattle?.holdBossSpawn?.(false);
    document.body.classList.remove('inBattle');
    sfx.startBgm(false);
    setBossBackground(null);
  }
  if(lastSeq===null)lastSeq=s.seq||0;
  else{
    const fresh=(s.events||[]).filter(e=>e.seq>lastSeq);
    if(fresh.length){
      lastSeq=fresh[fresh.length-1].seq;
      // Don't swap Phaser boss to the next royal until death FX finishes
      if(fresh.some(e=>e.type==='attack'&&e.defeated)) window.RegicideBattle?.holdBossSpawn?.(true);
      if(s.phase!=='lobby'){
        queue.push(...fresh);
        runQueue();
      }
    }
  }
  selected=new Set([...selected].filter(id=>s.hand.some(c=>c.id===id)));
  render();
}
async function doAction(action,extra={}){
  if(busy)return;busy=true;
  try{
    const result=await api(action,extra);
    if(result.token){session={code:result.code,token:result.token};localStorage.setItem('regicideSession',JSON.stringify(session));lastSeq=null;prevHandIds=null;shownEnemyId=null;queue=[];lastTurnKey=null}
    selected.clear();pickJesterNext=false;applyState(result.state);
  }catch(e){pendingFrom={};handleError(e,session?'gameError':'setupError')}
  finally{busy=false}
}
function captureFrom(){
  pendingFrom={};
  document.querySelectorAll('#hand .card.selected').forEach(el=>{const r=el.getBoundingClientRect();pendingFrom[el.dataset.id]={x:r.left+r.width/2,y:r.top+r.height/2,w:r.width}});
}
const CHAR_ROLES=['warrior','ranger','mage','cleric'];
let selectedRole=localStorage.getItem('regicideRole')||'warrior';
if(!CHAR_ROLES.includes(selectedRole))selectedRole='warrior';
function renderCharPick(){
  const box=$('charPick');if(!box)return;
  box.innerHTML=CHAR_ROLES.map(role=>{
    const on=role===selectedRole?' selected':'';
    return `<button type="button" class="charOpt${on}" data-role="${role}" aria-pressed="${role===selectedRole}">
      <img src="/asset/players/${role}_idle.png" alt="${role}" draggable="false">
      <span>${role}</span>
    </button>`;
  }).join('');
  box.querySelectorAll('.charOpt').forEach(btn=>{
    btn.onclick=()=>{
      selectedRole=btn.dataset.role;
      localStorage.setItem('regicideRole',selectedRole);
      sfx.tick();
      renderCharPick();
    };
  });
}
renderCharPick();
function readHomeSettings(){
  return {
    diamondsEach:!!$('ruleDiamondsEach')?.checked,
    jestersHouse:!!$('ruleJestersHouse')?.checked,
  };
}
$('solo').onclick=()=>doAction('solo',{name:$('name').value,settings:readHomeSettings(),role:selectedRole});
$('create').onclick=()=>doAction('create',{name:$('name').value,settings:readHomeSettings(),role:selectedRole});
$('join').onclick=()=>doAction('join',{name:$('name').value,code:$('roomInput').value.trim().toUpperCase(),role:selectedRole});
$('start').onclick=()=>doAction('start');
$('attack').onclick=()=>{
  const ids=[...selected],cards=state.hand.filter(c=>ids.includes(c.id));
  if(cards.length===1&&isJest(cards[0])&&!state.solo){updateNextPick();return}
  captureFrom();doAction('play',{ids});
};
$('defend').onclick=()=>{captureFrom();doAction('defend',{ids:[...selected]})};
$('yield').onclick=()=>doAction('yield');
$('jesterBtn').onclick=()=>doAction('jester');
$('restart').onclick=()=>{
  endPending=null;queue=[];animating=false;selected.clear();
  doAction('restart');
};
$('copy').onclick=()=>navigator.clipboard.writeText(state.code).then(()=>{$('copy').textContent='Copied!';setTimeout(()=>$('copy').textContent='Copy room code',1500)}).catch(()=>window.prompt('Copy room code:',state.code));
$('leave').onclick=()=>{
  voice.leave();voiceSpeaking.clear();
  localStorage.removeItem('regicideSession');session=null;state=null;lastSeq=null;prevHandIds=null;shownEnemyId=null;queue=[];lastTurnKey=null;setBossBackground(null);document.body.classList.remove('inBattle','isEnding');sfx.startBgm(false);toggleLog(false);render()
};
async function poll(){
  if(!session||busy)return;
  try{const result=await api('state');if(JSON.stringify(result.state)!==JSON.stringify(state))applyState(result.state)}catch(e){/* room may have been lost after server restart */}
}

function setLoadProgress(pct,label){
  const bar=$('loadBar'),lab=$('loadLabel');
  if(bar)bar.style.width=`${Math.max(0,Math.min(100,Math.round(pct*100)))}%`;
  if(lab&&label)lab.textContent=label;
}
function warmImage(url){
  return new Promise((resolve)=>{
    const img=new Image();
    img.decoding='async';
    img.onload=img.onerror=()=>resolve();
    img.src=url;
  });
}
async function bootAssets(){
  const unlock=()=>{
    ['solo','create','join'].forEach(id=>{const b=$(id);if(b)b.disabled=false});
    const overlay=$('assetLoader');
    if(overlay){
      overlay.classList.add('done');
      overlay.setAttribute('aria-busy','false');
      setTimeout(()=>overlay.remove(),400);
    }
  };
  try{
    setLoadProgress(0.02,'Fetching manifest…');
    const [art, urls]=await Promise.all([
      fetch('/art-list').then(r=>r.json()).catch(()=>({})),
      assetRegistry.listWarmUrls().catch(()=>[]),
    ]);
    customArt=art||{};
    const cardUrls=Object.values(customArt).filter(Boolean);
    const all=[...urls,...cardUrls,'/asset/audio/battle-trance.mp3'];
    const unique=[...new Set(all)];
    let done=0;
    const total=Math.max(1,unique.length);
    setLoadProgress(0.05,`Loading assets 0/${total}…`);
    const concurrency=6;
    let i=0;
    async function worker(){
      while(i<unique.length){
        const url=unique[i++];
        if(url.endsWith('.mp3')){
          try{await fetch(url,{cache:'force-cache'}).catch(()=>null)}catch(_){/* ignore */}
        }else await warmImage(url);
        done++;
        setLoadProgress(0.05+0.9*(done/total),`Loading assets ${done}/${total}…`);
      }
    }
    await Promise.all(Array.from({length:concurrency},()=>worker()));
    setLoadProgress(1,'Ready');
  }catch(e){
    console.warn('Boot preload failed',e);
    setLoadProgress(1,'Ready (partial)');
  }
  render();
  unlock();
  if(session)poll();
  setInterval(poll,1000);
}
bootAssets();
