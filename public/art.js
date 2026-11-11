// Procedural hero portraits for the 12 royals (J/Q/K x 4 suits).
// Drop custom images into public/asset/art/ (e.g. KS.png, QH.webp) and they override these automatically.
const SUITCH = {H:'♥',D:'♦',C:'♣',S:'♠'};
const SUITNAME = {H:'Hearts',D:'Diamonds',C:'Clubs',S:'Spades'};
const RANKNAME = {J:'Jack',Q:'Queen',K:'King'};
const SUITFX = {S:'#bcdcff',C:'#b7e86a',H:'#ff6b80',D:'#ffd36b'};
const PAL = {
  S:{bg1:'#0b1024',bg2:'#34467e',glow:'#9fc2ff',robe:'#222c58',robe2:'#3a4b8c',trim:'#d7e2ff',hair:'#cfd6e6',eye:'#8fd0ff'},
  C:{bg1:'#07180d',bg2:'#2c6b3b',glow:'#b8f06a',robe:'#1b4727',robe2:'#2f7a41',trim:'#e6e08a',hair:'#5a3b22',eye:'#d6ff6a'},
  H:{bg1:'#260810',bg2:'#a3243a',glow:'#ff8a9c',robe:'#701426',robe2:'#b32a43',trim:'#ffd6a0',hair:'#8a3a1f',eye:'#ffb08a'},
  D:{bg1:'#2c1a06',bg2:'#c4781f',glow:'#ffd47a',robe:'#8f5110',robe2:'#d78a24',trim:'#fff0b0',hair:'#e4bb62',eye:'#fff2a0'}
};

function weapon(suit){
  const metal='url(#metal)', wood='#6b4423';
  if(suit==='S') return `<g><polygon points="158,26 167,48 167,196 149,196 149,48" fill="${metal}" stroke="#2b3550" stroke-width="1.5"/><line x1="158" y1="40" x2="158" y2="190" stroke="#fff" stroke-opacity=".55" stroke-width="1.6"/><rect x="136" y="194" width="44" height="9" rx="3" fill="url(#gold)" stroke="#6b4a10"/><rect x="154" y="203" width="8" height="26" fill="#3b2a1a"/><circle cx="158" cy="232" r="6" fill="url(#gold)"/></g>`;
  if(suit==='C') return `<g><rect x="154" y="86" width="9" height="150" rx="3" fill="${wood}" stroke="#2c1a0a"/><circle cx="158" cy="72" r="23" fill="#5a3a1c" stroke="#2c1a0a" stroke-width="2"/><g fill="url(#metal)" stroke="#222"><polygon points="158,40 163,52 153,52"/><polygon points="187,72 175,67 175,77"/><polygon points="129,72 141,67 141,77"/><polygon points="178,52 171,62 166,56"/><polygon points="138,52 145,62 150,56"/></g><circle cx="158" cy="72" r="9" fill="url(#gold)"/></g>`;
  if(suit==='H') return `<g><rect x="155" y="82" width="7" height="156" rx="3" fill="url(#gold)" stroke="#6b4a10"/><path d="M158 82 C130 60 138 28 158 46 C178 28 186 60 158 82 Z" fill="#ff3d5e" stroke="#7a0f26" stroke-width="2"/><path d="M146 48 C148 42 154 41 157 46" stroke="#fff" stroke-opacity=".6" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="158" cy="86" r="5" fill="url(#gold)"/></g>`;
  return `<g><rect x="150" y="62" width="8" height="176" rx="3" fill="${wood}" stroke="#2c1a0a"/><path d="M158 56 C198 44 204 106 158 112 C172 96 172 72 158 56 Z" fill="${metal}" stroke="#2b3550" stroke-width="1.5"/><polygon points="154,36 163,46 154,56 145,46" fill="#ffe066" stroke="#8a6410" stroke-width="1.5"/></g>`;
}

