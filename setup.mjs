#!/usr/bin/env node
/**
 * Xano Visualizer - Setup CLI
 *
 * Connects to any Xano workspace, discovers all tables,
 * and deploys a graph-data API endpoint for the visualizer.
 *
 * Usage:
 *   node setup-visualizer.mjs
 */

import * as readline from 'readline';

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function prompt(question, defaultValue) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        const display = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
        rl.question(display, answer => { rl.close(); resolve(answer.trim() || defaultValue || ''); });
    });
}

function promptMulti(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question(`${question}: `, answer => { rl.close(); resolve(answer.trim()); });
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const RATE_LIMIT_MS = 1500;

function printBanner() {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║                                                       ║');
    console.log('║          Xano Record Graph — Setup Wizard             ║');
    console.log('║                                                       ║');
    console.log('╚═══════════════════════════════════════════════════════╝');
    console.log('');
    console.log('This wizard will:');
    console.log('  1. Connect to your Xano workspace');
    console.log('  2. Discover all database tables');
    console.log('  3. Let you choose which tables to include');
    console.log('  4. Deploy a graph-data API endpoint');
    console.log('  5. Give you the URL for the visualizer');
    console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Xano Meta API
// ─────────────────────────────────────────────────────────────────────────────

async function xanoGet(baseUrl, token, path) {
    await sleep(RATE_LIMIT_MS);
    const url = `${baseUrl}/api:meta${path}`;
    const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Xano GET ${path} → ${res.status}: ${err}`);
    }
    return res.json();
}

async function xanoPost(baseUrl, token, path, body) {
    await sleep(RATE_LIMIT_MS);
    const url = `${baseUrl}/api:meta${path}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Xano POST ${path} → ${res.status}: ${err}`);
    }
    return res.json();
}

async function xanoXs(baseUrl, token, path, xanoscript) {
    await sleep(RATE_LIMIT_MS);
    const url = `${baseUrl}/api:meta${path}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'text/x-xanoscript' },
        body: xanoscript
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Xano XS ${path} → ${res.status}: ${err}`);
    }
    return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Connect & select workspace
// ─────────────────────────────────────────────────────────────────────────────

async function selectWorkspace() {
    console.log('─── Step 1: Connect to Xano ───\n');
    console.log('Find your credentials:');
    console.log('  Base URL → your Xano dashboard URL (e.g. https://x1234.xano.io)');
    console.log('  API Key  → Settings > API Keys > Metadata API\n');

    const baseUrl = (await prompt('Xano Base URL')).replace(/\/+$/, '');
    const token = await prompt('Metadata API Key');

    if (!baseUrl || !token) throw new Error('Base URL and API Key are required');

    console.log('\nFetching workspaces...');
    let workspaces;
    try {
        workspaces = await xanoGet(baseUrl, token, '/workspace');
    } catch (e) {
        throw new Error(`Could not connect: ${e.message}`);
    }

    const wsList = Array.isArray(workspaces) ? workspaces : (workspaces.items || []);
    if (!wsList.length) throw new Error('No workspaces found');

    console.log('\nAvailable workspaces:');
    wsList.forEach((ws, i) => console.log(`  ${i + 1}. ${ws.name || 'Unnamed'} (id: ${ws.id})`));
    console.log('');

    const sel = parseInt(await prompt('Select workspace (number)'), 10);
    if (isNaN(sel) || sel < 1 || sel > wsList.length) throw new Error('Invalid selection');

    const ws = wsList[sel - 1];
    console.log(`\n✓ Selected: ${ws.name} (id: ${ws.id})`);

    return { baseUrl, token, workspaceId: ws.id, workspaceName: ws.name };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Discover tables
// ─────────────────────────────────────────────────────────────────────────────

async function discoverTables(baseUrl, token, workspaceId) {
    console.log('\n─── Step 2: Discover Tables ───\n');
    console.log('Fetching workspace context...');

    const ctx = await xanoGet(baseUrl, token, `/workspace/${workspaceId}`);

    // The context response includes databaseTables
    let tables = [];
    if (ctx.databaseTables) {
        tables = ctx.databaseTables;
    } else if (ctx.tables) {
        tables = ctx.tables;
    } else {
        // Try the table endpoint directly
        const tblRes = await xanoGet(baseUrl, token, `/workspace/${workspaceId}/table`);
        tables = Array.isArray(tblRes) ? tblRes : (tblRes.items || []);
    }

    if (!tables.length) throw new Error('No tables found in this workspace');

    // Filter out system/queue tables by default
    const queuePatterns = ['pagination_queue', 'process_queue', 'log'];
    const coreTables = tables.filter(t =>
        !queuePatterns.some(p => t.name.toLowerCase().includes(p))
    );
    const queueTables = tables.filter(t =>
        queuePatterns.some(p => t.name.toLowerCase().includes(p))
    );

    console.log(`\nFound ${tables.length} tables (${coreTables.length} core, ${queueTables.length} queue/system):\n`);
    coreTables.forEach((t, i) => console.log(`  ${String(i + 1).padStart(2)}. ${t.name}`));
    if (queueTables.length) {
        console.log(`\n  --- Queue/System tables (excluded by default) ---`);
        queueTables.forEach(t => console.log(`      · ${t.name}`));
    }

    console.log('\nOptions:');
    console.log('  a = all core tables (recommended)');
    console.log('  1,3,5 = specific table numbers');
    console.log('  * = everything including queue tables\n');

    const choice = await prompt('Include tables', 'a');
    let selected;

    if (choice === '*') {
        selected = tables;
    } else if (choice === 'a' || choice === '') {
        selected = coreTables;
    } else {
        const indices = choice.split(',').map(s => parseInt(s.trim(), 10) - 1);
        selected = indices.filter(i => i >= 0 && i < coreTables.length).map(i => coreTables[i]);
    }

    console.log(`\n✓ Selected ${selected.length} tables:`);
    selected.forEach(t => console.log(`    · ${t.name}`));

    return selected;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Generate XanoScript & Deploy
// ─────────────────────────────────────────────────────────────────────────────

function generateGraphDataXanoScript(tables) {
    const queryBlocks = tables.map((t, i) => {
        const varName = `$t${i}`;
        return `    db.query "${t.name}" {
      return = {
        type  : "list"
        paging: {page: 1, per_page: 250, metadata: false}
      }
    } as ${varName}`;
    }).join('\n\n');

    const resultEntries = tables.map((t, i) => {
        const key = t.name.toLowerCase().replace(/\s+/g, '_');
        // Quote keys with special chars (hyphens etc.) so XanoScript doesn't parse as math
        const safeKey = /^[a-z0-9_]+$/.test(key) ? key : `"${key}"`;
        return `        ${safeKey}: $t${i}`;
    }).join('\n');

    return `query "graph-data" verb=GET {
  description = "Returns records from all tables for the graph visualizer"

  input {
  }

  stack {
${queryBlocks}

    var $result {
      value = {
${resultEntries}
      }
    }
  }

  response = $result
  history = false
}`;
}

function generateVisualizerXanoScript() {
    // The entire visualizer HTML, minified, served as text/html from Xano
    // Auto-fetches ./graph-data relative to its own URL
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Xano Record Graph</title><style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');*{margin:0;padding:0;box-sizing:border-box}body{background:#06060b;color:#e0e0e0;font-family:'Inter',sans-serif;overflow:hidden;height:100vh;width:100vw}#canvas{width:100%;height:100%;cursor:grab}#canvas:active{cursor:grabbing}#hud{position:fixed;top:20px;left:20px;z-index:10;display:flex;flex-direction:column;gap:10px}#hud h1{font-size:20px;font-weight:800;background:linear-gradient(135deg,#a78bfa,#60a5fa,#34d399);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:-0.5px}#hud .sub{font-size:11px;color:#555;margin-top:-6px}.legend{display:flex;flex-wrap:wrap;gap:5px;max-width:460px}.legend-item{display:flex;align-items:center;gap:5px;font-size:10px;color:#777;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:3px 8px;cursor:pointer;transition:all .2s;user-select:none}.legend-item:hover{background:rgba(255,255,255,0.08);color:#ccc}.legend-item.active{border-color:rgba(255,255,255,0.2);color:#fff}.legend-item.dimmed{opacity:0.25}.ldot{width:8px;height:8px;border-radius:50%;flex-shrink:0}#tooltip{position:fixed;pointer-events:none;background:rgba(10,10,20,0.96);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:14px 18px;font-size:12px;z-index:100;display:none;backdrop-filter:blur(16px);max-width:380px;box-shadow:0 12px 40px rgba(0,0,0,0.6)}.tt-type{font-size:9px;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:3px;font-weight:600}.tt-name{font-size:14px;font-weight:700;color:#fff}.tt-fields{margin-top:8px;font-size:11px;font-family:'JetBrains Mono',monospace;color:#888;line-height:1.6;max-height:220px;overflow-y:auto}.tt-fields .fk{color:#a78bfa}.tt-fields .fv{color:#ccc}#loading{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#06060b;z-index:200;flex-direction:column;gap:16px}#loading .spinner{width:40px;height:40px;border:3px solid rgba(167,139,250,0.2);border-top-color:#a78bfa;border-radius:50%;animation:spin 1s linear infinite}#loading .msg{font-size:13px;color:#666;text-align:center;max-width:400px}@keyframes spin{to{transform:rotate(360deg)}}#search-box{position:fixed;top:20px;right:20px;z-index:10}#search-box input{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:8px 14px;color:#ccc;font-size:12px;width:220px;outline:none;font-family:'Inter',sans-serif}#search-box input::placeholder{color:#444}#search-box input:focus{border-color:rgba(167,139,250,0.4);box-shadow:0 0 20px rgba(167,139,250,0.08)}#stats{position:fixed;bottom:20px;left:20px;font-size:10px;color:#444;z-index:10;font-family:'JetBrains Mono',monospace}#help{position:fixed;bottom:20px;right:20px;font-size:10px;color:#333;z-index:10;text-align:right;line-height:1.6;font-family:'JetBrains Mono',monospace}</style></head><body><div id="loading"><div class="spinner"></div><div class="msg">Loading graph data...</div></div><div id="hud"><h1>Xano Record Graph</h1><div class="sub">Click group to zoom · Dbl-click to fit · F to fit · Esc to reset</div><div class="legend" id="legend"></div></div><div id="search-box"><input type="text" placeholder="Search records..." id="search"></div><canvas id="canvas"></canvas><div id="tooltip"><div class="tt-type"></div><div class="tt-name"></div><div class="tt-fields"></div></div><div id="stats"></div><div id="help">scroll=zoom · drag=pan · click group=zoom in · dblclick=fit all</div><script>const PALETTE=['#60a5fa','#818cf8','#34d399','#f472b6','#fbbf24','#fb923c','#38bdf8','#a3e635','#ef4444','#c084fc','#14b8a6','#e879f9','#f59e0b','#22d3ee','#6ee7b7','#f87171','#a78bfa','#fdba74','#67e8f9','#86efac','#fca5a5','#d8b4fe','#fcd34d','#5eead4','#93c5fd','#bef264','#fb7185','#7dd3fc'];let tables={},nodes=[],edges=[],nodeById={},groups={},pan={x:0,y:0},zoom=1,dragging=false,dragStart={x:0,y:0},panStart={x:0,y:0},hoveredNode=null,activeFilter=null,searchTerm='',animTarget=null;const canvas=document.getElementById('canvas'),ctx=canvas.getContext('2d'),dpr=window.devicePixelRatio||1;function autoDetect(data){tables={};const tableNames=Object.keys(data).filter(k=>Array.isArray(data[k])&&data[k].length>0);const tableNameIndex={};tableNames.forEach(t=>{tableNameIndex[t.toLowerCase()]=t;tableNameIndex[t.toLowerCase().replace(/\\s+/g,'_')]=t;if(t.endsWith('s'))tableNameIndex[t.slice(0,-1).toLowerCase()]=t;if(t.endsWith('es'))tableNameIndex[t.slice(0,-2).toLowerCase()]=t});tableNames.forEach((key,i)=>{const records=data[key],sample=records[0]||{},fields=Object.keys(sample),fkFields=[],fkTargets={};fields.forEach(f=>{if(!f.endsWith('_id')||f==='id')return;const prefix=f.replace(/_id$/,'');const target=tableNameIndex[prefix.toLowerCase()]||tableNameIndex[prefix.toLowerCase()+'s']||tableNameIndex[prefix.toLowerCase().replace(/s$/,'')];if(target){fkFields.push(f);fkTargets[f]=target}});const nameField=detectNameField(fields,sample);tables[key]={color:PALETTE[i%PALETTE.length],label:prettifyName(key),fkFields,fkTargets,nameField,records,count:records.length}});return tables}function detectNameField(fields,sample){const priorities=['name','title','label','display_name','username','slug','email','description'];for(const p of priorities)if(fields.includes(p))return p;for(const f of fields){if(f==='id'||f==='created_at'||f==='updated_at')continue;const v=sample[f];if(typeof v==='string'&&v.length<80&&v.length>0)return f}return'id'}function prettifyName(str){return str.replace(/_/g,' ').replace(/\\b\\w/g,c=>c.toUpperCase())}function buildGraph(data){autoDetect(data);nodes=[];edges=[];nodeById={};groups={};Object.entries(tables).forEach(([key,cfg])=>{groups[key]={nodes:[],cx:0,cy:0,radius:0,color:cfg.color,label:cfg.label,count:cfg.count};cfg.records.forEach(rec=>{const nodeId=key+':'+rec.id;const raw=rec[cfg.nameField];const displayName=raw!=null?String(raw):'#'+rec.id;const label=displayName.length>26?displayName.slice(0,24)+'\\u2026':displayName;const n={id:nodeId,table:key,record:rec,label,color:cfg.color,x:0,y:0,vx:0,vy:0,radius:5};nodes.push(n);nodeById[nodeId]=n;nodeById['_idx_'+key+'_'+rec.id]=n;groups[key].nodes.push(n)})});Object.entries(tables).forEach(([key,cfg])=>{cfg.fkFields.forEach(fkField=>{const targetTable=cfg.fkTargets[fkField];if(!targetTable)return;cfg.records.forEach(rec=>{if(!rec[fkField])return;const srcNode=nodeById[key+':'+rec.id];const tgtNode=nodeById['_idx_'+targetTable+'_'+rec[fkField]];if(srcNode&&tgtNode)edges.push({source:srcNode,target:tgtNode,fk:fkField})})})});nodes.forEach(n=>{const conns=edges.filter(e=>e.source===n||e.target===n).length;n.radius=4+Math.min(conns*1.5,16)});const W=window.innerWidth,H=window.innerHeight;const tableKeys=Object.keys(tables).filter(k=>groups[k].count>0);const groupRadius=Math.min(W,H)*0.55;tableKeys.forEach((k,i)=>{const angle=(i/tableKeys.length)*Math.PI*2-Math.PI/2;const gcx=W/2+Math.cos(angle)*groupRadius*0.5;const gcy=H/2+Math.sin(angle)*groupRadius*0.5;groups[k].nodes.forEach((n,j)=>{const sa=j*2.4;const sr=Math.sqrt(j)*12;n.x=gcx+Math.cos(sa)*sr;n.y=gcy+Math.sin(sa)*sr});groups[k].cx=gcx;groups[k].cy=gcy});for(let iter=0;iter<120;iter++){const alpha=Math.max(0.01,1-iter/120);for(let i=0;i<nodes.length;i++){for(let j=i+1;j<nodes.length;j++){if(nodes[i].table!==nodes[j].table)continue;let dx=nodes[j].x-nodes[i].x,dy=nodes[j].y-nodes[i].y;let d2=dx*dx+dy*dy;if(d2>10000)continue;let d=Math.sqrt(d2)||1;let force=200/(d*d)*alpha;nodes[i].vx-=dx/d*force;nodes[i].vy-=dy/d*force;nodes[j].vx+=dx/d*force;nodes[j].vy+=dy/d*force}}edges.forEach(e=>{let dx=e.target.x-e.source.x,dy=e.target.y-e.source.y;let d=Math.sqrt(dx*dx+dy*dy)||1;let force=(d-80)*0.003*alpha;e.source.vx+=dx/d*force;e.source.vy+=dy/d*force;e.target.vx-=dx/d*force;e.target.vy-=dy/d*force});tableKeys.forEach(k=>{const g=groups[k];g.nodes.forEach(n=>{n.vx+=(g.cx-n.x)*0.02*alpha;n.vy+=(g.cy-n.y)*0.02*alpha})});nodes.forEach(n=>{n.vx*=0.8;n.vy*=0.8;n.x+=n.vx;n.y+=n.vy})}tableKeys.forEach(k=>{const g=groups[k];if(!g.nodes.length)return;let mx=0,my=0;g.nodes.forEach(n=>{mx+=n.x;my+=n.y});g.cx=mx/g.nodes.length;g.cy=my/g.nodes.length;let maxD=0;g.nodes.forEach(n=>{const d=Math.sqrt((n.x-g.cx)**2+(n.y-g.cy)**2);if(d>maxD)maxD=d});g.radius=maxD+30});buildLegend();zoomToAll()}function buildLegend(){const legend=document.getElementById('legend');legend.innerHTML='';Object.entries(tables).forEach(([key,cfg])=>{if(!cfg.count)return;const el=document.createElement('div');el.className='legend-item';el.innerHTML='<span class="ldot" style="background:'+cfg.color+'"></span>'+cfg.label+' ('+cfg.count+')';el.addEventListener('click',()=>{if(activeFilter===key){activeFilter=null;document.querySelectorAll('.legend-item').forEach(l=>{l.classList.remove('dimmed','active')})}else{activeFilter=key;document.querySelectorAll('.legend-item').forEach(l=>l.classList.add('dimmed'));el.classList.remove('dimmed');el.classList.add('active')}draw()});el.addEventListener('dblclick',()=>zoomToGroup(key));legend.appendChild(el)})}function zoomToGroup(key){const g=groups[key];if(!g||!g.nodes.length)return;const tz=Math.min(4,Math.min(window.innerWidth,window.innerHeight)/(g.radius*2.5));animTarget={px:window.innerWidth/2-g.cx*tz,py:window.innerHeight/2-g.cy*tz,z:tz,t:0};requestAnimationFrame(animateZoom)}function zoomToAll(){if(!nodes.length){draw();return}let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;nodes.forEach(n=>{if(n.x<minX)minX=n.x;if(n.y<minY)minY=n.y;if(n.x>maxX)maxX=n.x;if(n.y>maxY)maxY=n.y});const bw=maxX-minX+100,bh=maxY-minY+100;const tz=Math.min(window.innerWidth/bw,window.innerHeight/bh)*0.82;const cx=(minX+maxX)/2,cy=(minY+maxY)/2;animTarget={px:window.innerWidth/2-cx*tz,py:window.innerHeight/2-cy*tz,z:tz,t:0};requestAnimationFrame(animateZoom)}function animateZoom(){if(!animTarget)return;animTarget.t+=0.06;const t=Math.min(1,animTarget.t);const ease=t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;pan.x+=(animTarget.px-pan.x)*ease*0.15;pan.y+=(animTarget.py-pan.y)*ease*0.15;zoom+=(animTarget.z-zoom)*ease*0.15;draw();if(t<1)requestAnimationFrame(animateZoom);else animTarget=null}function isVisible(n){if(activeFilter&&n.table!==activeFilter)return false;if(searchTerm&&!n.label.toLowerCase().includes(searchTerm)&&!n.table.toLowerCase().includes(searchTerm))return false;return true}function screenToWorld(sx,sy){return{x:(sx-pan.x)/zoom,y:(sy-pan.y)/zoom}}function draw(){const w=canvas.width/dpr,h=canvas.height/dpr;ctx.clearRect(0,0,w,h);ctx.save();ctx.translate(pan.x,pan.y);ctx.scale(zoom,zoom);if(zoom>0.3){ctx.strokeStyle='rgba(255,255,255,'+Math.min(0.03,0.01*zoom)+')';ctx.lineWidth=0.5/zoom;const step=80,vp=screenToWorld(0,0),vp2=screenToWorld(w,h);const sx=Math.floor(vp.x/step)*step,ex=Math.ceil(vp2.x/step)*step;const sy=Math.floor(vp.y/step)*step,ey=Math.ceil(vp2.y/step)*step;for(let x=sx;x<=ex;x+=step){ctx.beginPath();ctx.moveTo(x,sy);ctx.lineTo(x,ey);ctx.stroke()}for(let y=sy;y<=ey;y+=step){ctx.beginPath();ctx.moveTo(sx,y);ctx.lineTo(ex,y);ctx.stroke()}}Object.entries(groups).forEach(([key,g])=>{if(!g.nodes.length)return;const dimmed=activeFilter&&activeFilter!==key;const grad=ctx.createRadialGradient(g.cx,g.cy,0,g.cx,g.cy,g.radius*1.3);grad.addColorStop(0,g.color+(dimmed?'05':'12'));grad.addColorStop(0.7,g.color+(dimmed?'03':'08'));grad.addColorStop(1,'transparent');ctx.fillStyle=grad;ctx.beginPath();ctx.arc(g.cx,g.cy,g.radius*1.3,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(g.cx,g.cy,g.radius,0,Math.PI*2);ctx.strokeStyle=g.color+(dimmed?'10':'25');ctx.lineWidth=1.5/zoom;ctx.setLineDash([4/zoom,4/zoom]);ctx.stroke();ctx.setLineDash([]);const fs=Math.max(10,Math.min(18,14/zoom));ctx.font='700 '+fs+'px Inter';ctx.fillStyle=g.color+(dimmed?'40':'cc');ctx.textAlign='center';ctx.fillText(g.label+' ('+g.count+')',g.cx,g.cy-g.radius-8/zoom)});edges.forEach(e=>{const sv=isVisible(e.source),tv=isVisible(e.target);if(!sv&&!tv)return;const hl=hoveredNode&&(e.source===hoveredNode||e.target===hoveredNode);ctx.beginPath();ctx.moveTo(e.source.x,e.source.y);ctx.lineTo(e.target.x,e.target.y);if(hl){ctx.strokeStyle='rgba(167,139,250,0.7)';ctx.lineWidth=2/zoom}else if(e.source.table===e.target.table){ctx.strokeStyle='rgba(255,255,255,'+((sv&&tv)?0.06:0.02)+')';ctx.lineWidth=0.5/zoom}else{ctx.strokeStyle=e.source.color+((sv&&tv)?'30':'10');ctx.lineWidth=1/zoom}ctx.stroke();if(hl){const angle=Math.atan2(e.target.y-e.source.y,e.target.x-e.source.x);const mx=(e.source.x+e.target.x)/2,my=(e.source.y+e.target.y)/2,as=6/zoom;ctx.beginPath();ctx.moveTo(mx,my);ctx.lineTo(mx-as*Math.cos(angle-0.4),my-as*Math.sin(angle-0.4));ctx.moveTo(mx,my);ctx.lineTo(mx-as*Math.cos(angle+0.4),my-as*Math.sin(angle+0.4));ctx.stroke()}});const showLabels=zoom>0.6,showDetails=zoom>1.5;nodes.forEach(n=>{const vis=isVisible(n),r=n.radius;const isHov=n===hoveredNode;const connected=hoveredNode&&edges.some(e=>(e.source===hoveredNode&&e.target===n)||(e.target===hoveredNode&&e.source===n));ctx.globalAlpha=vis?(isHov?1:(hoveredNode?(connected?0.9:0.08):0.85)):0.03;if(isHov||connected){const g2=ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,r*3);g2.addColorStop(0,n.color+'30');g2.addColorStop(1,'transparent');ctx.fillStyle=g2;ctx.beginPath();ctx.arc(n.x,n.y,r*3,0,Math.PI*2);ctx.fill()}ctx.beginPath();ctx.arc(n.x,n.y,r,0,Math.PI*2);ctx.fillStyle=n.color+(isHov?'ee':'77');ctx.fill();ctx.strokeStyle=n.color+(isHov?'ff':'44');ctx.lineWidth=(isHov?2:0.5)/zoom;ctx.stroke();if(showLabels&&(isHov||connected||r>10||showDetails)){ctx.font=(isHov?'600':'400')+' 9px Inter';ctx.fillStyle=isHov?'#fff':(connected?'#ddd':'#888');ctx.textAlign='center';ctx.fillText(n.label,n.x,n.y-r-3)}ctx.globalAlpha=1});ctx.restore();const totalTables=Object.keys(tables).filter(k=>tables[k].count>0).length;document.getElementById('stats').textContent=totalTables+' tables · '+nodes.length+' records · '+edges.length+' relationships · zoom '+zoom.toFixed(2)+'x'}function getNodeAt(mx,my){const w=screenToWorld(mx,my);let best=null,bestD=Infinity;nodes.forEach(n=>{const d=Math.sqrt((w.x-n.x)**2+(w.y-n.y)**2);if(d<n.radius*1.5&&d<bestD){best=n;bestD=d}});return best}function getGroupAt(mx,my){const w=screenToWorld(mx,my);let best=null,bestD=Infinity;Object.entries(groups).forEach(([key,g])=>{if(!g.nodes.length)return;const ly=g.cy-g.radius-8/zoom;const d=Math.sqrt((w.x-g.cx)**2+(w.y-ly)**2);if(d<60/zoom&&d<bestD){best=key;bestD=d}});return best}canvas.addEventListener('mousedown',e=>{dragging=true;dragStart={x:e.clientX,y:e.clientY};panStart={x:pan.x,y:pan.y}});canvas.addEventListener('mousemove',e=>{if(dragging){pan.x=panStart.x+(e.clientX-dragStart.x);pan.y=panStart.y+(e.clientY-dragStart.y);draw();return}const node=getNodeAt(e.clientX,e.clientY);if(node!==hoveredNode){hoveredNode=node;draw()}const tt=document.getElementById('tooltip');if(node){const cfg=tables[node.table];tt.style.display='block';tt.style.left=Math.min(e.clientX+16,window.innerWidth-400)+'px';tt.style.top=Math.min(e.clientY+16,window.innerHeight-300)+'px';tt.querySelector('.tt-type').textContent=cfg.label;tt.querySelector('.tt-type').style.color=cfg.color;tt.querySelector('.tt-name').textContent=node.label;let html='';Object.entries(node.record).forEach(([k,v])=>{if(k==='embedding'||k==='metadata'||k==='config'||k==='token')return;let val=v===null?'\\u2205':(typeof v==='string'?(v.length>50?v.slice(0,48)+'\\u2026':v):JSON.stringify(v));html+='<span class="fk">'+k+'</span>: <span class="fv">'+val+'</span><br>'});const connCount=edges.filter(ed=>ed.source===node||ed.target===node).length;if(connCount)html+='<br><span class="fk">connections</span>: <span class="fv">'+connCount+'</span>';tt.querySelector('.tt-fields').innerHTML=html}else tt.style.display='none'});canvas.addEventListener('mouseup',e=>{if(dragging&&Math.abs(e.clientX-dragStart.x)<3&&Math.abs(e.clientY-dragStart.y)<3){const grp=getGroupAt(e.clientX,e.clientY);if(grp)zoomToGroup(grp)}dragging=false});canvas.addEventListener('dblclick',e=>{e.preventDefault();zoomToAll()});canvas.addEventListener('wheel',e=>{e.preventDefault();const zf=e.deltaY<0?1.12:0.89;pan.x=e.clientX-(e.clientX-pan.x)*zf;pan.y=e.clientY-(e.clientY-pan.y)*zf;zoom*=zf;zoom=Math.max(0.08,Math.min(8,zoom));draw()},{passive:false});document.getElementById('search').addEventListener('input',e=>{searchTerm=e.target.value.toLowerCase();draw()});document.addEventListener('keydown',e=>{if(e.key==='Escape'){activeFilter=null;searchTerm='';document.getElementById('search').value='';document.querySelectorAll('.legend-item').forEach(l=>l.classList.remove('dimmed','active'));draw()}if((e.key==='f'||e.key==='F')&&document.activeElement.tagName!=='INPUT')zoomToAll()});function resize(){canvas.width=window.innerWidth*dpr;canvas.height=window.innerHeight*dpr;canvas.style.width=window.innerWidth+'px';canvas.style.height=window.innerHeight+'px';ctx.setTransform(dpr,0,0,dpr,0,0);draw()}window.addEventListener('resize',resize);resize();(async()=>{try{const base=window.location.href.replace(/\\/visualizer.*$/,'');const res=await fetch(base+'/graph-data');if(!res.ok)throw new Error('HTTP '+res.status);const data=await res.json();document.getElementById('loading').style.display='none';buildGraph(data)}catch(e){document.querySelector('#loading .msg').textContent='Error: '+e.message;document.getElementById('loading').querySelector('.spinner').style.display='none'}})()</script></body></html>`;

    // Escape quotes for XanoScript string
    const escaped = html.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    return `query "visualizer" verb=GET {
  description = "Serves the interactive graph visualizer HTML page"

  input {
  }

  stack {
    util.set_header {
      value = "Content-Type: text/html; charset=utf-8"
      duplicates = "replace"
    }

    var $html {
      value = "${escaped}"
    }
  }

  response = $html
  history = false
}`;
}

async function deploy(config, tables) {
    console.log('\n─── Step 3: Deploy Endpoint ───\n');

    const { baseUrl, token, workspaceId } = config;
    const wsPath = `/workspace/${workspaceId}`;

    // Check for existing Visualizer API group
    console.log('Checking for existing API group...');
    let apiGroupId;
    try {
        const groups = await xanoGet(baseUrl, token, `${wsPath}/apigroup`);
        const list = Array.isArray(groups) ? groups : (groups.items || []);
        const existing = list.find(g => g.name === 'Visualizer');
        if (existing) {
            apiGroupId = existing.id;
            console.log(`  ⚠ "Visualizer" API group already exists (id: ${apiGroupId})`);
        }
    } catch (e) {
        // Swallow — we'll create it
    }

    // Create API group if needed
    if (!apiGroupId) {
        console.log('Creating "Visualizer" API group...');
        try {
            const result = await xanoXs(baseUrl, token, `${wsPath}/apigroup`,
                `api_group "Visualizer" { swagger = {active: true} }`
            );
            apiGroupId = result.id;
            console.log(`  ✓ Created (id: ${apiGroupId})`);
        } catch (e) {
            throw new Error(`Failed to create API group: ${e.message}`);
        }
    }

    // Generate XanoScript for both endpoints
    const graphDataXs = generateGraphDataXanoScript(tables);
    const visualizerXs = generateVisualizerXanoScript();

    // Deploy graph-data endpoint
    console.log('Deploying graph-data endpoint...');
    await deployEndpoint(baseUrl, token, wsPath, apiGroupId, graphDataXs, 'graph-data');

    // Deploy visualizer HTML endpoint
    console.log('Deploying visualizer HTML endpoint...');
    await deployEndpoint(baseUrl, token, wsPath, apiGroupId, visualizerXs, 'visualizer');

    // Get the canonical to build the public URL
    console.log('\nResolving public URL...');
    const groupDetails = await xanoGet(baseUrl, token, `${wsPath}/apigroup/${apiGroupId}`);
    const canonical = groupDetails.canonical;
    if (!canonical) {
        console.log('  ⚠ Could not determine canonical ID from API group');
        console.log('  Check the Xano dashboard for the endpoint URL');
        return null;
    }

    return `${baseUrl}/api:${canonical}/visualizer`;
}

async function deployEndpoint(baseUrl, token, wsPath, apiGroupId, xs, name) {
    try {
        await xanoXs(baseUrl, token, `${wsPath}/apigroup/${apiGroupId}/api`, xs);
        console.log(`  ✓ ${name} deployed`);
    } catch (e) {
        if (e.message.includes('already exists')) {
            console.log(`  ⚠ ${name} already exists — updating...`);
            try {
                const apis = await xanoGet(baseUrl, token, `${wsPath}/apigroup/${apiGroupId}/api`);
                const list = Array.isArray(apis) ? apis : (apis.items || []);
                const existing = list.find(a => a.name && a.name.includes(name));
                if (existing) {
                    await sleep(RATE_LIMIT_MS);
                    const url = `${baseUrl}/api:meta${wsPath}/apigroup/${apiGroupId}/api/${existing.id}`;
                    const res = await fetch(url, {
                        method: 'PUT',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'text/x-xanoscript' },
                        body: xs
                    });
                    if (res.ok) console.log(`  ✓ ${name} updated`);
                    else console.log(`  ⚠ Update returned ${res.status}`);
                }
            } catch (e2) {
                console.log(`  ⚠ Could not auto-update ${name}: ${e2.message}`);
            }
        } else {
            console.log(`  ✗ Failed to deploy ${name}: ${e.message}`);
        }
    }
}

async function fallbackSave(xs, baseUrl, token, wsPath, apiGroupId) {
    const fs = await import('fs');
    const filePath = 'graph-data.xs';
    fs.writeFileSync(filePath, xs, 'utf-8');
    console.log(`\n  ✓ XanoScript saved to ${filePath}`);
    console.log('\n  To deploy manually:');
    console.log('    1. Open your Xano workspace');
    console.log('    2. Go to the "Visualizer" API group (or create one)');
    console.log('    3. Add a new GET endpoint');
    console.log('    4. Switch to the XanoScript editor');
    console.log(`    5. Paste the contents of ${filePath}`);
    console.log('    6. Save & publish');

    // Still try to resolve the canonical for the URL
    try {
        const groupDetails = await xanoGet(baseUrl, token, `${wsPath}/apigroup/${apiGroupId}`);
        if (groupDetails.canonical) {
            return `${baseUrl}/api:${groupDetails.canonical}/graph-data`;
        }
    } catch (e) { /* swallow */ }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
    printBanner();

    try {
        // Step 1: Connect
        const config = await selectWorkspace();

        // Step 2: Discover
        const tables = await discoverTables(config.baseUrl, config.token, config.workspaceId);

        // Step 3: Deploy
        const publicUrl = await deploy(config, tables);

        // Done!
        console.log('');
        console.log('╔═══════════════════════════════════════════════════════╗');
        console.log('║                                                       ║');
        console.log('║                  Setup Complete! ✓                    ║');
        console.log('║                                                       ║');
        console.log('╚═══════════════════════════════════════════════════════╝');
        console.log('');
        if (publicUrl) {
            console.log(`Visualizer URL: ${publicUrl}`);
            console.log('');
            console.log('Open that URL in your browser — it just works!');
        } else {
            console.log('Check the Xano dashboard for the visualizer endpoint URL.');
        }
        console.log('');

    } catch (e) {
        console.error(`\n✗ Error: ${e.message}`);
        process.exit(1);
    }
}

main();