function royalArt(rank,suit){
  const p=PAL[suit],ch=SUITCH[suit];
  let rays='';for(let i=0;i<16;i++){const a=i*Math.PI/8;rays+=`<line x1="100" y1="130" x2="${100+Math.cos(a)*230}" y2="${130+Math.sin(a)*230}"/>`}
  const hairBack = rank==='Q'
    ? `<path d="M62 120 C52 175 48 215 66 250 L134 250 C152 215 148 175 138 120 Z" fill="${p.hair}"/>`
    : rank==='J' ? `<path d="M68 116 C60 150 64 170 74 180 L126 180 C136 170 140 150 132 116 Z" fill="${p.hair}"/>` : '';
  const shoulders=`<path d="M6 300 C8 232 50 206 100 206 C150 206 192 232 194 300 Z" fill="${p.robe}" stroke="#000" stroke-opacity=".35" stroke-width="2"/>
    <path d="M70 208 L100 258 L130 208 Z" fill="${p.robe2}"/>
    <path d="M70 208 L100 258 L130 208" fill="none" stroke="url(#gold)" stroke-width="3"/>`;
  let regalia='';
  if(rank==='K') regalia=`<path d="M22 232 C50 205 150 205 178 232 L182 250 C150 222 50 222 18 250 Z" fill="#f4efe6" stroke="#bbb" stroke-width="1.5"/>${[40,62,86,114,138,160].map((x,i)=>`<circle cx="${x}" cy="${222+(i%2)*6}" r="2.6" fill="#2a2a2a"/>`).join('')}`;
  else if(rank==='Q') regalia=`<path d="M64 214 Q100 250 136 214" fill="none" stroke="url(#gold)" stroke-width="4"/>${[72,84,100,116,128].map((x,i)=>`<circle cx="${x}" cy="${[226,236,242,236,226][i]}" r="4.5" fill="${p.eye}" stroke="#6b4a10"/>`).join('')}`;
  else regalia=`<path d="M40 214 L160 290" stroke="url(#gold)" stroke-width="9" opacity=".9"/><path d="M30 224 L150 300" stroke="${p.trim}" stroke-width="3" opacity=".5"/>`;
  const emblem=`<circle cx="100" cy="274" r="15" fill="#0007" stroke="url(#gold)" stroke-width="2.5"/><text x="100" y="283" text-anchor="middle" font-size="24" fill="${p.trim}" font-family="serif">${ch}</text>`;
  const face=`<rect x="87" y="172" width="26" height="40" fill="#cfa47e"/>
    <ellipse cx="100" cy="138" rx="29" ry="35" fill="url(#skin)" stroke="#6b4a30" stroke-opacity=".5" stroke-width="1.5"/>
    <path d="M72 130 C70 100 130 100 128 130 C120 114 108 110 100 112 C92 110 80 114 72 130 Z" fill="${p.hair}"/>
    <ellipse cx="86" cy="134" rx="11" ry="5" fill="${p.eye}" opacity=".55" filter="url(#blur)"/><ellipse cx="114" cy="134" rx="11" ry="5" fill="${p.eye}" opacity=".55" filter="url(#blur)"/>
    <path d="M78 133 Q87 129 96 135 Q87 138 78 133 Z" fill="${p.eye}" stroke="#111" stroke-width="1.2"/><path d="M122 133 Q113 129 104 135 Q113 138 122 133 Z" fill="${p.eye}" stroke="#111" stroke-width="1.2"/>
    <circle cx="87" cy="134" r="1.8" fill="#111"/><circle cx="113" cy="134" r="1.8" fill="#111"/>
    <path d="M76 124 L97 131" stroke="#1a1208" stroke-width="3.4" stroke-linecap="round"/><path d="M124 124 L103 131" stroke="#1a1208" stroke-width="3.4" stroke-linecap="round"/>
    <path d="M100 135 L95 150 Q100 153 105 150" stroke="#8a5e3c" stroke-width="2" fill="none" stroke-linecap="round"/>
    ${rank==='K'
      ? `<path d="M71 140 C68 178 88 196 100 196 C112 196 132 178 129 140 C124 158 112 163 100 161 C88 163 76 158 71 140 Z" fill="${p.hair}" stroke="#000" stroke-opacity=".25"/><path d="M84 154 Q100 146 116 154 Q100 160 84 154 Z" fill="${p.hair}" stroke="#000" stroke-opacity=".3"/><path d="M94 167 Q100 170 106 167" stroke="#2a1a10" stroke-width="2" fill="none"/>`
      : `<path d="M90 160 Q100 155 110 160" stroke="${rank==='Q'?'#b22a45':'#5a2a1a'}" stroke-width="${rank==='Q'?3.4:2.4}" fill="none" stroke-linecap="round"/>`}`;
  let head='';
  if(rank==='K') head=`<path d="M66 108 L66 72 L84 90 L100 60 L116 90 L134 72 L134 108 Z" fill="url(#gold)" stroke="#6b4a10" stroke-width="2"/><rect x="66" y="100" width="68" height="12" rx="2" fill="url(#gold)" stroke="#6b4a10" stroke-width="2"/><circle cx="100" cy="106" r="4.5" fill="${p.eye}" stroke="#600"/><circle cx="82" cy="106" r="3" fill="#ff4d4d"/><circle cx="118" cy="106" r="3" fill="#4da6ff"/><circle cx="66" cy="72" r="3.5" fill="#fff"/><circle cx="134" cy="72" r="3.5" fill="#fff"/><circle cx="100" cy="60" r="4" fill="#fff"/><rect x="98" y="42" width="4" height="16" fill="url(#gold)"/><rect x="92" y="47" width="16" height="4" fill="url(#gold)"/>`;
  else if(rank==='Q') head=`<path d="M70 108 L70 84 L85 96 L100 70 L115 96 L130 84 L130 108 Z" fill="url(#gold)" stroke="#6b4a10" stroke-width="2"/><rect x="69" y="100" width="62" height="11" rx="2" fill="url(#gold)" stroke="#6b4a10" stroke-width="2"/><path d="M100 70 C90 56 108 52 100 40 C112 52 108 62 100 70Z" fill="${p.eye}" opacity=".9"/><circle cx="100" cy="105" r="4" fill="${p.eye}" stroke="#600"/><circle cx="84" cy="105" r="2.6" fill="#fff"/><circle cx="116" cy="105" r="2.6" fill="#fff"/><path d="M70 110 C58 140 60 175 72 196" stroke="${p.trim}" stroke-width="3" fill="none" opacity=".6"/><path d="M130 110 C142 140 140 175 128 196" stroke="${p.trim}" stroke-width="3" fill="none" opacity=".6"/>`;
  else head=`<path d="M64 112 C62 78 140 74 138 108 C128 98 80 98 64 112 Z" fill="${p.robe2}" stroke="#000" stroke-opacity=".4" stroke-width="2"/><path d="M62 108 C80 98 120 98 140 108 L138 114 C120 106 80 106 64 114 Z" fill="url(#gold)" stroke="#6b4a10"/><path d="M128 86 C150 70 170 56 184 30 C172 58 160 84 132 100 Z" fill="${p.eye}" stroke="#111" stroke-opacity=".5"/><path d="M132 92 C150 82 166 70 176 52" stroke="#fff" stroke-opacity=".6" stroke-width="1.6" fill="none"/><circle cx="100" cy="98" r="4" fill="${p.eye}" stroke="#600"/>`;
  return `<svg class="royalSvg" viewBox="0 0 200 280" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg-${suit}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.bg1}"/><stop offset="1" stop-color="${p.bg2}"/></linearGradient>
    <radialGradient id="aura-${suit}" cx=".5" cy=".42" r=".6"><stop offset="0" stop-color="${p.glow}" stop-opacity=".75"/><stop offset="1" stop-color="${p.glow}" stop-opacity="0"/></radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b0"/><stop offset=".5" stop-color="#e2b04a"/><stop offset="1" stop-color="#9a6a1a"/></linearGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8c97ad"/><stop offset=".5" stop-color="#f1f5fb"/><stop offset="1" stop-color="#7a859b"/></linearGradient>
    <radialGradient id="skin" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#f6d9b8"/><stop offset="1" stop-color="#cf9e76"/></radialGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="3"/></filter>
  </defs>
  <rect width="200" height="280" fill="url(#bg-${suit})"/>
  <g stroke="${p.glow}" stroke-opacity=".13" stroke-width="7">${rays}</g>
  <rect width="200" height="280" fill="url(#aura-${suit})"/>
  <text x="100" y="196" text-anchor="middle" font-size="190" fill="${p.glow}" fill-opacity=".14" font-family="serif">${ch}</text>
  <g transform="translate(0,6)">${weapon(suit)}${hairBack}${shoulders}${regalia}${face}${head}${emblem}
  <ellipse cx="158" cy="${suit==='S'?200:suit==='C'?208:suit==='H'?210:206}" rx="11" ry="9" fill="#d9ad88" stroke="#6b4a30"/></g>
  <rect x="3" y="3" width="194" height="274" rx="10" fill="none" stroke="url(#gold)" stroke-width="3.5"/>
  <rect x="9" y="9" width="182" height="262" rx="6" fill="none" stroke="${p.trim}" stroke-opacity=".5" stroke-width="1"/>
</svg>`;
}
