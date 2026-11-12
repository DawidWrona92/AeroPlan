
(()=>{'use strict';
const $=id=>document.getElementById(id), clamp=(x,a,b)=>Math.max(a,Math.min(b,x)), fmt=(n,d=1)=>Number.isFinite(n)?n.toFixed(d):'—';
const uid=()=>Math.random().toString(36).slice(2,10); // identyfikatory UI, nie wpływają na model
const canvas=$('field'),ctx=canvas.getContext('2d',{alpha:false});
const DEFAULTS={height:2.6,mixing:.025,initial:48,outside:24,ach:.1,deposition:.08,deltaP:4,windFlowEnabled:true,windDirection:0,windSpeed:2.5,gustPercent:15,gustPeriod:180,gridStep:.20,pmPenetration:.8,maxWindowAch:12,cadr:330,purifierDiameter:.42,jet:.8,orientation:0,maxMinutes:60,timeLimitEnabled:false};
let rooms=[],doors=[],windows=[],vents=[],purifier={x:3.1,y:2.1},grid=null,concentration=null,buffer=null,velocity=null,intake=null,elapsed=0,removed=0,clippedMass=0,playing=false,view='pm',viewTransform=null,dragging=false,benchmarkToken=0,rankingResults=null,lastRender=0, lastFrame=performance.now();
let userParameters={...DEFAULTS},outsideManual=false,lastGustUpdate=-Infinity,weatherDiagnostics=null;
let editorMode='purifier',editorGesture=null,editorHover=null,selectedRoomId=null,pendingDeleteId=null;
const SNAP=.5, MAX_SPAN=35, MAGNET_DISTANCE=.22, cm=n=>Math.round(n*100)/100;
// Indicative inter-room door undercut: 10 mm at 0.8 m ≈ 80 cm².
// Frame leakage is an additional *equivalent* opening area, not a measured value.
const DEFAULT_DOOR_GAP_MM=10, DEFAULT_DOOR_FRAME_CM2=4;
function doorGapMm(d){return clamp(Number.isFinite(Number(d.gapMm))&&d.gapMm!==null?Number(d.gapMm):DEFAULT_DOOR_GAP_MM,0,35);}
function doorFrameCm2(d){return clamp(Number.isFinite(Number(d.frameLeakCm2))&&d.frameLeakCm2!==null?Number(d.frameLeakCm2):DEFAULT_DOOR_FRAME_CM2,0,200);}
function doorLeakArea(d){
 if(isOpening(d)||d.open)return 0;
 const geo=passageGeometry(d);if(!geo)return 0;
 return (geo.to-geo.from)*doorGapMm(d)/1000+doorFrameCm2(d)/10000;
}
function doorFlowAtPa(d,deltaPa=2){const area=doorLeakArea(d);return .60*area*Math.sqrt(2*Math.max(0,deltaPa)/1.204)*3600;}

const snap=x=>Math.round(x/SNAP)*SNAP;
const useGrid=()=>$('snapToGrid').checked, useMagnet=()=>$('magnetWalls').checked;
const limitPoint=p=>({x:cm(clamp(p.x,0,MAX_SPAN)),y:cm(clamp(p.y,0,MAX_SPAN))});
function gridPoint(p){return limitPoint({x:useGrid()?snap(p.x):p.x,y:useGrid()?snap(p.y):p.y});}
// Przyciąganie do rzeczywistych krawędzi, także gdy mają np. 3,37 m i nie trafiają w podziałkę.
function magnetPoint(p){
 if(!useMagnet())return p;
 let x=p.x,y=p.y,dx=MAGNET_DISTANCE+1e-6,dy=MAGNET_DISTANCE+1e-6;
 for(const r of rooms){
  for(const xx of [r.x,r.x+r.w]){const d=Math.abs(xx-p.x);if(d<dx){x=xx;dx=d;}}
  for(const yy of [r.y,r.y+r.h]){const d=Math.abs(yy-p.y);if(d<dy){y=yy;dy=d;}}
 }
 return limitPoint({x,y});
}
function magnetMove(candidate,ignoreId){
 if(!useMagnet())return candidate;
 let x=candidate.x,y=candidate.y,dx=MAGNET_DISTANCE+1e-6,dy=MAGNET_DISTANCE+1e-6;
 for(const b of rooms){if(b.id===ignoreId)continue;
  if(candidate.y<b.y+b.h-.01&&candidate.y+candidate.h>b.y+.01){
   for(const xx of [b.x,b.x+b.w,b.x-candidate.w,b.x+b.w-candidate.w]){
    const dist=Math.abs(xx-candidate.x);
    if(dist<dx){x=xx;dx=dist;}
   }
  }
  if(candidate.x<b.x+b.w-.01&&candidate.x+candidate.w>b.x+.01){
   for(const yy of [b.y,b.y+b.h,b.y-candidate.h,b.y+b.h-candidate.h]){
    const dist=Math.abs(yy-candidate.y);
    if(dist<dy){y=yy;dy=dist;}
   }
  }
 }
 const both={...candidate,x:cm(x),y:cm(y)};
 if(candidateValid(both,ignoreId))return both;
 const justX={...candidate,x:cm(x)};if(candidateValid(justX,ignoreId))return justX;
 const justY={...candidate,y:cm(y)};if(candidateValid(justY,ignoreId))return justY;
 return candidate;
}
const TOOL_HELP={item:'Przesuń element: przeciągnij drzwi lub stały otwór wzdłuż wspólnej ściany, okno wzdłuż jego ściany albo kratkę wentylacyjną wewnątrz pokoju. Zmiana zachowa czas symulacji.',supply:'Nawiew: kliknij wewnątrz pokoju, aby umieścić kratkę. Przepływ i położenie zmienisz w panelu Wentylacja.',exhaust:'Wywiew: kliknij wewnątrz pokoju, aby umieścić kratkę. Przepływ i położenie zmienisz w panelu Wentylacja.',room:'Rysowanie: przeciągnij od jednego narożnika do drugiego. Położenie z dokładnością 1 cm; opcjonalnie możesz włączyć siatkę 0,5 m.',move:'Przesuwanie: przeciągnij pokój w dowolne miejsce, także o centymetry. Zaznaczony pokój możesz usunąć przyciskiem „Usuń pokój”.',door:'Drzwi: kliknij wspólną ścianę dwóch sąsiadujących pokoi. Podczas symulacji kliknięcie drzwi zmienia otwarte/zamknięte.',opening:'Stały otwór: kliknij wspólną ścianę. Nie ma skrzydła i zawsze pozostaje otwarty.',window:'Okno: wskaż kursorem konkretną ścianę zewnętrzną. Zielony podgląd pokaże dokładne miejsce wstawienia; na ścianie wspólnej okno nie powstanie.',delete:'Usuwanie: najedź na okno, drzwi lub stały otwór — podświetlą się na czerwono. Kliknij, aby usunąć element. Kliknięcie pokoju wymaga potwierdzenia.',purifier:'Oczyszczacz: kliknij w pokój lub przeciągnij urządzenie. Cały jego okrąg zostaje wewnątrz jednego pokoju. Ustaw średnicę w panelu Oczyszczacz.'};
function setTool(mode){editorMode=mode;editorGesture=null;editorHover=null;canvas.style.cursor='crosshair';document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===mode));$('editorHelp').textContent=TOOL_HELP[mode]||'';render(performance.now());}
function selectRoom(id){selectedRoomId=rooms.some(r=>r.id===id)?id:null;updateRoomSelection();render(performance.now());}
function updateRoomSelection(){
 for(const item of document.querySelectorAll('#rooms .room'))item.classList.toggle('selected-room',item.dataset.roomId===selectedRoomId);
 const current=rooms.find(r=>r.id===selectedRoomId);
 $('selectionInfo').textContent=current?'Zaznaczono: '+current.name:'Nie zaznaczono pokoju';
}
function requestDeleteRoom(id){
 const r=rooms.find(r=>r.id===id);if(!r)return;
 pendingDeleteId=id;selectRoom(id);$('roomDeleteName').textContent=r.name;
 $('roomDeleteDialog').hidden=false;$('cancelRoomDelete').focus();
}
function closeDeleteDialog(){$('roomDeleteDialog').hidden=true;pendingDeleteId=null;}
function deleteSelectedRoom(){
 if(!pendingDeleteId)return;const id=pendingDeleteId,r=rooms.find(v=>v.id===id);closeDeleteDialog();if(!r)return;
 rooms=rooms.filter(v=>v.id!==id);doors=doors.filter(d=>d.a!==id&&d.b!==id);windows=windows.filter(w=>w.roomId!==id);vents=vents.filter(v=>v.roomId!==id);
 selectedRoomId=null;editorHover=null;renderEditors();rebuild();
 setStatus('Usunięto pokój „'+r.name+'”, jego przejścia, okna i kratki wentylacyjne.');
 if(!rooms.length)setTool('room');
}

function hitRoom(x,y){for(let i=rooms.length-1;i>=0;i--){const r=rooms[i];if(x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h)return r;}return null;}
function rectanglesOverlap(a,b){const eps=1e-7;return a.x<b.x+b.w-eps&&a.x+a.w>b.x+eps&&a.y<b.y+b.h-eps&&a.y+a.h>b.y+eps;}
function roomOverlap(a,ignoreId){return rooms.some(b=>b.id!==ignoreId&&rectanglesOverlap(a,b));}
function validateRooms(list){
 const ids=new Set();
 for(const r of list){
  if(ids.has(r.id))throw Error('Powtarzający się identyfikator pokoju.');ids.add(r.id);
  if(!Number.isFinite(r.x)||!Number.isFinite(r.y)||!Number.isFinite(r.w)||!Number.isFinite(r.h)||r.x<0||r.y<0||r.w<.5||r.h<.5||r.x+r.w>MAX_SPAN+1e-8||r.y+r.h>MAX_SPAN+1e-8)throw Error('Niepoprawna geometria pokoju „'+r.name+'”.');
 }
 for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++)if(rectanglesOverlap(list[i],list[j]))throw Error('Pokoje „'+list[i].name+'” i „'+list[j].name+'” nakładają się na siebie.');
}
function candidateValid(r,ignoreId){return r.x>=0&&r.y>=0&&r.x+r.w<=MAX_SPAN&&r.y+r.h<=MAX_SPAN&&r.w>=.5&&r.h>=.5&&!roomOverlap(r,ignoreId);}
function rectDrag(a,b){return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(b.x-a.x),h:Math.abs(b.y-a.y)};}
function nearestSharedEdge(p){let best=null,dist=Infinity;for(let i=0;i<rooms.length;i++)for(let j=i+1;j<rooms.length;j++){
 const a=rooms[i],b=rooms[j],e=shared(a,b);if(!e)continue;
 const along=e.axis==='x'?p.y:p.x,perp=e.axis==='x'?p.x:p.y;
 const d=Math.hypot(perp-e.at,Math.max(e.from-along,0,along-e.to));
 if(d<dist){dist=d;best={a,b,e,along};}
 }return dist<=.45?best:null;}
function passageOverlap(d,pos=d.pos,roomList=rooms,doorList=doors){const a=roomList.find(r=>r.id===d.a),b=roomList.find(r=>r.id===d.b),edge=a&&b?shared(a,b):null;if(!edge)return true;
 const span=edge.to-edge.from,w=Math.min(d.width,span),center=edge.from+clamp(span*pos,w/2,span-w/2);
 for(const other of doorList){if(other.id===d.id)continue;if(!((other.a===d.a&&other.b===d.b)||(other.a===d.b&&other.b===d.a)))continue;
  const ow=Math.min(other.width,span),oc=edge.from+clamp(span*other.pos,ow/2,span-ow/2);
  if(Math.abs(center-oc)<(w+ow)/2-.02)return true;
 }
 return false;
}
function validateAttachedPassages(roomList=rooms,doorList=doors){
 for(const d of doorList){
  const a=roomList.find(r=>r.id===d.a),b=roomList.find(r=>r.id===d.b);
  const edge=a&&b?shared(a,b):null;
  if(!edge||d.width>edge.to-edge.from+.01)
   throw Error('Zmiana rozłączyłaby istniejące drzwi albo skróciła wspólną ścianę poniżej ich szerokości. Najpierw usuń lub przesuń przejście.');
 }
}
function createDoorAt(p,kind='door'){const hit=nearestSharedEdge(p);if(!hit){setStatus('Kliknij dokładnie we wspólną ścianę dwóch sąsiadujących pomieszczeń (do 45 cm od niej).',true);return;}
 const {a,b,e,along}=hit,span=e.to-e.from;
 if(span<.3){setStatus('Wspólna ściana jest zbyt krótka na przejście o szerokości 30 cm.',true);return;}
 const width=Math.min(1,span);
 const pos=clamp((along-e.from)/span,width/(2*span),1-width/(2*span));
 const proposed={id:uid(),a:a.id,b:b.id,width,pos,open:true,kind,gapMm:DEFAULT_DOOR_GAP_MM,frameLeakCm2:DEFAULT_DOOR_FRAME_CM2};if(passageOverlap(proposed)){setStatus('W tym miejscu jest już przejście. Przesuń istniejące lub wskaż inny fragment ściany.',true);return;}doors.push(proposed);renderDoors();reconfigureConnections();setStatus((kind==='opening'?'Dodano stały otwór':'Dodano drzwi')+' między „'+a.name+'” i „'+b.name+'”.');}

const isOpening=d=>d.kind==='opening';
function ventPosition(v){const r=rooms.find(r=>r.id===v.roomId);return r?{x:r.x+v.x,y:r.y+v.y,room:r}:null;}
function makeVent(r,type,rx,ry,rate=30){return{id:uid(),roomId:r.id,type,rate,x:cm(clamp(rx,.05,r.w-.05)),y:cm(clamp(ry,.05,r.h-.05))};}
function migrateLegacyVents(){
 const known=new Set(rooms.map(r=>r.id));vents=vents.filter(v=>known.has(v.roomId));
 for(const r of rooms)for(const type of ['supply','exhaust']){
  const key=type==='supply'?'supplyM3h':'exhaustM3h',value=Number(r[key])||0;
  if(value>0&&!vents.some(v=>v.roomId===r.id&&v.type===type)){const rx=Number(r[type+'X']),ry=Number(r[type+'Y']);vents.push(makeVent(r,type,Number.isFinite(rx)?rx:r.w*.5,Number.isFinite(ry)?ry:r.h*.5,value));}
  r[key]=0;
 }
}
function addVentAt(p,type){if(vents.length>=80){setStatus('Maksymalnie 80 kratek wentylacyjnych na jeden plan.',true);return;}const r=hitRoom(p.x,p.y);if(!r){setStatus('Kliknij wewnątrz wybranego pomieszczenia, aby dodać nawiew lub wywiew.',true);return;}
 const v=makeVent(r,type,p.x-r.x,p.y-r.y);vents.push(v);renderVents();reconfigureConnections();
 setStatus('Dodano '+(type==='supply'?'nawiew':'wywiew')+' w „'+r.name+'” · przykładowo 30 m³/h. Zmień wydajność w panelu Wentylacja.');}
function hitVent(p){if(!viewTransform)return null;let best=null,dist=Infinity;
 for(const v of vents){const xy=ventPosition(v);if(!xy)continue;const d=Math.hypot(p.x-xy.x,p.y-xy.y)*viewTransform.scale;if(d<dist&&d<=17){dist=d;best=v;}}
 return best;
}
function renderVents(){const host=$('vents');if(!host)return;host.innerHTML='';
 if(!vents.length){host.innerHTML='<p class="hint">Brak nawiewników i wywiewników. Dodaj kratkę na planie. Wyższe PM₂.₅ w kuchni wynika z emisji, nie z domyślnego przepływu wentylacji.</p>';return;}
 for(const v of vents){const el=document.createElement('div');el.className='vent-item';el.dataset.ventId=v.id;
  const r=rooms.find(r=>r.id===v.roomId);if(!r)continue;
  el.innerHTML=`<div class="window-title"><strong>${v.type==='supply'?'↓ Nawiew':'↑ Wywiew'} · ${escapeHtml(r.name)}</strong><button type="button" data-remove class="danger smallbtn" title="Usuń kratkę wentylacyjną">×</button></div><div class="window-fields">
   <div class="field"><label>Typ</label><select data-v="type"><option value="supply">Nawiew (z zewnątrz)</option><option value="exhaust">Wywiew (na zewnątrz)</option></select></div>
   <div class="field"><label>Pomieszczenie</label><select data-v="roomId">${rooms.map(q=>`<option value="${escapeHtml(q.id)}">${escapeHtml(q.name)}</option>`).join('')}</select></div>
   <div class="field"><label>Przepływ [m³/h]</label><input data-v="rate" type="number" min="0" max="600" step="1"></div>
   <div class="field"><label>Pozycja X [m od lewej]</label><input data-v="x" type="number" step="0.01" min="0.05"></div>
   <div class="field"><label>Pozycja Y [m od góry]</label><input data-v="y" type="number" step="0.01" min="0.05"></div>
   </div><div class="window-flow">Przepływ 0 m³/h = element nieaktywny. Rzeczywisty kierunek wymiany jest ograniczony bilansem ciśnienia.</div>`;
  host.appendChild(el);
  for(const field of el.querySelectorAll('[data-v]')){const key=field.dataset.v;field.value=v[key];field.addEventListener('change',()=>{
    if(key==='roomId'){const dest=rooms.find(q=>q.id===field.value);if(!dest)return;v.roomId=dest.id;v.x=cm(clamp(v.x,.05,Math.max(.05,dest.w-.05)));v.y=cm(clamp(v.y,.05,Math.max(.05,dest.h-.05)));}
    else if(key==='type')v.type=field.value==='exhaust'?'exhaust':'supply';
    else if(key==='rate')v.rate=num(field.value,v.rate,0,600);
    else {const rr=rooms.find(q=>q.id===v.roomId);v[key]=cm(num(field.value,v[key],.05,Math.max(.05,(key==='x'?rr.w:rr.h)-.05)));}
    renderVents();reconfigureConnections();setStatus('Zmieniono kratkę wentylacyjną. Zegar i aktualne PM₂.₅ zachowane.');
  });}
  el.querySelector('[data-remove]').addEventListener('click',()=>{vents=vents.filter(a=>a.id!==v.id);renderVents();reconfigureConnections();});
 }
}
function drawEmissions(X,Y,scale){for(const r of rooms){if(!(r.emission>0)||r.w*scale<86||r.h*scale<75)continue;
 const x=X(r.x+r.w)-7,y=Y(r.y+r.h)-9;
 ctx.save();ctx.font='bold 11px system-ui';ctx.textAlign='right';ctx.textBaseline='bottom';const label='PM +'+fmt(r.emission,0)+' µg/h',tw=ctx.measureText(label).width;
 ctx.fillStyle='rgba(65,24,29,.88)';ctx.fillRect(x-tw-10,y-14,tw+14,17);ctx.fillStyle='#ffbbad';ctx.fillText(label,x-5,y);ctx.restore();
}}
function drawVents(X,Y,scale){for(const v of vents){const q=ventPosition(v);if(!q)continue;const xx=X(q.x),yy=Y(q.y),active=v.rate>0,exhaust=v.type==='exhaust';
 const selected=editorMode==='delete'&&editorHover?.kind==='vent'&&editorHover.id===v.id;
 ctx.save();ctx.fillStyle=selected?'#af324e':active?(exhaust?'#dd6cba':'#61dced'):'#627b91';ctx.strokeStyle=selected?'#ffafbe':'#082035';ctx.lineWidth=2.5;ctx.beginPath();ctx.roundRect(xx-10,yy-10,20,20,4);ctx.fill();ctx.stroke();
 ctx.fillStyle='#0b2633';ctx.font='bold 16px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(exhaust?'↑':'↓',xx,yy+.5);
 if(active){ctx.font='bold 10px system-ui';ctx.fillStyle='#ffffff';ctx.strokeStyle='#0b1723';ctx.lineWidth=3;const text=fmt(v.rate,0);ctx.strokeText(text,xx,yy+21);ctx.fillText(text,xx,yy+21);}
 ctx.restore();}}

const num=(v,fallback,min,max)=>clamp(Number.isFinite(+v)?+v:fallback,min,max);
const room=(name,x,y,w,h,emission)=>({id:uid(),name,x,y,w,h,emission,extraAch:0,supplyM3h:0,exhaustM3h:0,supplyX:Math.min(.3,w/3),supplyY:Math.min(.3,h/3),exhaustX:Math.max(.3,w-.3),exhaustY:Math.max(.3,h-.3)});
function preset(){selectedRoomId=null;const a=room('Salon',0,0,4.5,4,250),b=room('Sypialnia',0,4,4.5,2.4,80),c=room('Korytarz',4.5,0,1.8,6.4,0),d=room('Kuchnia',6.3,0,3,2.6,1350),e=room('Pokój dziecka',6.3,2.6,3,2.4,100);rooms=[a,b,c,d,e];doors=[{id:uid(),a:a.id,b:c.id,width:2.5,pos:.52,open:true,gapMm:DEFAULT_DOOR_GAP_MM,frameLeakCm2:DEFAULT_DOOR_FRAME_CM2},{id:uid(),a:b.id,b:c.id,width:1.5,pos:.5,open:true,gapMm:DEFAULT_DOOR_GAP_MM,frameLeakCm2:DEFAULT_DOOR_FRAME_CM2},{id:uid(),a:d.id,b:c.id,width:1.7,pos:.5,open:true,gapMm:DEFAULT_DOOR_GAP_MM,frameLeakCm2:DEFAULT_DOOR_FRAME_CM2},{id:uid(),a:e.id,b:c.id,width:1.6,pos:.52,open:true,gapMm:DEFAULT_DOOR_GAP_MM,frameLeakCm2:DEFAULT_DOOR_FRAME_CM2}];windows=[makeWindow(a,'left',.48,1.4),makeWindow(b,'left',.5,1.2),makeWindow(d,'top',.5,1.1),makeWindow(e,'right',.5,1.2)];vents=[makeVent(d,'exhaust',2.58,.45,30)];purifier={x:2.3,y:2};const measuredOutside=outsideManual?userParameters.outside:null;userParameters={...DEFAULTS};if(measuredOutside!==null)userParameters.outside=measuredOutside;syncFields();renderEditors();rebuild();}
function emptyPlan(){if(rooms.length&& !confirm('Wyczyścić obecny plan? Przed zmianą możesz zapisać go do JSON.'))return;selectedRoomId=null;rooms=[];doors=[];windows=[];vents=[];purifier={x:2.5,y:2};renderEditors();setTool('room');rebuild();} 
function getInputs(){const o={};for(const k of Object.keys(DEFAULTS)){
 const e=$(k);
 if(k==='timeLimitEnabled'||k==='windFlowEnabled'){o[k]=Boolean(e?.checked);continue;}
 o[k]=num(e?.value,DEFAULTS[k],...INPUT_LIMITS[k]);
 }userParameters=o;
}
function simulationTimeLimit(p=userParameters){return p.timeLimitEnabled?p.maxMinutes*60:Infinity;}
function syncTimeLimitControl(){
 $('timeLimitEnabled').checked=Boolean(userParameters.timeLimitEnabled);
 $('maxMinutes').disabled=!userParameters.timeLimitEnabled;
 const badge=$('timeLimitBadge');
 badge.textContent=userParameters.timeLimitEnabled?'Limit: '+fmt(userParameters.maxMinutes,0)+' min':'Bez limitu';
 badge.title=userParameters.timeLimitEnabled?'Automatyczne zatrzymanie po osiągnięciu zadanego czasu symulacji':'Symulacja trwa do ręcznego zatrzymania';
}
function updateOutsideSourceLabel(){
 const target=$('outsideSourceLabel');if(!target)return;
 target.textContent=outsideManual?'Ustawiono ręcznie: '+fmt(userParameters.outside,1)+' µg/m³. Bez automatycznego pobierania danych.':fmt(userParameters.outside,1)+' µg/m³: wartość przykładowa — wpisz rzeczywisty pomiar.';
 target.classList.toggle('outside-verified',outsideManual);
}
function syncFields(){for(const [k,v] of Object.entries(userParameters))if($(k)&&k!=='timeLimitEnabled'&&k!=='windFlowEnabled')$(k).value=v;$('windFlowEnabled').checked=Boolean(userParameters.windFlowEnabled);syncTimeLimitControl();if($('outsideQuick'))$('outsideQuick').value=userParameters.outside;updateOutsideSourceLabel();}
function changeOutdoorPM(v){
 if(String(v).trim()===''||!Number.isFinite(Number(v))){
  $('outside').value=userParameters.outside;$('outsideQuick').value=userParameters.outside;
  setStatus('Podaj prawidłowy odczyt PM₂.₅ na zewnątrz w µg/m³ (0–1000).',true);return;
 }
 const value=num(v,userParameters.outside,0,1000);
 userParameters.outside=value;$('outside').value=value;$('outsideQuick').value=value;outsideManual=true;updateOutsideSourceLabel();
 // Zewnętrzne PM jest warunkiem brzegowym; nie usuwamy dotychczas obliczonego stężenia.
 benchmarkToken++;rankingResults=null;$('ranking').innerHTML='';$('compareProgress').style.width='0';$('compareStatus').textContent='Zmieniono PM na zewnątrz. Uruchom porównanie ponownie.';
 updateMetrics();render(performance.now());setStatus('PM₂.₅ za oknem: '+fmt(value,1)+' µg/m³. Symulacja zachowała bieżący czas i stężenia.');
}
function shared(a,b){const eps=.015;if(Math.abs((a.x+a.w)-b.x)<eps||Math.abs((b.x+b.w)-a.x)<eps){const x=Math.abs((a.x+a.w)-b.x)<eps?b.x:a.x,from=Math.max(a.y,b.y),to=Math.min(a.y+a.h,b.y+b.h);if(to-from>.19)return{axis:'x',at:x,from,to};}if(Math.abs((a.y+a.h)-b.y)<eps||Math.abs((b.y+b.h)-a.y)<eps){const y=Math.abs((a.y+a.h)-b.y)<eps?b.y:a.y,from=Math.max(a.x,b.x),to=Math.min(a.x+a.w,b.x+b.w);if(to-from>.19)return{axis:'y',at:y,from,to};}return null;}
function updateTargetOptions(){const target=$('targetRoom'),old=target.value;target.innerHTML='<option value="all">Średnie stężenie w całym mieszkaniu</option>';for(const r of rooms){const option=document.createElement('option');option.value=r.id;option.textContent='Stężenie w: '+r.name;target.appendChild(option);}target.value=[...target.options].some(o=>o.value===old)?old:'all';}
function renderEditors(){migrateLegacyVents();updateTargetOptions();const host=$('rooms');host.innerHTML='';rooms.forEach((r)=>{const el=document.createElement('div');el.className='room';el.dataset.roomId=r.id;el.innerHTML=`<div class="room-head"><input data-key="name" aria-label="Nazwa pomieszczenia"><button data-select type="button" title="Zaznacz na planie">Zaznacz</button><button data-remove type="button" class="danger" title="Usuń pokój" aria-label="Usuń pokój ${escapeHtml(r.name)}">×</button></div><div class="mini-fields">${[['x','X [m]'],['y','Y [m]'],['w','Szer. [m]'],['h','Dł. [m]'],['emission','Emisja pyłu [µg/h]'],['extraAch','Nieszczel. +[1/h]']].map(([k,l])=>`<div><label>${l}</label><input data-key="${k}" type="number" step="${k==='emission'?'50':k==='extraAch'?'0.05':'0.01'}" min="0"></div>`).join('')}</div>`;host.appendChild(el);for(const input of el.querySelectorAll('[data-key]')){const k=input.dataset.key;input.value=r[k];input.addEventListener('change',()=>{
  const previous=r[k];const value=k==='name'?input.value:String(input.value).trim()===''?r[k]:num(input.value,r[k],k==='w'||k==='h'?.5:0,k==='emission'?100000:k==='extraAch'?5:k==='supplyM3h'||k==='exhaustM3h'?600:k==='supplyX'||k==='exhaustX'?r.w:k==='supplyY'||k==='exhaustY'?r.h:40);
  r[k]=value;
  try{validateRooms(rooms);if(['x','y','w','h'].includes(k)){validateAttachedPassages();}if(['x','y','w','h'].includes(k))for(const w of windows)if(w.roomId===r.id&&!validWindow(w))throw Error('Zmiana wymiarów uniemożliwiłaby prawidłowe umieszczenie istniejącego okna.');}
  catch(error){r[k]=previous;renderEditors();setStatus(error.message+' Zmiana została odrzucona.',true);return;}
  if(['w','h'].includes(k)){for(const v of vents)if(v.roomId===r.id){v.x=cm(clamp(v.x,.05,Math.max(.05,r.w-.05)));v.y=cm(clamp(v.y,.05,Math.max(.05,r.h-.05)));}}invalidate('Zmieniono parametry pokoju.');renderEditors();renderDoors();rebuild();
 });}el.querySelector('[data-select]').addEventListener('click',()=>{selectRoom(r.id);setTool('move');setStatus('Zaznaczono pokój „'+r.name+'”. Przeciągnij go albo wybierz „Usuń pokój”.');});el.querySelector('[data-remove]').addEventListener('click',()=>requestDeleteRoom(r.id));});renderDoors();renderWindows();renderVents();updateRoomSelection();}

// Geometry okien jest przypisana do konkretnej ściany zewnętrznej pokoju.
function makeWindow(r,side,pos,width){return{id:uid(),roomId:r.id,side,pos,width,height:1.35,state:'closed',q100:3,gapMm:5,openPercent:10};}
const SIDE_LABEL={left:'lewa',right:'prawa',top:'górna',bottom:'dolna'};
function windowGeometry(w,roomList=rooms){
 const r=roomList.find(r=>r.id===w.roomId);if(!r||!SIDE_LABEL[w.side])return null;
 const vertical=w.side==='left'||w.side==='right',length=vertical?r.h:r.w,start=vertical?r.y:r.x;
 // Keep the requested width: move the center inward rather than truncating a window at a corner.
 const width=Math.min(w.width,length),half=width/2;
 const center=start+clamp(length*clamp(w.pos,0,1),half,length-half);
 const at=w.side==='left'?r.x:w.side==='right'?r.x+r.w:w.side==='top'?r.y:r.y+r.h;
 return {r,side:w.side,vertical,at,from:center-half,to:center+half,center};
}
// Dokładna geometria ścian zewnętrznych: odejmujemy od każdego boku pokoju
// odcinki zasłonięte przez sąsiednie pomieszczenia. Dzięki temu nie zgadujemy
// miejsca okna przez szukanie innej ściany w całym mieszkaniu.
function exteriorSections(r,side,roomList=rooms){
 const vertical=side==='left'||side==='right',from=vertical?r.y:r.x,to=vertical?r.y+r.h:r.x+r.w;
 const at=side==='left'?r.x:side==='right'?r.x+r.w:side==='top'?r.y:r.y+r.h,eps=.015;
 const blocked=[];
 for(const b of roomList){if(b.id===r.id)continue;
  const adjoining=side==='left'?Math.abs(b.x+b.w-at)<eps:side==='right'?Math.abs(b.x-at)<eps:side==='top'?Math.abs(b.y+b.h-at)<eps:Math.abs(b.y-at)<eps;
  if(!adjoining)continue;
  const lo=Math.max(from,vertical?b.y:b.x),hi=Math.min(to,vertical?b.y+b.h:b.x+b.w);
  if(hi-lo>.001)blocked.push([lo,hi]);
 }
 blocked.sort((a,b)=>a[0]-b[0]);
 const sections=[];let start=from;
 for(const [lo,hi] of blocked){if(lo>start+.001)sections.push({r,side,vertical,at,from:start,to:lo});start=Math.max(start,hi);}
 if(start<to-.001)sections.push({r,side,vertical,at,from:start,to});
 return sections;
}
function isExternalWallPoint(r,side,along){return exteriorSections(r,side).some(s=>along>=s.from-.001&&along<=s.to+.001);}
function validWindow(w,roomList=rooms,windowList=windows){
 const g=windowGeometry(w,roomList);
 if(!g||!Number.isFinite(w.width)||w.width<.3||w.width>5||w.width>g.to-g.from+.001||!Number.isFinite(w.height)||w.height<.3||w.height>3)return false;
 if(!exteriorSections(g.r,w.side,roomList).some(s=>g.from>=s.from-.001&&g.to<=s.to+.001))return false;
 // Two windows may not claim the same physical wall surface.
 for(const other of windowList){
  if(other===w||other.id===w.id||other.roomId!==w.roomId||other.side!==w.side)continue;
  const b=windowGeometry(other,roomList);
  if(b&&g.from<b.to-.001&&g.to>b.from+.001)return false;
 }
 return true;
}
function wallHit(p){
 if(!viewTransform)return null;
 let best=null,min=Infinity;
 // Najpierw trafiamy dokładnie w kliknięty odcinek ściany, także wewnętrzny.
 // Nigdy nie wybieramy innej *dostępnej* ściany, gdy wskazana jest zajęta.
 for(const r of rooms)for(const side of ['left','right','top','bottom']){
  const vertical=side==='left'||side==='right',at=side==='left'?r.x:side==='right'?r.x+r.w:side==='top'?r.y:r.y+r.h;
  const from=vertical?r.y:r.x,to=vertical?r.y+r.h:r.x+r.w;
  const along=vertical?p.y:p.x,perp=vertical?p.x:p.y;
  const distancePx=Math.hypot(perp-at,Math.max(from-along,0,along-to))*viewTransform.scale;
  if(distancePx<min){min=distancePx;best={r,side,along:clamp(along,from,to),vertical,at,from,to,distancePx};}
 }
 // 14 pikseli, niezależnie od stopnia powiększenia rysunku.
 return min<=14?best:null;
}
function windowProposal(p){
 const hit=wallHit(p);
 if(!hit)return {ok:false,reason:'Kliknij bezpośrednio na ścianę (do 14 px od jej linii).',hit:null};
 const sections=exteriorSections(hit.r,hit.side),section=sections.find(s=>hit.along>=s.from-.002&&hit.along<=s.to+.002);
 if(!section)return {ok:false,reason:'To ściana wspólna dwóch pokoi. Okna można wstawiać wyłącznie na wolnej ścianie zewnętrznej.',hit};
 const span=section.to-section.from;
 const width=Math.min(1.2,cm(span-.04));
 if(width<.3)return {ok:false,reason:'Ten odcinek ściany zewnętrznej jest za krótki na okno (minimum 30 cm).',hit};
 const center=clamp(hit.along,section.from+width/2+.005,section.to-width/2-.005);
 const length=hit.vertical?hit.r.h:hit.r.w,start=hit.vertical?hit.r.y:hit.r.x;
 const candidate=makeWindow(hit.r,hit.side,(center-start)/length,width);
 if(!validWindow(candidate))return {ok:false,reason:'Na wskazanym odcinku okno nie mieści się lub nachodzi na istniejące okno.',hit};
 return {ok:true,w:candidate,hit,section};
}
function createWindowAt(p){
 const proposal=windowProposal(p);
 if(!proposal.ok){setStatus(proposal.reason,true);return;}
 const {w,hit}=proposal;
 windows.push(w);editorHover=null;renderWindows();rebuild();
 setStatus('Dodano okno: „'+hit.r.name+'”, ściana '+SIDE_LABEL[hit.side]+', dokładnie w zaznaczonym miejscu.');
}
function windowQ(w,p){if(!validWindow(w))return 0;const g=windowGeometry(w),actualWidth=g.to-g.from,area=Math.max(.05,actualWidth*w.height),dp=Math.max(0,p.deltaP);
 if(w.state==='closed')return Math.max(0,w.q100)*area*Math.pow(dp/100,.67);
 const effectiveArea=w.state==='tilt'?actualWidth*Math.max(0,w.gapMm)/1000:actualWidth*w.height*Math.max(0,w.openPercent)/100;
 const orifice=.60*effectiveArea*Math.sqrt(2*dp/1.204)*3600;
 const roomVolume=g.r.w*g.r.h*p.height;
 return Math.min(orifice,Math.max(0,p.maxWindowAch)*roomVolume);
}
function mapWindowSources(g,p){const sources=[];for(const w of windows){if(!validWindow(w))continue;const geo=windowGeometry(w),ri=rooms.findIndex(r=>r.id===w.roomId),cells=[];
 for(let k=0;k<g.n;k++){if(g.ids[k]!==ri)continue;const i=k%g.nx,j=(k/g.nx)|0,x=(i+.5)*g.step,y=(j+.5)*g.step,perp=geo.vertical?x:y,along=geo.vertical?y:x;
 if(Math.abs(perp-geo.at)<g.step*.88&&along>=geo.from-g.step*.3&&along<=geo.to+g.step*.3)cells.push(k);
 }
 if(!cells.length){let best=-1,d=Infinity;for(let k=0;k<g.n;k++){if(g.ids[k]!==ri)continue;const i=k%g.nx,j=(k/g.nx)|0,x=(i+.5)*g.step,y=(j+.5)*g.step,delta=Math.hypot((geo.vertical?x:y)-geo.at,(geo.vertical?y:x)-geo.center);if(delta<d){d=delta;best=k;}}if(best>=0)cells.push(best);}
 const q=windowQ(w,p);if(cells.length)sources.push({id:w.id,side:w.side,cells,q,penetration:w.state==='closed'?p.pmPenetration:1});
 }return sources;
}
// Room-pressure network: conservation of mass across windows, doors and individual ventilation grilles.
// Boundary window flows and grille supply/exhaust are mapped to nearby grid cells.
function configureWindowAirflow(g,p,simTime=0){
 const gust=Math.max(0,p.windSpeed||0)*(1+(p.gustPercent||0)/100*Math.sin(2*Math.PI*simTime/Math.max(30,p.gustPeriod||180)));
 const roomIndex=new Map(rooms.map((r,i)=>[r.id,i]));
 const pressureWindows=(g.windowSources||[]).map(w=>{const original=windows.find(o=>o.id===w.id),geo=original&&windowGeometry(original);if(!geo)return null;
  const area=(geo.to-geo.from)*original.height,openArea=original.state==='closed'?0:original.state==='tilt'?(geo.to-geo.from)*original.gapMm/1000:area*original.openPercent/100;
  return {id:w.id,roomIndex:roomIndex.get(original.roomId),state:original.state,area,openArea,q100:original.q100,side:original.side,
   maxQ:p.maxWindowAch*geo.r.w*geo.r.h*p.height,penetration:w.penetration};}).filter(Boolean);
 // Closed doors remain connected via their undercut and frame gaps.
 // A zero-area custom door is allowed to be airtight; the normal default is not.
 const doorLinks=doors.map(d=>{const geo=passageGeometry(d);if(!geo)return null;
  const area=(isOpening(d)||d.open)?(geo.to-geo.from)*Math.min(p.height,2.05):doorLeakArea(d);
  return area>0?{id:d.id,a:roomIndex.get(d.a),b:roomIndex.get(d.b),area}:null;
 }).filter(Boolean);
 const ventLinks=vents.filter(v=>v.rate>0&&roomIndex.has(v.roomId)).map(v=>({id:v.id,roomIndex:roomIndex.get(v.roomId),rate:v.rate,type:v.type}));
 const result=window.AeroPressure.solve({rooms,windows:pressureWindows,doors:doorLinks,vents:ventLinks,
  windSpeed:p.windFlowEnabled?gust:0,windDirection:p.windDirection,backgroundAch:p.ach,height:p.height,pmPenetration:p.pmPenetration});
 // If the requested fan flow has no compensating path, the incompressible
 // solver cannot support it. Disable directional flows rather than inventing air.
 if(!result.converged){result.unresolvedRequestedFlow=true;
  for(const key of Object.keys(result.windowFlows))result.windowFlows[key]=0;
  for(const key of Object.keys(result.leakFlows))result.leakFlows[key]=0;
  for(const key of Object.keys(result.ventFlows))result.ventFlows[key]=0;
  for(const key of Object.keys(result.doorFlows))result.doorFlows[key]=0;
  result.totalSupply=0;result.totalExhaust=0;
 }
 const net=new Float64Array(g.n),airSources=[];
 function allocate(source){
  if(!source.cells?.length)return;
  airSources.push(source);
  for(const k of source.cells)net[k]+=(source.netQ||0)/3600/source.cells.length;
 }
 for(const w of g.windowSources){
  w.netQ=result.windowFlows[w.id]||0;
  // Wind-induced through-flow uses signed flux; unresolved single-sided mixing remains explicitly approximate.
  const original=windows.find(a=>a.id===w.id);
  // Dwustronna wymiana przy zerowym przepływie netto; nie naliczamy jej drugi raz przy przeciągu.
  w.localQ=Math.abs(w.netQ)<1e-4?(original?.state==='closed'?.25:.12)*Math.max(0,w.q):0;
  allocate(w);
 }
 for(let ri=0;ri<rooms.length;ri++){
  const cells=[];for(let k=0;k<g.n;k++)if(g.ids[k]===ri)cells.push(k);
  const leakage=result.leakFlows[ri]||0;
  if(Math.abs(leakage)>1e-6&&cells.length)allocate({id:'leak-'+ri,cells,netQ:leakage,localQ:0,penetration:p.pmPenetration});
 }
 for(const v of vents){const ri=roomIndex.get(v.roomId);if(ri===undefined)continue;
  const rate=result.ventFlows[v.id]||0;if(Math.abs(rate)<1e-9)continue;
  const r=rooms[ri],x=r.x+clamp(v.x,.05,r.w-.05),y=r.y+clamp(v.y,.05,r.h-.05);
  let k=indexAt(x,y,g);
  if(k<0||g.ids[k]!==ri){let d=Infinity;k=-1;for(let t=0;t<g.n;t++){if(g.ids[t]!==ri)continue;
    const dx=(t%g.nx+.5)*g.step-x,dy=(Math.floor(t/g.nx)+.5)*g.step-y;
    if(dx*dx+dy*dy<d){d=dx*dx+dy*dy;k=t;}}
  }
  if(k>=0)allocate({id:v.id,cells:[k],netQ:rate,localQ:0,penetration:v.type==='supply'?1:0});
 }
 g.netWindowFlow=net;g.airSources=airSources;g.pressureResult=result;g.windSpeedActual=gust;
  prepareDoorFluxBoundaries(g,p);
 return result;
}
function renderWindows(){const host=$('windows');host.innerHTML='';if(!windows.length){host.innerHTML='<p class="hint">Brak okien. Dodaj je na planie lub przyciskiem poniżej.</p>';return;}
 for(const w of windows){const r=rooms.find(r=>r.id===w.roomId),el=document.createElement('div');el.className='window-item'+(validWindow(w)?'':' window-invalid');
 el.innerHTML=`<div class="window-title"><strong>▤ ${escapeHtml(r?.name||'Brak pokoju')} · ${SIDE_LABEL[w.side]||w.side}</strong><button class="danger smallbtn" data-remove type="button" title="Usuń okno">×</button></div><div class="window-fields">
 <div class="field"><label>Stan okna</label><select data-w="state"><option value="closed">Zamknięte</option><option value="tilt">Rozszczelnione</option><option value="open">Otwarte</option></select></div>
 <div class="field"><label>Klasa szczelności (100 Pa)</label><select data-w="class"><option value="3">Klasa 4 (≤3)</option><option value="9">Klasa 3 (≤9)</option><option value="27">Klasa 2 (≤27)</option><option value="50">Klasa 1 (≤50)</option><option value="other">Własna wartość</option></select></div>
 <div class="field"><label>q₁₀₀ [m³/(h·m²)]</label><input data-w="q100" type="number" min="0" max="100" step="0.1"></div>
 <div class="field"><label>Szerokość [m]</label><input data-w="width" type="number" min="0.3" max="5" step="0.01"></div>
 <div class="field"><label>Wysokość [m]</label><input data-w="height" type="number" min="0.3" max="3" step="0.05"></div>
 <div class="field"><label>Pozycja na ścianie [%]</label><input data-w="pos" type="number" min="0" max="100" step="1"></div>
 <div class="field"><label>Szczelina rozszczelnienia [mm]</label><input data-w="gapMm" type="number" min="0" max="50" step="1"></div>
 <div class="field"><label>Efektywny prześwit przy otwarciu [% powierzchni]</label><input data-w="openPercent" type="number" min="0" max="100" step="1"></div>
 </div><div class="window-flow">${validWindow(w)?'Wymiana referencyjna przy Δp: ≈ '+fmt(windowQ(w,userParameters),1)+' m³/h · przepływ netto liczy solver ciśnień':'Nieprawidłowe: okno nie leży na wolnej ścianie zewnętrznej'}</div>`;
 host.appendChild(el);for(const field of el.querySelectorAll('[data-w]')){const key=field.dataset.w;if(key==='class'){field.value=[3,9,27,50].includes(w.q100)?String(w.q100):'other';field.addEventListener('change',()=>{if(field.value!=='other')w.q100=Number(field.value);renderWindows();reconfigureConnections();});continue;}
 field.value=key==='pos'?Math.round(w.pos*100):w[key];field.addEventListener('change',()=>{
  const old=w[key];
  if(key==='state')w.state=['closed','tilt','open'].includes(field.value)?field.value:'closed';
  else if(key==='pos')w.pos=num(field.value,50,0,100)/100;
  else w[key]=num(field.value,w[key],key==='width'||key==='height'?.3:0,key==='q100'?100:key==='gapMm'?50:key==='openPercent'?100:6);
  if(!validWindow(w)){w[key]=old;setStatus('Okno nie mieści się w tym miejscu albo nachodzi na inne okno. Zmiana została odrzucona.',true);renderWindows();return;}
  renderWindows();reconfigureConnections();
 });
 }
 el.querySelector('[data-remove]').addEventListener('click',()=>{windows=windows.filter(x=>x.id!==w.id);renderWindows();reconfigureConnections();});
 }
}
function renderDoors(){const host=$('doors');host.innerHTML='';for(const d of doors){const el=document.createElement('div');el.className='door';const options=(selected)=>rooms.map(r=>`<option value="${r.id}" ${r.id===selected?'selected':''}>${escapeHtml(r.name)}</option>`).join('');el.innerHTML=`<div class="door-kind"><strong>${isOpening(d)?'Stały otwór · zawsze drożny':'Drzwi · kliknij podczas symulacji'}</strong><select data-role="kind"><option value="door" ${!isOpening(d)?'selected':''}>Drzwi</option><option value="opening" ${isOpening(d)?'selected':''}>Stały otwór</option></select></div><select data-role="a" aria-label="Pierwszy pokój">${options(d.a)}</select><select data-role="b" aria-label="Drugi pokój">${options(d.b)}</select><button data-remove class="danger" title="Usuń przejście">×</button><div class="door-settings"><label>Szer. [m]<input data-role="width" aria-label="Szerokość przejścia w metrach" type="number" min="0.3" max="8" step="0.1"></label><label>Pozycja [%]<input data-role="pos" type="number" min="0" max="100" step="5"></label><label style="margin-left:auto" ${isOpening(d)?'hidden':''}><input data-role="open" type="checkbox" ${isOpening(d)?'disabled':''}>otwarte</label></div>
  ${isOpening(d)?'':`<div class="door-leak-settings">
    <label>Szczelina pod drzwiami [mm]<input data-role="gapMm" type="number" min="0" max="35" step="0.5" title="Zwykłe drzwi pokojowe: często około 10 mm szczeliny"></label>
    <label>Nieszczelność ościeżnicy [cm²]<input data-role="frameLeakCm2" type="number" min="0" max="200" step="1" title="Dodatkowy równoważny przekrój, nie zmierzona szczelność"></label>
   </div><div class="door-flow-note">Zamknięte drzwi: ≈ ${fmt(doorLeakArea({...d,open:false})*10000,0)} cm² przekroju; przy Δp=2 Pa ≈ ${fmt(doorFlowAtPa({...d,open:false}),1)} m³/h. Wartości modelowe, zależne od rzeczywistego ciśnienia.</div>`}`;
  host.appendChild(el);el.querySelector('[data-role=width]').value=d.width;el.querySelector('[data-role=pos]').value=Math.round(d.pos*100);el.querySelector('[data-role=open]').checked=d.open;if(!isOpening(d)){el.querySelector('[data-role=gapMm]').value=doorGapMm(d);el.querySelector('[data-role=frameLeakCm2]').value=doorFrameCm2(d);}
  for(const input of el.querySelectorAll('[data-role]'))input.addEventListener('change',()=>{const old={...d};const role=input.dataset.role;if(role==='width')d.width=num(input.value,1,.3,8);else if(role==='pos')d.pos=num(input.value,50,0,100)/100;else if(role==='open')d.open=input.checked;else if(role==='gapMm')d.gapMm=num(input.value,DEFAULT_DOOR_GAP_MM,0,35);else if(role==='frameLeakCm2')d.frameLeakCm2=num(input.value,DEFAULT_DOOR_FRAME_CM2,0,200);else if(role==='kind'){d.kind=input.value==='opening'?'opening':'door';if(isOpening(d))d.open=true;}else d[role]=input.value;let invalid=null;
    try{validateAttachedPassages();if(passageOverlap(d))throw Error('Drzwi lub otwór nachodzą na inne przejście.');}
    catch(error){invalid=error.message;}
    if(invalid){Object.assign(d,old);renderDoors();setStatus(invalid+' Zmiana odrzucona.',true);return;}renderDoors();reconfigureConnections();});
  el.querySelector('[data-remove]').addEventListener('click',()=>{doors=doors.filter(v=>v!==d);renderDoors();reconfigureConnections();});if(!shared(rooms.find(r=>r.id===d.a)||{},rooms.find(r=>r.id===d.b)||{})){el.querySelectorAll('select').forEach(x=>x.classList.add('door-invalid'));el.title='Pomieszczenia nie mają wspólnej ściany';}
 }
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function passageFraction(a,b,axis,from,to){
 if(a<0||b<0)return 0;
 if(a===b)return 1;
 const ra=rooms[a],rb=rooms[b],s=shared(ra,rb);
 if(!s||s.axis!==axis)return 0;
 const intervals=[];
 for(const d of doors){
  if(!((d.a===ra.id&&d.b===rb.id)||(d.b===ra.id&&d.a===rb.id)))continue;
  const width=Math.min(d.width,s.to-s.from),center=s.from+clamp((s.to-s.from)*d.pos,width/2,(s.to-s.from)-width/2);
  const start=center-width/2,end=center+width/2;
  if(end>start){
   // A 2D face represents the entire height of the zone; scale the closed-door
   // face's permeability by the relative effective crack area. This avoids
   // pretending a closed door is an open 2 m-high portal.
   const fullArea=(end-start)*Math.min(userParameters.height,2.05);
   const permeability=(isOpening(d)||d.open)?1:clamp(doorLeakArea(d)/Math.max(1e-9,fullArea),0,1);
   if(permeability>0)intervals.push([Math.max(from,start),Math.min(to,end),permeability]);
  }
 }
 intervals.sort((a,b)=>a[0]-b[0]);let coverage=0,edge=from;
 for(const [start,end,permeability] of intervals)if(end>Math.max(start,edge)){coverage+=(end-Math.max(start,edge))*permeability;edge=end;}
 return clamp(coverage/(to-from),0,1);
}
function buildGrid(){
 if(!rooms.length)throw Error('Brak pomieszczeń');validateRooms(rooms);
 let maxX=0,maxY=0;for(const r of rooms){maxX=Math.max(maxX,r.x+r.w);maxY=Math.max(maxY,r.y+r.h);}
 const step=Math.max(userParameters.gridStep||.2,Math.max(maxX,maxY)/165,Math.sqrt(maxX*maxY/9500)),nx=Math.ceil(maxX/step),ny=Math.ceil(maxY/step),n=nx*ny;
 const ids=new Int16Array(n);ids.fill(-1);let count=0;
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
  const x=(i+.5)*step,y=(j+.5)*step,k=j*nx+i;
  for(let rid=0;rid<rooms.length;rid++){
   const r=rooms[rid];if(x>=r.x-1e-7&&x<r.x+r.w-1e-7&&y>=r.y-1e-7&&y<r.y+r.h-1e-7){ids[k]=rid;count++;break;}
  }
 }
 if(!count)throw Error('Nie znaleziono wnętrza mieszkania.');
 const uOpen=new Float32Array((nx+1)*ny),vOpen=new Float32Array(nx*(ny+1));
 const areaByRoom=new Float64Array(rooms.length),cellByRoom=new Int32Array(rooms.length),cellVolumes=new Float64Array(n),roomVolumes=new Float64Array(rooms.length);
 for(const r of rooms){const ri=rooms.indexOf(r);areaByRoom[ri]=r.w*r.h;roomVolumes[ri]=r.w*r.h*userParameters.height;}
 for(let k=0;k<n;k++)if(ids[k]>=0)cellByRoom[ids[k]]++;
 for(let ri=0;ri<rooms.length;ri++)if(cellByRoom[ri]===0)throw Error('Pokój „'+rooms[ri].name+'” jest zbyt mały względem rozdzielczości siatki.');
 // Conservative room-specific control volumes: the sum of all represented cell volumes
 // always equals the exact geometrical room volume, regardless of grid alignment.
 for(let k=0;k<n;k++)if(ids[k]>=0)cellVolumes[k]=roomVolumes[ids[k]]/cellByRoom[ids[k]];
 for(let j=0;j<ny;j++)for(let i=1;i<nx;i++){
  const l=ids[j*nx+i-1],r=ids[j*nx+i];
  if(l>=0&&r>=0)uOpen[j*(nx+1)+i]=passageFraction(l,r,'x',j*step,(j+1)*step);
 }
 for(let j=1;j<ny;j++)for(let i=0;i<nx;i++){
  const t=ids[(j-1)*nx+i],b=ids[j*nx+i];
  if(t>=0&&b>=0)vOpen[j*nx+i]=passageFraction(t,b,'y',i*step,(i+1)*step);
 }
 return {step,nx,ny,n,ids,uOpen,vOpen,areaByRoom,cellByRoom,cellVolumes,roomVolumes,totalArea:rooms.reduce((a,r)=>a+r.w*r.h,0),maxX,maxY,cellVolume:step*step*userParameters.height};
}
function indexAt(x,y,g=grid){if(!g)return-1;const i=Math.floor(x/g.step),j=Math.floor(y/g.step);if(i<0||j<0||i>=g.nx||j>=g.ny)return-1;const k=j*g.nx+i;return g.ids[k]>=0?k:-1;}
// Fizyczny obrys urządzenia musi mieścić się W CAŁOŚCI w pojedynczym pokoju.
// Sprawdzamy dokładną geometrię prostokąta, niezależnie od przybliżonej siatki CFD.
const purifierRadius=(p=userParameters)=>Math.max(.1,Math.min(.6,Number(p.purifierDiameter||.42)/2));
function purifierPositionInRoom(r,x,y,g=grid,radius=purifierRadius()){
 if(!r||r.w+1e-9<2*radius||r.h+1e-9<2*radius)return null;
 const loX=r.x+radius,hiX=r.x+r.w-radius,loY=r.y+radius,hiY=r.y+r.h-radius;
 const candidate={x:clamp(x,loX,hiX),y:clamp(y,loY,hiY)};
 if(!g)return candidate;
 const rid=rooms.indexOf(r),cell=indexAt(candidate.x,candidate.y,g);
 if(cell>=0&&g.ids[cell]===rid)return candidate;
 // Gdy siatka nie odwzorowuje dokładnie krawędzi, znajdź najbliższą komórkę
 // w TYM SAMYM pokoju, której środek spełnia warunek geometrii koła.
 let best=null,dist=Infinity;
 for(let k=0;k<g.n;k++)if(g.ids[k]===rid){
  const xx=((k%g.nx)+.5)*g.step,yy=(Math.floor(k/g.nx)+.5)*g.step;
  if(xx<loX-1e-9||xx>hiX+1e-9||yy<loY-1e-9||yy>hiY+1e-9)continue;
  const d=(xx-candidate.x)**2+(yy-candidate.y)**2;if(d<dist){dist=d;best={x:xx,y:yy};}
 }
 return best;
}
function nearestValid(x,y,g=grid){
 if(!g)return null;
 const desired=hitRoom(x,y);
 if(desired){const own=purifierPositionInRoom(desired,x,y,g);if(own)return own;}
 let best=null,dist=Infinity;
 for(const r of rooms){const pos=purifierPositionInRoom(r,x,y,g);if(!pos)continue;
  const d=(pos.x-x)**2+(pos.y-y)**2;if(d<dist){dist=d;best=pos;}
 }
 return best;
}
function initConcentration(g){const c=new Float64Array(g.n);for(let k=0;k<g.n;k++)if(g.ids[k]>=0)c[k]=userParameters.initial;return c;}
function wallDistance(p,g){
 const initial=indexAt(p.x,p.y,g);if(initial<0)return 0;
 const dirs=[[1,0],[-1,0],[0,1],[0,-1]];let minimum=1.3;
 for(const [dx,dy] of dirs){let previous=initial;
  for(let s=1;s<=18;s++){
   const dist=s*g.step/4,x=p.x+dx*dist,y=p.y+dy*dist,next=indexAt(x,y,g);
   if(next<0){minimum=Math.min(minimum,dist);break;}
   if(next!==previous){const i=previous%g.nx,j=(previous/g.nx)|0;
    let open=false;
    if(dx>0)open=!!g.uOpen[j*(g.nx+1)+i+1];
    else if(dx<0)open=!!g.uOpen[j*(g.nx+1)+i];
    else if(dy>0)open=!!g.vOpen[(j+1)*g.nx+i];
    else open=!!g.vOpen[j*g.nx+i];
    if(!open){minimum=Math.min(minimum,dist);break;}
   }
   previous=next;
  }
 }
 return minimum;
}
function buildIntake(g,p){const origin=indexAt(p.x,p.y,g);const weights=new Float64Array(g.n),q=[];if(origin<0)return{weights,efficiency:0,volume:g.cellVolume};const seen=new Uint8Array(g.n);seen[origin]=1;q.push(origin);let head=0,sum=0;const radius=1.35;while(head<q.length){const k=q[head++],i=k%g.nx,j=(k/g.nx)|0;const x=(i+.5)*g.step,y=(j+.5)*g.step,dist=Math.hypot(x-p.x,y-p.y);if(dist<=radius){const w=Math.exp(-dist*dist/(2*.62*.62));weights[k]=w;sum+=w;}if(dist>radius+g.step)continue;
  const links=[[i+1,j,j*(g.nx+1)+i+1,'u'],[i-1,j,j*(g.nx+1)+i,'u'],[i,j+1,(j+1)*g.nx+i,'v'],[i,j-1,j*g.nx+i,'v']];for(const [ni,nj,f,axis]of links){if(ni<0||nj<0||ni>=g.nx||nj>=g.ny)continue;if(!(axis==='u'?g.uOpen[f]:g.vOpen[f]))continue;const nk=nj*g.nx+ni;if(!seen[nk]){seen[nk]=1;q.push(nk);}}}
  if(sum>0)for(let k=0;k<g.n;k++)if(weights[k])weights[k]/=sum;
  const d=wallDistance(p,g);const eff=clamp(.7+.3*d/.55,.7,1); // uproszczona redukcja skuteczności przy przeszkodzie
  return{weights,efficiency:eff};}
// Sprzężenie solvera wielostrefowego z siatką: strumienie na drzwiach są narzucone,
// a pozostałe prędkości w KAŻDYM pokoju są korygowane projekcją ciśnienia.
// Pozwala to zachować dokładną wymianę m³/h przez każde przejście, również pod zamkniętymi drzwiami.
function prepareDoorFluxBoundaries(g,p){
 const {nx,ny,n,ids,step:h,uOpen,vOpen}=g;
 const freeU=Float32Array.from(uOpen),freeV=Float32Array.from(vOpen);
 const fixedU=new Float32Array(uOpen.length),fixedV=new Float32Array(vOpen.length);
 // Brak swobodnego przepływu pomiędzy pokojami. Krawędzie drzwi są warunkiem brzegowym.
 for(let j=0;j<ny;j++)for(let i=1;i<nx;i++){
  const f=j*(nx+1)+i,a=ids[j*nx+i-1],b=ids[j*nx+i];
  if(a>=0&&b>=0&&a!==b)freeU[f]=0;
 }
 for(let j=1;j<ny;j++)for(let i=0;i<nx;i++){
  const f=j*nx+i,a=ids[(j-1)*nx+i],b=ids[j*nx+i];
  if(a>=0&&b>=0&&a!==b)freeV[f]=0;
 }
 let unmapped=0;
 const index=new Map(rooms.map((r,i)=>[r.id,i]));
 for(const door of doors){
  const q=g.pressureResult?.doorFlows?.[door.id]||0;
  if(Math.abs(q)<1e-8)continue;
  const geo=passageGeometry(door),a=index.get(door.a),b=index.get(door.b);
  if(!geo||a===undefined||b===undefined)continue;
  const span=Math.max(1e-9,geo.to-geo.from);
  const effective=(isOpening(door)||door.open)?1:clamp(doorLeakArea(door)/(span*Math.min(p.height,2.05)),0,1);
  const hits=[];
  if(geo.axis==='x'){
   for(let j=0;j<ny;j++)for(let i=1;i<nx;i++){
    const f=j*(nx+1)+i;
    if(!uOpen[f])continue;
    const l=ids[j*nx+i-1],r=ids[j*nx+i];
    if(!((l===a&&r===b)||(l===b&&r===a)))continue;
    const overlap=Math.max(0,Math.min(geo.to,(j+1)*h)-Math.max(geo.from,j*h));
    if(overlap>1e-9)hits.push({axis:'u',f,weight:overlap*effective,sign:l===a?1:-1,opening:uOpen[f]});
   }
  }else{
   for(let j=1;j<ny;j++)for(let i=0;i<nx;i++){
    const f=j*nx+i;
    if(!vOpen[f])continue;
    const t=ids[(j-1)*nx+i],bot=ids[j*nx+i];
    if(!((t===a&&bot===b)||(t===b&&bot===a)))continue;
    const overlap=Math.max(0,Math.min(geo.to,(i+1)*h)-Math.max(geo.from,i*h));
    if(overlap>1e-9)hits.push({axis:'v',f,weight:overlap*effective,sign:t===a?1:-1,opening:vOpen[f]});
   }
  }
  const sum=hits.reduce((v,hit)=>v+hit.weight,0);
  if(sum<1e-12){unmapped+=Math.abs(q);continue;}
  for(const hit of hits){
   // Prędkość przez częściowo otwartą ścianę; po pomnożeniu przez opening
   // transportowany strumień dokładnie wynosi q * weight/sum.
   const speed=hit.sign*q/3600*(hit.weight/sum)/(h*p.height*hit.opening);
   if(hit.axis==='u')fixedU[hit.f]+=speed;else fixedV[hit.f]+=speed;
  }
 }
 g.freeU=freeU;g.freeV=freeV;g.fixedU=fixedU;g.fixedV=fixedV;g.unmappedDoorFlow=unmapped;
}

// Ostateczna, precyzyjna projekcja pola prędkości metodą gradientów sprzężonych.
// Rozwiązuje dyskretny problem Poissona na przepuszczalnych krawędziach siatki.
function projectDivergenceFree(g,u,v,dt){
 const{nx,ny,n,step:h,ids,uOpen,vOpen}=g;
 const freeU=g.freeU||uOpen,freeV=g.freeV||vOpen;
 const b=new Float64Array(n),r=new Float64Array(n),z=new Float64Array(n),d=new Float64Array(n),ap=new Float64Array(n),pressure=new Float64Array(n),degree=new Float64Array(n);
 let rhsNorm=0;
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
  const k=j*nx+i;if(ids[k]<0)continue;
  const div=(u[j*(nx+1)+i+1]*uOpen[j*(nx+1)+i+1]-u[j*(nx+1)+i]*uOpen[j*(nx+1)+i]+v[(j+1)*nx+i]*vOpen[(j+1)*nx+i]-v[j*nx+i]*vOpen[j*nx+i])/h;
  const target=g.netWindowFlow?g.netWindowFlow[k]/g.cellVolume:0;
  b[k]=-(div-target)*h*h/dt;rhsNorm+=b[k]*b[k];
  degree[k]=(i>0?freeU[j*(nx+1)+i]:0)+(i<nx-1?freeU[j*(nx+1)+i+1]:0)+(j>0?freeV[j*nx+i]:0)+(j<ny-1?freeV[(j+1)*nx+i]:0);
 }
 if(rhsNorm<1e-25)return;
 function laplace(vec,out){
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
   const k=j*nx+i;if(ids[k]<0||!degree[k]){out[k]=0;continue;}
   let val=degree[k]*vec[k];if(i>0)val-=freeU[j*(nx+1)+i]*vec[k-1];if(i<nx-1)val-=freeU[j*(nx+1)+i+1]*vec[k+1];
   if(j>0)val-=freeV[j*nx+i]*vec[k-nx];if(j<ny-1)val-=freeV[(j+1)*nx+i]*vec[k+nx];out[k]=val;
  }
 }
 let rz=0;for(let k=0;k<n;k++){r[k]=b[k];z[k]=degree[k]?r[k]/degree[k]:0;d[k]=z[k];rz+=r[k]*z[k];}
 for(let it=0;it<Math.min(900,n);it++){
  laplace(d,ap);let dap=0;for(let k=0;k<n;k++)dap+=d[k]*ap[k];if(Math.abs(dap)<1e-30)break;
  const alpha=rz/dap;let err=0;
  for(let k=0;k<n;k++){pressure[k]+=alpha*d[k];r[k]-=alpha*ap[k];err+=r[k]*r[k];}
  if(err<rhsNorm*1e-14)break;
  let newRz=0;for(let k=0;k<n;k++){z[k]=degree[k]?r[k]/degree[k]:0;newRz+=r[k]*z[k];}
  if(Math.abs(rz)<1e-35)break;
  const beta=newRz/rz;for(let k=0;k<n;k++)d[k]=z[k]+beta*d[k];rz=newRz;
 }
 for(let j=0;j<ny;j++)for(let i=1;i<nx;i++){const f=j*(nx+1)+i;if(freeU[f])u[f]-=dt*(pressure[j*nx+i]-pressure[j*nx+i-1])/h;}
 for(let j=1;j<ny;j++)for(let i=0;i<nx;i++){const f=j*nx+i;if(freeV[f])v[f]-=dt*(pressure[j*nx+i]-pressure[(j-1)*nx+i])/h;}
}
function solveFlow(g,p,settings){const{nx,ny,step:h,ids,n}=g,uOpen=g.freeU||g.uOpen,vOpen=g.freeV||g.vOpen,un=(nx+1)*ny,vn=nx*(ny+1);
 const u=new Float32Array(un),v=new Float32Array(vn),pr=new Float32Array(n),div=new Float32Array(n),forceU=new Float32Array(un),forceV=new Float32Array(vn);
 const theta=settings.orientation*Math.PI/180,dx=Math.cos(theta),dy=Math.sin(theta),jet=settings.jet;
 // Jednostkowa dystrybucja siły wydmuchu w obszarze wylotu. Nie jest to model geometrii wentylatora.
 const outlet={x:p.x+dx*.17,y:p.y+dy*.17};
 for(let j=0;j<ny;j++)for(let i=1;i<nx;i++){const f=j*(nx+1)+i;if(!uOpen[f])continue;const x=i*h,y=(j+.5)*h,ax=(x-outlet.x)*dx+(y-outlet.y)*dy,trans=-(x-outlet.x)*dy+(y-outlet.y)*dx;
  forceU[f]=dx*.6*jet*Math.exp(-trans*trans/.12-Math.pow(Math.max(-.2,ax-.12),2)/.35);}
 for(let j=1;j<ny;j++)for(let i=0;i<nx;i++){const f=j*nx+i;if(!vOpen[f])continue;const x=(i+.5)*h,y=j*h,ax=(x-outlet.x)*dx+(y-outlet.y)*dy,trans=-(x-outlet.x)*dy+(y-outlet.y)*dx;
  forceV[f]=dy*.6*jet*Math.exp(-trans*trans/.12-Math.pow(Math.max(-.2,ax-.12),2)/.35);}
 const dt=.18,loops=115,its=24;for(let t=0;t<loops;t++){
   const damp=1/(1+dt*.95);
   for(let f=0;f<un;f++)u[f]=uOpen[f]?(u[f]+forceU[f]*dt)*damp:0;
   for(let f=0;f<vn;f++)v[f]=vOpen[f]?(v[f]+forceV[f]*dt)*damp:0;
   for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const k=j*nx+i;if(ids[k]<0)continue;div[k]=(u[j*(nx+1)+i+1]*uOpen[j*(nx+1)+i+1]-u[j*(nx+1)+i]*uOpen[j*(nx+1)+i]+v[(j+1)*nx+i]*vOpen[(j+1)*nx+i]-v[j*nx+i]*vOpen[j*nx+i])/h;}
   pr.fill(0);
   for(let s=0;s<its;s++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
     const k=j*nx+i;if(ids[k]<0)continue;let sum=0,count=0;
     if(i>0&&uOpen[j*(nx+1)+i]){sum+=pr[k-1]*uOpen[j*(nx+1)+i];count+=uOpen[j*(nx+1)+i];}
     if(i<nx-1&&uOpen[j*(nx+1)+i+1]){sum+=pr[k+1]*uOpen[j*(nx+1)+i+1];count+=uOpen[j*(nx+1)+i+1];}
     if(j>0&&vOpen[j*nx+i]){sum+=pr[k-nx]*vOpen[j*nx+i];count+=vOpen[j*nx+i];}
     if(j<ny-1&&vOpen[(j+1)*nx+i]){sum+=pr[k+nx]*vOpen[(j+1)*nx+i];count+=vOpen[(j+1)*nx+i];}
     if(count)pr[k]=(sum-div[k]*h*h/dt)/count;
   }
   for(let j=0;j<ny;j++)for(let i=1;i<nx;i++){const f=j*(nx+1)+i;if(uOpen[f])u[f]-=dt*(pr[j*nx+i]-pr[j*nx+i-1])/h;}
   for(let j=1;j<ny;j++)for(let i=0;i<nx;i++){const f=j*nx+i;if(vOpen[f])v[f]-=dt*(pr[j*nx+i]-pr[(j-1)*nx+i])/h;}
 }
 // Narzuć sieciowe strumienie przez przejścia PRZED projekcją; macierz koryguje
 // tylko prędkości wewnątrz pokojów (nie zmienia wartości na samych drzwiach).
 if(g.fixedU)for(let f=0;f<un;f++)u[f]+=g.fixedU[f];
 if(g.fixedV)for(let f=0;f<vn;f++)v[f]+=g.fixedV[f];
 // Precyzyjna projekcja końcowa: jednolite C pozostaje jednolite.
 projectDivergenceFree(g,u,v,dt);
 // Nie skalujemy globalnie strumieni — złamałoby to zgodność z siecią ciśnień.
 // Przy większych prędkościach zmniejszamy wyłącznie krok integracji PM₂.₅.
 let peak=0;for(let f=0;f<un;f++)peak=Math.max(peak,Math.abs(u[f]));for(let f=0;f<vn;f++)peak=Math.max(peak,Math.abs(v[f]));
 const windowFlowScale=1;
 // Warunek stabilności jawnego, zachowawczego schematu adwekcji i dyfuzji.
 const D=settings.mixing,minRatio=Math.min(1,...g.cellVolumes.filter(v=>v>0).map(v=>v/g.cellVolume));
 const scalarDt=Math.max(.001,Math.min(1.0,h/Math.max(.08,peak)/3.3,h*h/(5.5*Math.max(.001,D)))*Math.min(1,minRatio));
 return{u,v,peak,scalarDt,windowFlowScale};}
function stepPM(g,cur,next,vel,uptake,p,dt,stats){const{nx,ny,n,ids,uOpen,vOpen,step:h,cellVolume,cellVolumes,roomVolumes}=g;
 next.set(cur);const diffusion=p.mixing*dt/(h*h),advection=dt/h;
 for(let j=0;j<ny;j++)for(let i=1;i<nx;i++){const f=j*(nx+1)+i;if(!uOpen[f])continue;const l=j*nx+i-1,r=l+1,w=vel.u[f];const flux=uOpen[f]*(advection*w*(w>=0?cur[l]:cur[r])+diffusion*(cur[l]-cur[r]))*cellVolume;next[l]-=flux/cellVolumes[l];next[r]+=flux/cellVolumes[r];}
 for(let j=1;j<ny;j++)for(let i=0;i<nx;i++){const f=j*nx+i;if(!vOpen[f])continue;const a=(j-1)*nx+i,b=j*nx+i,w=vel.v[f];const flux=vOpen[f]*(advection*w*(w>=0?cur[a]:cur[b])+diffusion*(cur[a]-cur[b]))*cellVolume;next[a]-=flux/cellVolumes[a];next[b]+=flux/cellVolumes[b];}
 const deposition=1-Math.exp(-p.deposition*dt/3600);
 // Lokalny pochłaniacz: całkowita potencjalna objętość oczyszczanego powietrza = CADR × dt.
 const q=p.cadr/3600*uptake.efficiency;
 let taken=0,negative=0;
 for(let k=0;k<n;k++)if(ids[k]>=0){const r=ids[k],src=rooms[r].emission*dt/(3600*roomVolumes[r]);
  const before=next[k];let c=before-before*deposition+src;
  if(c<0){negative+=-c*cellVolumes[k];c=0;}
  const f=q*dt*uptake.weights[k]/cellVolumes[k];const after=c*Math.exp(-f);taken+=(c-after)*cellVolumes[k];next[k]=after;
 }
 // Każde okno miesza powietrze z zewnętrzem lokalnie; strumienie netto powietrza
 // są domykane zastępczo. Nie tworzymy fałszywej strugi ani źródła dywergencji.
 for(const w of (g.airSources||[])){const target=p.outside*w.penetration;
   for(const k of w.cells){
    // Balanced advection through the window is matched by the interior velocity field.
    const netQ=(w.netQ||0)/3600/w.cells.length;
    if(netQ>0)next[k]+=dt*netQ*target/cellVolumes[k];
    else if(netQ<0)next[k]+=dt*netQ*cur[k]/cellVolumes[k];
    const exchange=1-Math.exp(-Math.max(0,w.localQ||0)*dt/3600/(w.cells.length*cellVolumes[k]));
    next[k]+=exchange*(target-next[k]);
   }
 }
 if(stats){stats.removed+=taken;stats.clipped+=negative;}
 return next;}
function applyConfiguration(){getInputs();if(!Number.isFinite(userParameters.height))throw Error('Nieprawidłowa wysokość.');const g=buildGrid();g.windowSources=mapWindowSources(g,userParameters);configureWindowAirflow(g,userParameters,elapsed);weatherDiagnostics=g.pressureResult;purifier=nearestValid(purifier.x,purifier.y,g);if(!purifier)throw Error('Żaden pokój nie mieści całego oczyszczacza. Zmniejsz jego średnicę lub powiększ pomieszczenie.');if(g.unmappedDoorFlow>.05)throw Error('Siatka pomija przejście o niezerowym strumieniu — zmniejsz rozmiar komórki.');const vel=solveFlow(g,purifier,userParameters),uptake=buildIntake(g,purifier);return{g,vel,uptake};}
function rebuild(){playing=false;$('play').textContent='▶ Start';benchmarkToken++;rankingResults=null;$('compare').disabled=false;$('ranking').innerHTML='';$('compareProgress').style.width='0';$('compareStatus').textContent='Wyniki zależą od aktualnego układu ścian, emisji i CADR.';
 if(!rooms.length){grid=null;concentration=null;velocity=null;intake=null;elapsed=0;removed=0;clippedMass=0;$('play').disabled=true;$('compare').disabled=true;updateMetrics();render(performance.now());setStatus('Pusty plan. Kliknij „Rysuj pokój” i przeciągnij po planszy, aby utworzyć pierwszy pokój.');return;}
 try{const {g,vel,uptake}=applyConfiguration();grid=g;velocity=vel;intake=uptake;concentration=initConcentration(g);buffer=new Float64Array(g.n);elapsed=0;removed=0;clippedMass=0;lastGustUpdate=0;$('play').disabled=false;$('compare').disabled=false;updateMetrics();render(performance.now());const bad=doors.some(d=>!shared(rooms.find(r=>r.id===d.a)||{},rooms.find(r=>r.id===d.b)||{}));setStatus((bad?'Uwaga: co najmniej jedno przejście nie łączy sąsiadujących pomieszczeń. ':'')+(g.pressureResult?.converged?'':'UWAGA: brak drogi wyrównania ciśnienia — kierunkowe przepływy wstrzymane. Sprawdź otwory i wentylację. ')+'Model przeliczony. Kliknij Start lub ustaw oczyszczacz.');}catch(e){grid=null;concentration=null;$('play').disabled=true;$('compare').disabled=true;updateMetrics();setStatus('Błąd planu: '+e.message+'. Włącz narzędzie Przesuń pokój albo popraw wymiary.',true);render(performance.now());}}
function reconfigureConnections(){
 // Układ pokojów pozostaje ten sam: zachowaj aktualne stężenia i zegar, a przelicz
 // wyłącznie przepływy przez drzwi, stałe otwory oraz okna.
 if(!grid||!concentration){rebuild();return;}
 const saved={concentration,elapsed,removed,clippedMass,playing};
 try{getInputs();const g=buildGrid();g.windowSources=mapWindowSources(g,userParameters);configureWindowAirflow(g,userParameters,elapsed);weatherDiagnostics=g.pressureResult;const same=g.n===grid.n&&g.nx===grid.nx&&g.ny===grid.ny&&Math.abs(g.step-grid.step)<1e-10&&g.ids.every((v,i)=>v===grid.ids[i]);
 if(!same){rebuild();return;}
 if(g.unmappedDoorFlow>.05)throw Error('Siatka pomija przejście o niezerowym strumieniu; zmniejsz rozmiar komórki.');
 const vel=solveFlow(g,purifier,userParameters),uptake=buildIntake(g,purifier);
 grid=g;velocity=vel;intake=uptake;concentration=saved.concentration;elapsed=saved.elapsed;removed=saved.removed;clippedMass=saved.clippedMass;playing=saved.playing;
 benchmarkToken++;rankingResults=null;$('ranking').innerHTML='';$('compareProgress').style.width='0';$('compareStatus').textContent='Zmieniono drzwi, okna lub wentylację. Uruchom porównanie ponownie.';
 $('play').textContent=playing?'❚❚ Pauza':'▶ Start';updateMetrics();render(performance.now());
 }catch(e){playing=false;setStatus('Nie udało się zmienić przepływu: '+e.message,true);}
}
function togglePassage(d){if(isOpening(d)){setStatus('To stały otwór — nie ma skrzydła i nie można go zamknąć.');return;}d.open=!d.open;renderDoors();reconfigureConnections();setStatus('Drzwi '+(d.open?'otwarte':'zamknięte (z przepływem przez szczeliny)')+'. Symulacja zachowała aktualny czas i stężenia.');}
function toggleWindow(w){w.state=w.state==='closed'?'tilt':w.state==='tilt'?'open':'closed';renderWindows();reconfigureConnections();setStatus('Okno: '+({closed:'zamknięte',tilt:'rozszczelnione',open:'otwarte'}[w.state])+'. Zaktualizowano wymianę z zewnątrz.');}
function invalidate(msg){if(msg)setStatus(msg);}
function reset(){if(!grid)return;playing=false;$('play').textContent='▶ Start';concentration=initConcentration(grid);buffer=new Float64Array(grid.n);elapsed=0;removed=0;clippedMass=0;updateMetrics();render(performance.now());}
function setStatus(message,isError=false){$('status').textContent=message;$('status').className='status'+(isError?' error':'');}
function updateMetrics(){if(!grid||!concentration){for(const k of ['areaMetric','volumeMetric','pmMetric','eachMetric','removedMetric','clippedMetric','windowFlowMetric'])$(k).textContent='—';$('clock').textContent='00:00';return;}const vals=roomAverages(),p90=roomPercentiles();let total=0,totalVolume=0;for(let k=0;k<vals.length;k++){total+=vals[k]*grid.roomVolumes[k];totalVolume+=grid.roomVolumes[k];}$('areaMetric').textContent=fmt(grid.totalArea,1)+' m²';$('volumeMetric').textContent=fmt(grid.totalArea*userParameters.height,0)+' m³';$('pmMetric').textContent=fmt(total/Math.max(1,totalVolume),1);$('eachMetric').textContent=fmt(userParameters.cadr/Math.max(1,grid.totalArea*userParameters.height),2)+' /h';$('removedMetric').textContent=fmt(removed/1000,2)+' mg';if($('clippedMetric'))$('clippedMetric').textContent=fmt(clippedMass/1000,3)+' mg';$('windowFlowMetric').textContent=fmt(grid.pressureResult?.totalSupply||0,1)+' m³/h';
 if($('pressureMetric'))$('pressureMetric').textContent=fmt(grid.pressureResult?.maxResidual||0,2)+' m³/h';
 if($('windActualMetric'))$('windActualMetric').textContent=fmt(grid.windSpeedActual||0,1)+' m/s';$('clock').textContent=String(Math.floor(elapsed/3600)).padStart(2,'0')+':'+String(Math.floor(elapsed%3600/60)).padStart(2,'0');const body=$('roomStats');body.innerHTML='';for(let i=0;i<rooms.length;i++){const tr=document.createElement('tr');tr.innerHTML=`<td>${escapeHtml(rooms[i].name)}</td><td>${fmt(rooms[i].w*rooms[i].h,1)}</td><td>${fmt(vals[i],1)} <span class="unit">µg/m³</span></td><td>${fmt(p90[i],1)}</td>`;body.appendChild(tr);}}
function roomPercentiles(){
 if(!grid||!concentration)return rooms.map(()=>0);
 const groups=rooms.map(()=>[]);for(let k=0;k<grid.n;k++)if(grid.ids[k]>=0)groups[grid.ids[k]].push(concentration[k]);
 return groups.map(vals=>{if(!vals.length)return 0;vals.sort((a,b)=>a-b);return vals[Math.floor(.90*(vals.length-1))];});
}
function roomAverages(){
 const vals=new Array(rooms.length).fill(0);
 if(!grid||!concentration)return vals;
 for(let k=0;k<grid.n;k++)if(grid.ids[k]>=0)vals[grid.ids[k]]+=concentration[k]*grid.cellVolumes[k];
 return vals.map((v,i)=>v/Math.max(1e-12,grid.roomVolumes[i]));
}
const ramp=[[28,49,109],[36,104,167],[49,173,170],[238,205,104],[236,109,68],[172,42,94]];
function rgbAt(f){const x=clamp(f,0,1)*(ramp.length-1),i=Math.min(ramp.length-2,Math.floor(x)),w=x-i;return[0,1,2].map(k=>Math.round(ramp[i][k]*(1-w)+ramp[i+1][k]*w));}
let heatmapCanvas=document.createElement('canvas'),heatctx=heatmapCanvas.getContext('2d');

function passageGeometry(d){const a=rooms.find(r=>r.id===d.a),b=rooms.find(r=>r.id===d.b);if(!a||!b)return null;const edge=shared(a,b);if(!edge)return null;const w=Math.min(d.width,edge.to-edge.from),center=edge.from+clamp((edge.to-edge.from)*d.pos,w/2,(edge.to-edge.from)-w/2);return{axis:edge.axis,at:edge.at,from:center-w/2,to:center+w/2};}
function drawPassages(X,Y,scale){for(const d of doors){const g=passageGeometry(d);if(!g)continue;const vertical=g.axis==='x';ctx.lineCap='round';ctx.beginPath();ctx.lineWidth=10;ctx.strokeStyle='#0c1d2d';if(vertical){ctx.moveTo(X(g.at),Y(g.from));ctx.lineTo(X(g.at),Y(g.to));}else{ctx.moveTo(X(g.from),Y(g.at));ctx.lineTo(X(g.to),Y(g.at));}ctx.stroke();
 ctx.beginPath();ctx.lineWidth=isOpening(d)?5:4;ctx.strokeStyle=isOpening(d)?'#a8b8ff':d.open?'#70f6c7':'#ffaa70';if(isOpening(d))ctx.setLineDash([6,3]);
 if(vertical){ctx.moveTo(X(g.at),Y(g.from));ctx.lineTo(X(g.at),Y(g.to));}else{ctx.moveTo(X(g.from),Y(g.at));ctx.lineTo(X(g.to),Y(g.at));}ctx.stroke();ctx.setLineDash([]);
 const xx=vertical?X(g.at):X((g.from+g.to)/2),yy=vertical?Y((g.from+g.to)/2):Y(g.at);ctx.font='bold 12px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=isOpening(d)?'#d0d5ff':d.open?'#b5ffda':'#ffcc9b';ctx.fillText(isOpening(d)?'↔':d.open?'↗':'×',xx+(vertical?13:0),yy+(vertical?0:-12));
 }}
function drawWindows(X,Y,scale){for(const w of windows){const g=windowGeometry(w);if(!g)continue;const okay=validWindow(w);ctx.beginPath();ctx.lineWidth=10;ctx.strokeStyle='#0a192d';if(g.vertical){ctx.moveTo(X(g.at),Y(g.from));ctx.lineTo(X(g.at),Y(g.to));}else{ctx.moveTo(X(g.from),Y(g.at));ctx.lineTo(X(g.to),Y(g.at));}ctx.stroke();ctx.beginPath();ctx.lineWidth=5;ctx.strokeStyle=!okay?'#f48a8a':w.state==='closed'?'#6eb8f3':w.state==='tilt'?'#ffdf83':'#63f2c9';if(g.vertical){ctx.moveTo(X(g.at),Y(g.from));ctx.lineTo(X(g.at),Y(g.to));}else{ctx.moveTo(X(g.from),Y(g.at));ctx.lineTo(X(g.to),Y(g.at));}ctx.stroke();ctx.beginPath();ctx.lineWidth=1.5;ctx.strokeStyle='#07192d';if(g.vertical){ctx.moveTo(X(g.at)+3,Y(g.from));ctx.lineTo(X(g.at)+3,Y(g.to));}else{ctx.moveTo(X(g.from),Y(g.at)+3);ctx.lineTo(X(g.to),Y(g.at)+3);}ctx.stroke();}}
function hitPassage(p){if(!viewTransform)return null;let found=null,min=Infinity;for(const d of doors){const g=passageGeometry(d);if(!g)continue;const vertical=g.axis==='x',perp=vertical?p.x:p.y,along=vertical?p.y:p.x,dist=Math.hypot(perp-g.at,Math.max(g.from-along,0,along-g.to));if(dist<min){min=dist;found=d;}}
 return min*viewTransform.scale<=22?found:null;}
function hitWindow(p){if(!viewTransform)return null;let found=null,min=Infinity;for(const w of windows){const g=windowGeometry(w);if(!g)continue;const perp=g.vertical?p.x:p.y,along=g.vertical?p.y:p.x,dist=Math.hypot(perp-g.at,Math.max(g.from-along,0,along-g.to));if(dist<min){min=dist;found=w;}}
 return min*viewTransform.scale<=18?found:null;}
// W trybie usuwania wybieramy NAJBLIŻSZY konkretny element na ścianie.
// Nie zasłaniamy nim pokoju; kliknięcie środka pokoju usuwa cały pokój (z potwierdzeniem).
function planElementHit(p){
 if(!viewTransform)return null;
 let best=null,min=Infinity;
 function probe(kind,id,g,vertical,at){
  const perp=vertical?p.x:p.y,along=vertical?p.y:p.x;
  const px=Math.hypot(perp-at,Math.max(g.from-along,0,along-g.to))*viewTransform.scale;
  if(px<=15&&px<min){min=px;best={kind,id};}
 }
 for(const w of windows){const g=windowGeometry(w);if(g)probe('window',w.id,g,g.vertical,g.at);}
 for(const d of doors){const g=passageGeometry(d);if(g)probe('passage',d.id,g,g.axis==='x',g.at);}
 const v=hitVent(p);if(v){const q=ventPosition(v),px=Math.hypot(p.x-q.x,p.y-q.y)*viewTransform.scale;if(px<min){best={kind:'vent',id:v.id};min=px;}}
 if(best)return best;
 const r=hitRoom(p.x,p.y);return r?{kind:'room',id:r.id}:null;
}
function deletePlanElement(hit){
 if(!hit)return;
 if(hit.kind==='room'){requestDeleteRoom(hit.id);return;}
 if(hit.kind==='window'){
  const w=windows.find(w=>w.id===hit.id),roomName=rooms.find(r=>r.id===w?.roomId)?.name||'pomieszczeniu';
  if(!w)return;
  windows=windows.filter(v=>v.id!==w.id);editorHover=null;renderWindows();reconfigureConnections();
  setStatus('Usunięto okno w „'+roomName+'”.');return;
 }
 if(hit.kind==='vent'){const v=vents.find(v=>v.id===hit.id);if(!v)return;vents=vents.filter(w=>w.id!==v.id);editorHover=null;renderVents();reconfigureConnections();setStatus('Usunięto kratkę wentylacyjną.');return;}
 if(hit.kind==='passage'){
  const d=doors.find(v=>v.id===hit.id);if(!d)return;
  const label=isOpening(d)?'stały otwór':'drzwi';
  doors=doors.filter(v=>v.id!==d.id);editorHover=null;renderDoors();reconfigureConnections();
  setStatus('Usunięto '+label+' z planu.');
 }
}
function drawEditorInteraction(X,Y,scale){
 if(editorGesture?.kind==='move-item'){
  const g=editorGesture,pp=g.preview;
  if(g.itemType==='vent'){const v=vents.find(x=>x.id===g.id),r=v&&rooms.find(x=>x.id===v.roomId);if(v&&r){ctx.save();ctx.strokeStyle='#ffdd88';ctx.setLineDash([4,4]);ctx.lineWidth=3;ctx.strokeRect(X(r.x+pp.x)-12,Y(r.y+pp.y)-12,24,24);ctx.restore();}}
  if(g.itemType==='door'||g.itemType==='window'){const ref=g.itemType==='door'?doors.find(x=>x.id===g.id):windows.find(x=>x.id===g.id);
   if(ref){const temp={...ref,pos:pp.pos},geo=g.itemType==='door'?passageGeometry(temp):windowGeometry(temp);if(geo){ctx.save();ctx.strokeStyle='#ffdf90';ctx.lineWidth=8;ctx.setLineDash([7,4]);const vertical=g.itemType==='door'?geo.axis==='x':geo.vertical;ctx.beginPath();if(vertical){ctx.moveTo(X(geo.at),Y(geo.from));ctx.lineTo(X(geo.at),Y(geo.to));}else{ctx.moveTo(X(geo.from),Y(geo.at));ctx.lineTo(X(geo.to),Y(geo.at));}ctx.stroke();ctx.restore();}}
  }
 }
 if(editorMode==='window'&&editorHover?.kind==='window-preview'){
  const proposal=editorHover.proposal;
  const g=proposal.ok?windowGeometry(proposal.w):null;
  if(g){ctx.save();ctx.beginPath();ctx.lineCap='round';ctx.lineWidth=9;ctx.strokeStyle='rgba(115,255,211,.95)';ctx.setLineDash([7,4]);
   if(g.vertical){ctx.moveTo(X(g.at),Y(g.from));ctx.lineTo(X(g.at),Y(g.to));}else{ctx.moveTo(X(g.from),Y(g.at));ctx.lineTo(X(g.to),Y(g.at));}
   ctx.stroke();ctx.setLineDash([]);ctx.restore();}
  return;
 }
 if(editorMode!=='delete'||!editorHover||editorHover.kind==='room')return;
 const hit=editorHover;
 if(hit.kind==='vent'){const v=vents.find(x=>x.id===hit.id),q=v&&ventPosition(v);if(!q)return;ctx.save();ctx.strokeStyle='#ff687a';ctx.lineWidth=3;ctx.beginPath();ctx.arc(X(q.x),Y(q.y),15,0,Math.PI*2);ctx.stroke();ctx.restore();return;}
 let g=null,vertical=false,label='';
 if(hit.kind==='window'){const w=windows.find(v=>v.id===hit.id);g=windowGeometry(w);if(!g)return;vertical=g.vertical;label='Usuń okno';}
 if(hit.kind==='passage'){const d=doors.find(v=>v.id===hit.id);if(!d)return;g=passageGeometry(d);if(!g)return;vertical=g.axis==='x';label=isOpening(d)?'Usuń stały otwór':'Usuń drzwi';}
 if(!g)return;
 const mx=vertical?X(g.at):X((g.from+g.to)/2),my=vertical?Y((g.from+g.to)/2):Y(g.at);
 ctx.save();ctx.lineCap='round';ctx.beginPath();ctx.strokeStyle='#ff687a';ctx.lineWidth=10;
 if(vertical){ctx.moveTo(X(g.at),Y(g.from));ctx.lineTo(X(g.at),Y(g.to));}else{ctx.moveTo(X(g.from),Y(g.at));ctx.lineTo(X(g.to),Y(g.at));}
 ctx.stroke();ctx.fillStyle='#ffedef';ctx.font='bold 17px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('×',mx,my);
 ctx.font='bold 12px system-ui';const labelW=ctx.measureText(label).width+20;
 const left=clamp(mx-labelW/2,3,canvas.width-labelW-3),top=clamp(my-37,3,canvas.height-26);
 ctx.fillStyle='#5b1e30';ctx.fillRect(left,top,labelW,24);ctx.fillStyle='#fff4f7';ctx.fillText(label,left+labelW/2,top+12);ctx.restore();
}

function renderEditor(){
 const W=canvas.width,H=canvas.height;ctx.clearRect(0,0,W,H);ctx.fillStyle='#0a1727';ctx.fillRect(0,0,W,H);
 const pad=52,span=Number($('editorSpan').value)||16;
 let maxX=span,maxY=Math.max(8,span*.62);
 for(const r of rooms){maxX=Math.max(maxX,r.x+r.w+1);maxY=Math.max(maxY,r.y+r.h+1);}
 const scale=Math.min((W-2*pad)/maxX,(H-2*pad)/maxY),offX=pad,offY=pad;
 viewTransform={scale,offX,offY};const X=v=>offX+v*scale,Y=v=>offY+v*scale;
 // Fixed world grid, always visible even with an empty/invalid simulation mesh.
 const rx=(W-pad-offX)/scale,ry=(H-pad-offY)/scale;
 for(let a=0;a<=rx+1e-6;a+=.5){ctx.beginPath();ctx.strokeStyle=Math.round(a*2)%2?'#213249':'#31445c';ctx.lineWidth=Math.round(a*2)%2?.6:1;ctx.moveTo(X(a),Y(0));ctx.lineTo(X(a),Y(ry));ctx.stroke();}
 for(let a=0;a<=ry+1e-6;a+=.5){ctx.beginPath();ctx.strokeStyle=Math.round(a*2)%2?'#213249':'#31445c';ctx.lineWidth=Math.round(a*2)%2?.6:1;ctx.moveTo(X(0),Y(a));ctx.lineTo(X(rx),Y(a));ctx.stroke();}
 ctx.fillStyle='#9bb4d0';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='11px system-ui';
 for(let x=0;x<=rx;x+=2)ctx.fillText(x+' m',X(x),Y(0)-17);
 for(let y=0;y<=ry;y+=2){ctx.textAlign='right';ctx.fillText(y+' m',X(0)-9,Y(y));}
 ctx.save();
 const editorAverages=grid&&concentration?roomAverages():null;
 for(const r of rooms){const isMoving=editorGesture?.kind==='move'&&editorGesture.roomId===r.id,selected=r.id===selectedRoomId,hovered=editorMode==='delete'&&editorHover?.kind==='room'&&editorHover.id===r.id;
  ctx.fillStyle=hovered?'#54313d':isMoving?'#224259':'#203b51';ctx.strokeStyle=hovered?'#ff9696':selected?'#70f6d7':'#c8e7fb';ctx.lineWidth=selected||hovered?5:3;
  ctx.fillRect(X(r.x),Y(r.y),r.w*scale,r.h*scale);ctx.strokeRect(X(r.x),Y(r.y),r.w*scale,r.h*scale);
  ctx.save();ctx.beginPath();ctx.rect(X(r.x)+1,Y(r.y)+1,r.w*scale-2,r.h*scale-2);ctx.clip();
  ctx.fillStyle='#f1f7fd';ctx.font='600 14px system-ui';ctx.textAlign='center';
  const cx=X(r.x+r.w/2),cy=Y(r.y)+Math.min(54,r.h*scale/2),roomWidth=Math.max(12,r.w*scale-10),averages=editorAverages;
  ctx.fillText(r.name,cx,cy-17,roomWidth);
  ctx.font='12px system-ui';ctx.fillStyle='#b3d0e8';ctx.fillText(`${fmt(r.w,2)} × ${fmt(r.h,2)} m`,cx,cy+2,roomWidth);
  ctx.font='bold 12px system-ui';ctx.fillStyle='#86f0e2';ctx.fillText(averages?'Śr. PM₂.₅: '+fmt(averages[rooms.indexOf(r)],1)+' µg/m³':'PM₂.₅: —',cx,cy+21,roomWidth);ctx.restore();
 }
 drawPassages(X,Y,scale);drawWindows(X,Y,scale);drawVents(X,Y,scale);drawEmissions(X,Y,scale);drawEditorInteraction(X,Y,scale);
 if(rooms.some(r=>purifier.x>=r.x&&purifier.x<r.x+r.w&&purifier.y>=r.y&&purifier.y<r.y+r.h)){
  const rad=purifierRadius()*scale;ctx.beginPath();ctx.fillStyle='#65f3d6';ctx.strokeStyle='#123b42';ctx.lineWidth=2.5;
  ctx.arc(X(purifier.x),Y(purifier.y),rad,0,2*Math.PI);ctx.fill();ctx.stroke();
 }
 if(editorGesture&&(editorGesture.kind==='room'||editorGesture.kind==='move')){
  const g=editorGesture,rect=g.kind==='room'?rectDrag(g.start,g.end):g.preview;
  if(rect&&rect.w>=.5&&rect.h>=.5){const ok=candidateValid(rect,g.kind==='move'?g.roomId:null);ctx.setLineDash([9,5]);ctx.lineWidth=3;ctx.fillStyle=ok?'#52c3b044':'#e8636340';ctx.strokeStyle=ok?'#70f6d7':'#ff9696';ctx.fillRect(X(rect.x),Y(rect.y),rect.w*scale,rect.h*scale);ctx.strokeRect(X(rect.x),Y(rect.y),rect.w*scale,rect.h*scale);ctx.setLineDash([]);}
 }
 ctx.restore();
 if(!rooms.length){ctx.textAlign='center';ctx.fillStyle='#d7eafd';ctx.font='600 20px system-ui';ctx.fillText('Pusty plan — narysuj pierwszy pokój',W/2,H/2-25);ctx.font='14px system-ui';ctx.fillStyle='#a8c5e0';ctx.fillText('Wybierz „Rysuj pokój” i przeciągnij myszą (siatka jest tylko pomocą)',W/2,H/2+8);}
 $('legendMin').textContent='0 m';$('legendMax').textContent='Siatka 0,5 m';
}
function render(t){const W=canvas.width,H=canvas.height;
 if(editorMode!=='purifier'||!grid){renderEditor();return;}
ctx.fillStyle='#091421';ctx.fillRect(0,0,W,H);if(!grid){ctx.fillStyle='#f6a8a8';ctx.font='22px system-ui';ctx.fillText('Popraw parametry planu',36,60);return;}const pad=54,scale=Math.min((W-2*pad)/grid.maxX,(H-2*pad)/grid.maxY);const offX=(W-grid.maxX*scale)/2,offY=(H-grid.maxY*scale)/2;viewTransform={scale,offX,offY};const X=x=>offX+x*scale,Y=y=>offY+y*scale;
 // Renderowanie mapy skalarnej bez rozmywania przez ściany.
 heatmapCanvas.width=grid.nx;heatmapCanvas.height=grid.ny;const img=heatctx.createImageData(grid.nx,grid.ny);let maxC=Math.max(30,userParameters.initial,userParameters.outside,0);for(let k=0;k<grid.n;k++)if(grid.ids[k]>=0)maxC=Math.max(maxC,concentration[k]*1.05);const minC=0;
 for(let k=0;k<grid.n;k++){const o=k*4;if(grid.ids[k]<0){img.data[o]=13;img.data[o+1]=22;img.data[o+2]=35;img.data[o+3]=255;}else{const v=concentration[k]/maxC,c=rgbAt(v);img.data[o]=c[0];img.data[o+1]=c[1];img.data[o+2]=c[2];img.data[o+3]=255;}}heatctx.putImageData(img,0,0);
 if(view!=='flow'){ctx.imageSmoothingEnabled=false;ctx.globalAlpha=view==='split'?.78:1;ctx.drawImage(heatmapCanvas,offX,offY,grid.nx*grid.step*scale,grid.ny*grid.step*scale);ctx.globalAlpha=1;}else{ctx.fillStyle='#102333';for(let j=0;j<grid.ny;j++)for(let i=0;i<grid.nx;i++){const k=j*grid.nx+i;if(grid.ids[k]<0)continue;ctx.fillRect(X(i*grid.step),Y(j*grid.step),grid.step*scale+.6,grid.step*scale+.6);}}
 // Proste kreski zamiast wypłukiwania koloru przez antymieszanie.
 if(view!=='pm'){
   ctx.strokeStyle='rgba(180,242,255,.75)';ctx.fillStyle='rgba(180,242,255,.88)';const stride=2;
   for(let j=1;j<grid.ny-1;j+=stride)for(let i=1;i<grid.nx-1;i+=stride){const k=j*grid.nx+i;if(grid.ids[k]<0)continue;let u=(velocity.u[j*(grid.nx+1)+i]+velocity.u[j*(grid.nx+1)+i+1])*.5,v=(velocity.v[j*grid.nx+i]+velocity.v[(j+1)*grid.nx+i])*.5;const sp=Math.hypot(u,v);if(sp<.008)continue;const len=clamp(sp*55,5,23),ox=X((i+.5)*grid.step),oy=Y((j+.5)*grid.step),xx=ox+u/sp*len,yy=oy+v/sp*len;ctx.globalAlpha=clamp(sp*2.2,.25,1);ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(ox,oy);ctx.lineTo(xx,yy);ctx.stroke();ctx.beginPath();ctx.moveTo(xx,yy);ctx.lineTo(xx-u/sp*5-v/sp*2.7,yy-v/sp*5+u/sp*2.7);ctx.lineTo(xx-u/sp*5+v/sp*2.7,yy-v/sp*5-u/sp*2.7);ctx.closePath();ctx.fill();}ctx.globalAlpha=1;
 }
 // Granice komórek przy ścianach = ściany pokoju, otwory drzwiowe pozostają wolne.
 ctx.lineWidth=3.4;ctx.lineCap='square';ctx.strokeStyle='#edf3ff';ctx.beginPath();for(let j=0;j<grid.ny;j++)for(let i=0;i<grid.nx;i++){const k=j*grid.nx+i;if(grid.ids[k]<0)continue;const l=X(i*grid.step),r=X((i+1)*grid.step),top=Y(j*grid.step),b=Y((j+1)*grid.step);if(grid.uOpen[j*(grid.nx+1)+i]<.02){ctx.moveTo(l,top);ctx.lineTo(l,b);}if(grid.uOpen[j*(grid.nx+1)+i+1]<.02){ctx.moveTo(r,top);ctx.lineTo(r,b);}if(grid.vOpen[j*grid.nx+i]<.02){ctx.moveTo(l,top);ctx.lineTo(r,top);}if(grid.vOpen[(j+1)*grid.nx+i]<.02){ctx.moveTo(l,b);ctx.lineTo(r,b);}}
 ctx.stroke();drawPassages(X,Y,scale);drawWindows(X,Y,scale);drawVents(X,Y,scale);drawEmissions(X,Y,scale);
 ctx.textAlign='center';ctx.textBaseline='middle';const averages=roomAverages();
 for(let i=0;i<rooms.length;i++){
  const r=rooms[i],cx=X(r.x+r.w/2),cy=Y(r.y)+Math.min(39,r.h*scale/2),maxWidth=Math.max(12,r.w*scale-12);
  ctx.font='600 14px system-ui';const nameWidth=ctx.measureText(r.name).width;
  ctx.font='700 13px system-ui';const pmLabel=fmt(averages[i],1)+' µg/m³',pmWidth=ctx.measureText(pmLabel).width;
  const boxWidth=Math.min(maxWidth,Math.max(nameWidth,pmWidth)+24),boxHeight=Math.min(43,Math.max(24,r.h*scale-12));
  ctx.fillStyle='rgba(8,17,29,.87)';ctx.fillRect(cx-boxWidth/2,cy-boxHeight/2,boxWidth,boxHeight);
  const nameY=boxHeight>=38?cy-9:cy-6,pmY=boxHeight>=38?cy+10:cy+7;
  ctx.fillStyle='#f1f8ff';ctx.font='600 14px system-ui';ctx.fillText(r.name,cx,nameY,Math.max(10,boxWidth-8));
  ctx.fillStyle='#8bf8df';ctx.font='700 13px system-ui';ctx.fillText(pmLabel,cx,pmY,Math.max(10,boxWidth-8));
 }
 const previewRoom=editorGesture?.kind==='purifier'?(editorGesture.roomId?rooms.find(r=>r.id===editorGesture.roomId):hitRoom(editorGesture.x,editorGesture.y)):null;
 const preview=editorGesture?.kind==='purifier'?purifierPositionInRoom(previewRoom,editorGesture.x,editorGesture.y):null;
 const displayed=preview||purifier,px=X(displayed.x),py=Y(displayed.y),theta=userParameters.orientation*Math.PI/180;
 ctx.shadowBlur=12;ctx.shadowColor='#6ef9dc';ctx.fillStyle='#64e7d5';ctx.strokeStyle='#0b444c';ctx.lineWidth=3;
 ctx.beginPath();ctx.arc(px,py,purifierRadius()*scale,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.shadowBlur=0;ctx.strokeStyle='#0b4346';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px+Math.cos(theta)*24,py+Math.sin(theta)*24);ctx.stroke();ctx.fillStyle='#073c3e';ctx.beginPath();ctx.arc(px,py,3.5,0,2*Math.PI);ctx.fill();ctx.font='700 13px system-ui';ctx.textAlign='left';ctx.fillStyle='#d6fff8';ctx.fillText('Oczyszczacz',px+19,py-17);
 ctx.textAlign='right';ctx.fillStyle='#8298b1';ctx.font='12px system-ui';ctx.fillText(`${fmt(grid.maxX,1)} × ${fmt(grid.maxY,1)} m`,W-17,H-21);$('legendMax').textContent=fmt(maxC,0)+' µg/m³';$('legendMin').textContent=fmt(minC,0)+' µg/m³';}
function tick(now){if(playing&&grid&&concentration){
 if(userParameters.windFlowEnabled&&userParameters.gustPercent>0&&elapsed-lastGustUpdate>=120){
  configureWindowAirflow(grid,userParameters,elapsed);weatherDiagnostics=grid.pressureResult;
   if(grid.unmappedDoorFlow>.05){playing=false;setStatus('Nie można odwzorować przepływu drzwi na siatce: wybierz drobniejszy krok siatki.',true);}
   else velocity=solveFlow(grid,purifier,userParameters);
   lastGustUpdate=elapsed;
 }
 const desired=Number($('speed').value)||120,wallSeconds= Math.min(.06,Math.max(.008,(now-lastFrame)/1000));const simSeconds=desired*wallSeconds,maxTime=simulationTimeLimit();let advanced=0,loops=0;const stats={removed:0,clipped:0};while(advanced+1e-9<simSeconds&&elapsed<maxTime&&loops<110){const dt=Math.min(velocity.scalarDt,simSeconds-advanced,maxTime-elapsed);if(dt<=0)break;stepPM(grid,concentration,buffer,velocity,intake,userParameters,dt,stats);[concentration,buffer]=[buffer,concentration];elapsed+=dt;advanced+=dt;loops++;}removed+=stats.removed;clippedMass+=stats.clipped;if(elapsed>=maxTime-.001){playing=false;$('play').textContent='▶ Start';setStatus('Osiągnięto koniec ustawionego czasu symulacji.');}
 }lastFrame=now;if(now-lastRender>95){render(now);updateMetrics();lastRender=now;}requestAnimationFrame(tick);}
function placePurifier(x,y,roomId=null){
 if(!grid)return;
 const r=roomId?rooms.find(v=>v.id===roomId):hitRoom(x,y);
 if(!r){setStatus('Oczyszczacz można ustawić tylko wewnątrz istniejącego pokoju.',true);return;}
 const target=purifierPositionInRoom(r,x,y,grid);
 if(!target){setStatus('Pokój jest zbyt mały na oczyszczacz o tej średnicy. Zmniejsz średnicę urządzenia.',true);return;}
 purifier=target;
 // Zmiana lokalizacji oczyszczacza nie zmienia geometrii, ciśnienia ani czasu.
 // Przelicz tylko jego pole wymuszenia i pobór pyłu.
 velocity=solveFlow(grid,purifier,userParameters);
 intake=buildIntake(grid,purifier);
 benchmarkToken++;rankingResults=null;$('ranking').innerHTML='';
 $('compareStatus').textContent='Przeniesiono oczyszczacz — uruchom ranking ponownie.';
 updateMetrics();render(performance.now());
 if(Math.hypot(target.x-x,target.y-y)>.01)setStatus('Przesunięto oczyszczacz do najbliższej dozwolonej pozycji. Cały okrąg mieści się w pokoju „'+r.name+'”.');
}
function canvasXY(e){const box=canvas.getBoundingClientRect(),coordX=(e.clientX-box.left)*canvas.width/box.width,coordY=(e.clientY-box.top)*canvas.height/box.height;const{scale,offX,offY}=viewTransform;return{x:(coordX-offX)/scale,y:(coordY-offY)/scale};}
function download(filename,blob){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function runComparison(){if(!grid)return;benchmarkToken++;const token=benchmarkToken;playing=false;$('play').textContent='▶ Start';$('compare').disabled=true;$('ranking').innerHTML='';$('compareProgress').style.width='0';try{const p={...userParameters,gustPercent:0},g=buildGrid();g.windowSources=mapWindowSources(g,p);configureWindowAirflow(g,p,0);

 if(!g.pressureResult?.converged||g.unmappedDoorFlow>.05){
  setStatus('Nie można porównać ustawień: brak poprawnego bilansu ciśnień lub przepływu przez drzwi. Skoryguj model wentylacji albo wybierz drobniejszą siatkę.',true);
  return;
 }
 const time=Math.min(1800,simulationTimeLimit(p)),targetId=$('targetRoom').value,targetIndex=rooms.findIndex(r=>r.id===targetId),candidates=[{label:'Bez oczyszczacza',pos:null}];for(let i=0;i<rooms.length;i++){const r=rooms[i];const pos=purifierPositionInRoom(r,r.x+r.w/2,r.y+r.h/2,g);if(pos)candidates.push({label:r.name+' · środek',pos});}if(!candidates.some(c=>c.pos&&Math.hypot(c.pos.x-purifier.x,c.pos.y-purifier.y)<.35))candidates.push({label:'Moje ustawienie',pos:{...purifier}});
 const results=[];const yieldUI=()=>new Promise(resolve=>setTimeout(resolve,0));
 for(let idx=0;idx<candidates.length;idx++){
  if(token!==benchmarkToken)return;const candidate=candidates[idx];$('compareStatus').textContent=`Obliczanie wariantu ${idx+1}/${candidates.length}: ${candidate.label}…`;await yieldUI();const settings={...p,cadr:candidate.pos?p.cadr:0,jet:candidate.pos?p.jet:0};const loc=candidate.pos||purifier;const vf=solveFlow(g,loc,settings);const filter=candidate.pos?buildIntake(g,loc):{weights:new Float64Array(g.n),efficiency:0};let c=initConcentration(g),b=new Float64Array(g.n);const dt=vf.scalarDt,steps=Math.ceil(time/dt);
  const chosen=[];let chosenVolume=0;
  for(let k=0;k<g.n;k++)if(g.ids[k]>=0&&(targetIndex<0||g.ids[k]===targetIndex)){chosen.push(k);chosenVolume+=g.cellVolumes[k];}
  const average=field=>{let sum=0;for(const k of chosen)sum+=field[k]*g.cellVolumes[k];return sum/Math.max(1e-12,chosenVolume);};
  let sumDose=0,lastAvg=average(c);
  for(let step=0;step<steps;step++){
   if(token!==benchmarkToken)return;
   const delta=Math.min(dt,time-step*dt);if(delta<=0)break;
   stepPM(g,c,b,vf,filter,settings,delta,null);[c,b]=[b,c];
   const nextAvg=average(c);
   sumDose+=(lastAvg+nextAvg)*.5*delta;lastAvg=nextAvg;
   if(step%480===0){$('compareProgress').style.width=fmt((idx+(step/steps))/candidates.length*100,0)+'%';await yieldUI();}
  }
  results.push({...candidate,final:lastAvg,dose:sumDose/time});$('compareProgress').style.width=fmt((idx+1)/candidates.length*100,0)+'%';
 }
 if(token!==benchmarkToken)return;rankingResults=results;drawRanking();$('compareStatus').textContent=`Wyniki dla ${Math.round(time/60)} min; im niższe stężenie w wybranym obszarze, tym lepiej. Ranking orientacyjny.`;setStatus('Porównanie ukończone: wszystkie warianty miały identyczne parametry początkowe.');
 }catch(e){setStatus('Błąd porównania: '+e.message,true);}finally{$('compare').disabled=false;}}
function drawRanking(){if(!rankingResults)return;const root=$('ranking');root.innerHTML='';const base=rankingResults[0],sort=rankingResults.slice(1).sort((a,b)=>a.dose-b.dose),max=Math.max(...rankingResults.map(r=>r.dose),.1);const p=document.createElement('p');p.className='comparison-meta';p.innerHTML=`Bez oczyszczacza: <strong>${fmt(base.final,1)} µg/m³</strong> po teście.` ;root.appendChild(p);
 sort.forEach((r,i)=>{const item=document.createElement('div');item.className='rankitem'+(i===0?' best':'');const gain=base.dose>0?100*(1-r.dose/base.dose):0;item.innerHTML=`<strong>${i+1}. ${escapeHtml(r.label)} <span class="muted">· ${fmt(r.final,1)} µg/m³</span></strong><div class="minibar"><div class="mini"><div style="width:${clamp(r.dose/max*100,0,100)}%"></div></div><span class="unit" style="min-width:50px">${gain>=0?'-':'+'}${fmt(Math.abs(gain),0)}%*</span></div><button>Ustaw</button>`;item.querySelector('button').addEventListener('click',()=>{placePurifier(r.pos.x,r.pos.y);setStatus(`Oczyszczacz ustawiony w pokoju: ${r.label}. Zachowano czas i aktualne stężenia.`);});root.appendChild(item);});const note=document.createElement('div');note.className='footnote';note.textContent='* Zmiana średniej ekspozycji względem wariantu bez filtra w czasie testu. Nie jest to zmierzona skuteczność urządzenia. Podobne wyniki należy traktować jako remis.';root.appendChild(note);}
$('preset').addEventListener('click',preset);$('newplan').addEventListener('click',emptyPlan);$('addRoom').addEventListener('click',()=>{if(rooms.length>=14)return alert('Model obsługuje maksymalnie 14 pokoi.');let pos=null;for(let y=0;y<=32&&!pos;y+=.5)for(let x=0;x<=32;x+=.5){const candidate={x,y,w:3,h:3};if(candidateValid(candidate,null)){pos=candidate;break;}}if(!pos){setStatus('Brak miejsca na pokój 3×3 m. Użyj narzędzia rysowania lub zmień układ.',true);return;}rooms.push(room('Nowy pokój',pos.x,pos.y,3,3,0));renderEditors();rebuild();setTool('move');});$('addDoor').addEventListener('click',()=>{if(rooms.length<2)return;const pairs=[];for(let i=0;i<rooms.length;i++)for(let j=i+1;j<rooms.length;j++)if(shared(rooms[i],rooms[j]))pairs.push([rooms[i],rooms[j]]);if(!pairs.length){setStatus('Najpierw ustaw pokoje tak, aby miały wspólną ścianę.',true);return;}let proposed=null;
 for(const [a,b] of pairs){
  const edge=shared(a,b),span=edge.to-edge.from;
  if(span<.3)continue;
  for(const width of [Math.min(1.2,span),Math.min(.8,span),Math.min(.5,span)]){
   if(width<.3)continue;
   for(const pos of [.5,.15,.85,.05,.95,.25,.75,.375,.625]){
    const candidate={id:uid(),a:a.id,b:b.id,width,pos,open:true,kind:'door',
     gapMm:DEFAULT_DOOR_GAP_MM,frameLeakCm2:DEFAULT_DOOR_FRAME_CM2};
    if(!passageOverlap(candidate)){proposed=candidate;break;}
   }
   if(proposed)break;
  }
  if(proposed)break;
 }
 if(!proposed){setTool('door');setStatus('Brak miejsca na nowe drzwi w automatycznie sprawdzonych punktach. Wskaż wolny odcinek wspólnej ściany.',true);return;}
 doors.push(proposed);renderDoors();reconfigureConnections();});
$('addOpening').addEventListener('click',()=>{setTool('opening');setStatus('Kliknij wspólną ścianę dwóch pokoi, aby dodać stały otwór.');});
$('addWindow').addEventListener('click',()=>{setTool('window');setStatus('Kliknij ścianę zewnętrzną pokoju, aby umieścić okno.');});
$('addSupply').addEventListener('click',()=>setTool('supply'));$('addExhaust').addEventListener('click',()=>setTool('exhaust'));
for(const k of Object.keys(DEFAULTS)){
 if(k==='outside')$(k).addEventListener('change',()=>changeOutdoorPM($(k).value));
 else if(k==='timeLimitEnabled'||k==='maxMinutes')$(k).addEventListener('change',()=>{
  if(k==='maxMinutes'){
   if($('maxMinutes').value.trim()===''){$('maxMinutes').value=userParameters.maxMinutes;setStatus('Podaj liczbę minut dla limitu czasu.',true);return;}
   userParameters.maxMinutes=num($('maxMinutes').value,60,1,525600);
   $('maxMinutes').value=userParameters.maxMinutes;
  }else userParameters.timeLimitEnabled=$('timeLimitEnabled').checked;
  syncTimeLimitControl();
  setStatus(userParameters.timeLimitEnabled?'Włączono ograniczenie: '+userParameters.maxMinutes+' min. Bieżący czas i stężenia zostały zachowane.':'Wyłączono ograniczenie czasu. Symulacja będzie działać do ręcznego zatrzymania, bez zerowania wyników.');
 });
 else if(k==='windFlowEnabled'||k==='windDirection')$(k).addEventListener('change',()=>reconfigureConnections());
 else $(k).addEventListener('change',()=>rebuild());
}

$('outsideQuick').addEventListener('change',()=>changeOutdoorPM($('outsideQuick').value));$('play').addEventListener('click',()=>{if(!grid)return;if(!playing&&elapsed>=simulationTimeLimit()-.001){setStatus('Limit czasu już osiągnięty. Zwiększ go, wyłącz ograniczenie albo użyj Reset, aby zacząć od nowa.',true);return;}playing=!playing;$('play').textContent=playing?'❚❚ Pauza':'▶ Start';setStatus(playing?'Symulacja działa.':'Symulacja zatrzymana.');});$('reset').addEventListener('click',reset);$('compare').addEventListener('click',runComparison);$('targetRoom').addEventListener('change',()=>{benchmarkToken++;rankingResults=null;$('compare').disabled=false;$('ranking').innerHTML='';$('compareProgress').style.width='0';$('compareStatus').textContent='Zmieniono cel porównania. Uruchom test ponownie.';});$('screenshot').addEventListener('click',()=>{render(performance.now());canvas.toBlob(b=>{if(b)download('aeroplan-symulacja.png',b);},'image/png');});
for(const btn of document.querySelectorAll('[data-view]'))btn.addEventListener('click',()=>{view=btn.dataset.view;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b===btn));render(performance.now());});
document.querySelectorAll('[data-tool]').forEach(btn=>btn.addEventListener('click',()=>{setTool(btn.dataset.tool);if(btn.dataset.tool==='delete')setStatus('Tryb usuwania: najedź na okno, drzwi lub stały otwór i kliknij podświetlony element. Kliknięcie pokoju wyświetli potwierdzenie.');}));
$('editorSpan').addEventListener('change',()=>render(performance.now()));
$('snapToGrid').addEventListener('change',()=>{setStatus($('snapToGrid').checked?'Włączono skok co 0,5 m.':'Wyłączono skok siatki: możesz rysować i przesuwać z dokładnością 1 cm.');render(performance.now());});
$('magnetWalls').addEventListener('change',()=>render(performance.now()));
$('cancelRoomDelete').addEventListener('click',closeDeleteDialog);
$('confirmRoomDelete').addEventListener('click',deleteSelectedRoom);
$('roomDeleteDialog').addEventListener('click',e=>{if(e.target===$('roomDeleteDialog'))closeDeleteDialog();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('roomDeleteDialog').hidden)closeDeleteDialog();});
canvas.addEventListener('pointerdown',e=>{
 if(e.button!==0||!viewTransform)return;
 const raw=canvasXY(e),pos=magnetPoint(gridPoint(raw));
 if(editorMode==='purifier'){
  if(!grid)return;
  const passage=hitPassage(raw);if(passage){togglePassage(passage);return;}
  const window=hitWindow(raw);if(window){toggleWindow(window);return;}
  dragging=true;canvas.setPointerCapture(e.pointerId);
  // Move once on pointer up to avoid a complete CFD solve at each mousemove.
  const circleHit=Math.hypot(raw.x-purifier.x,raw.y-purifier.y)<=purifierRadius()+.08;
  const origin=circleHit?hitRoom(purifier.x,purifier.y):null;
  editorGesture={kind:'purifier',x:raw.x,y:raw.y,roomId:origin?.id||null};return;
 }
 if(editorMode==='door'||editorMode==='opening'){createDoorAt(raw,editorMode);return;}
 if(editorMode==='supply'||editorMode==='exhaust'){addVentAt(raw,editorMode);return;}
 if(editorMode==='item'){
  const v=hitVent(raw),d=hitPassage(raw),w=hitWindow(raw);let type=null,target=null;
  // If wall segment and nearby vent overlap, prefer the vent only when the cursor is truly on it.
  if(v){type='vent';target=v;}else if(d){type='door';target=d;}else if(w){type='window';target=w;}
  if(!target){setStatus('Najedź na drzwi, otwór, okno lub kratkę i przeciągnij element.',true);return;}
  const base=type==='vent'?{x:target.x,y:target.y}:{pos:target.pos};
  editorGesture={kind:'move-item',itemType:type,id:target.id,preview:base};canvas.setPointerCapture(e.pointerId);render(performance.now());return;
 }
 if(editorMode==='window'){createWindowAt(raw);return;}
 if(editorMode==='delete'){
  const hit=planElementHit(raw);if(!hit){setStatus('Najedź na okno, drzwi, otwór lub pokój i kliknij, aby usunąć.');return;}
  deletePlanElement(hit);return;
 }
 if(editorMode==='room'){
  if(rooms.length>=14){setStatus('Limit: maksymalnie 14 pomieszczeń.',true);return;}
  editorGesture={kind:'room',start:pos,end:pos};
 }else if(editorMode==='move'){
  const hit=hitRoom(raw.x,raw.y);if(!hit){setStatus('Przeciągnij wnętrze istniejącego pomieszczenia.');return;}
  selectRoom(hit.id);editorGesture={kind:'move',roomId:hit.id,startRaw:raw,original:{x:hit.x,y:hit.y,w:hit.w,h:hit.h},preview:{x:hit.x,y:hit.y,w:hit.w,h:hit.h}};
 }
 if(editorGesture){canvas.setPointerCapture(e.pointerId);render(performance.now());}
});
function updateEditorGesture(e){
 if(!editorGesture||!viewTransform)return;
 const raw=canvasXY(e),pos=magnetPoint(gridPoint(raw));
 if(editorGesture.kind==='room')editorGesture.end=pos;
 else if(editorGesture.kind==='move'){const g=editorGesture;const dx=raw.x-g.startRaw.x,dy=raw.y-g.startRaw.y;const target={...g.original,x:cm(clamp(useGrid()?snap(g.original.x+dx):g.original.x+dx,0,35-g.original.w)),y:cm(clamp(useGrid()?snap(g.original.y+dy):g.original.y+dy,0,35-g.original.h))};g.preview=magnetMove(target,g.roomId);}
 else if(editorGesture.kind==='purifier'){editorGesture.x=raw.x;editorGesture.y=raw.y;}
 else if(editorGesture.kind==='move-item'){const g=editorGesture;
  if(g.itemType==='vent'){const v=vents.find(x=>x.id===g.id),r=v&&rooms.find(x=>x.id===v.roomId);if(r)g.preview={x:cm(clamp(raw.x-r.x,.05,r.w-.05)),y:cm(clamp(raw.y-r.y,.05,r.h-.05))};}
  else if(g.itemType==='door'){const d=doors.find(x=>x.id===g.id),a=d&&rooms.find(r=>r.id===d.a),b=d&&rooms.find(r=>r.id===d.b),edge=a&&b?shared(a,b):null;
   if(edge){const along=edge.axis==='x'?raw.y:raw.x,span=edge.to-edge.from,w=Math.min(d.width,span);g.preview={pos:cm(clamp((along-edge.from)/span,w/(2*span),1-w/(2*span)))};}}
  else if(g.itemType==='window'){const w=windows.find(x=>x.id===g.id),r=w&&rooms.find(r=>r.id===w.roomId);if(r){const along=(w.side==='left'||w.side==='right')?raw.y:raw.x,start=(w.side==='left'||w.side==='right')?r.y:r.x,len=(w.side==='left'||w.side==='right')?r.h:r.w;g.preview={pos:cm(clamp((along-start)/len,0,1))};}}
 }
 render(performance.now());
}
function endCanvasGesture(e,cancel=false){
 const g=editorGesture;editorGesture=null;dragging=false;if(!g)return;
 if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
 if(cancel){render(performance.now());return;}
 if(g.kind==='purifier'){if(grid)placePurifier(g.x,g.y,g.roomId);return;}
 if(g.kind==='move-item'){const arr=g.itemType==='vent'?vents:g.itemType==='door'?doors:windows,element=arr.find(x=>x.id===g.id);if(!element)return;
  if(g.itemType==='door'&&passageOverlap(element,g.preview.pos)){setStatus('Nie można przesunąć przejścia na inne drzwi/otwór. Przesunięcie anulowane.',true);render(performance.now());return;}
  if(g.itemType==='window'&&!validWindow({...element,pos:g.preview.pos},rooms,windows)){setStatus('Okno wyjdzie poza ścianę zewnętrzną albo nachodzi na inne. Przesunięcie anulowane.',true);render(performance.now());return;}
  Object.assign(element,g.preview);if(g.itemType==='door')renderDoors();else if(g.itemType==='vent')renderVents();else renderWindows();
  reconfigureConnections();setStatus('Przesunięto element. Zachowano czas i aktualne stężenia.');return;
 }
 if(g.kind==='room'){
  const r=rectDrag(g.start,g.end);
  if(r.w<.5||r.h<.5){setStatus('Za mały pokój. Przeciągnij co najmniej 0,5 m w każdym kierunku.',true);render(performance.now());return;}
  if(!candidateValid(r,null)){setStatus('Nie można dodać pokoju: nakłada się na inny albo wychodzi poza zakres 35 m.',true);render(performance.now());return;}
  const created=room('Pokój '+(rooms.length+1),r.x,r.y,cm(r.w),cm(r.h),0);rooms.push(created);selectedRoomId=created.id;renderEditors();rebuild();setStatus('Narysowano pokój. Nadaj mu nazwę w panelu po lewej, a potem dodaj kolejny.');return;
 }
 if(g.kind==='move'){
  const moving=rooms.find(r=>r.id===g.roomId);
  if(!moving)return;
  if(!candidateValid(g.preview,g.roomId)){setStatus('Nie przesunięto pokoju: kolizja lub wyjście poza plan. Zmiana cofnięta.',true);render(performance.now());return;}
  try{
   const hypothetical=rooms.map(r=>r.id===g.roomId?{...r,...g.preview}:r);
   validateAttachedPassages(hypothetical);
   for(const w of windows)if(!validWindow(w,hypothetical,windows))throw Error('Przeniesienie pokoju odłączyłoby okno od ściany zewnętrznej.');
  }catch(error){setStatus(error.message+' Przesunięcie anulowane.',true);render(performance.now());return;}
  Object.assign(moving,{x:cm(g.preview.x),y:cm(g.preview.y)});renderEditors();rebuild();setStatus('Przesunięto „'+moving.name+'” na X='+fmt(moving.x,2)+' m, Y='+fmt(moving.y,2)+' m. Sprawdź połączenia drzwi.');
 }
}
canvas.addEventListener('pointerup',e=>endCanvasGesture(e));
function updateEditorHover(e){
 if(editorGesture||!viewTransform||!['delete','window','item'].includes(editorMode))return;
 const p=canvasXY(e);
 if(editorMode==='item'){const hit=hitVent(p)||hitPassage(p)||hitWindow(p);canvas.style.cursor=hit?'grab':'crosshair';return;}
 if(editorMode==='delete'){
  const hit=planElementHit(p);
  const was=editorHover;
  editorHover=hit;
  canvas.style.cursor=hit?'pointer':'crosshair';
  if(hit?.kind!==was?.kind||hit?.id!==was?.id)render(performance.now());
 }else{
  const proposal=windowProposal(p);
  const old=editorHover;
  editorHover={kind:'window-preview',proposal};
  canvas.style.cursor=proposal.ok?'pointer':'crosshair';
  const g=proposal.ok?windowGeometry(proposal.w):null,oldg=old?.proposal?.ok?windowGeometry(old.proposal.w):null;
  if(g?.center!==oldg?.center||g?.side!==oldg?.side||g?.r?.id!==oldg?.r?.id||!!g!==!!oldg)render(performance.now());
 }
}
function updateCanvasProbe(e){
 if(!grid||!concentration||!viewTransform)return;
 const p=canvasXY(e),k=indexAt(p.x,p.y);
 const probe=$('localProbe');if(!probe)return;
 if(k<0){probe.textContent='Najedź myszką na pokój, aby odczytać lokalne PM₂.₅ (bez uśredniania).';return;}
 const ri=grid.ids[k],x=(k%grid.nx+.5)*grid.step,y=(Math.floor(k/grid.nx)+.5)*grid.step;
 probe.textContent=`${rooms[ri].name} · PM₂.₅ w komórce: ${fmt(concentration[k],1)} µg/m³ · Pokoju ciśnienie: ${fmt(grid.pressureResult?.pressures?.[ri]||0,2)} Pa · środek komórki: (${fmt(x,2)}, ${fmt(y,2)}) m · bok siatki: ${fmt(grid.step,2)} m`;
}
// One pointermove listener owns drag previews, hover feedback and live PM probe.
canvas.addEventListener('pointermove',e=>{
 updateEditorGesture(e);
 updateEditorHover(e);
 updateCanvasProbe(e);
});
canvas.addEventListener('pointerleave',()=>{editorHover=null;canvas.style.cursor='crosshair';if(['delete','window','item'].includes(editorMode)&&!editorGesture)render(performance.now());});
canvas.addEventListener('pointercancel',e=>endCanvasGesture(e,true));

// Parameters have a single source of range constraints, shared by the UI and JSON import.
const INPUT_LIMITS={
 height:[2,6],mixing:[0,.15],initial:[0,1000],outside:[0,1000],ach:[0,5],
 deposition:[0,3],deltaP:[0,100],windDirection:[0,360],windSpeed:[0,20],
 gustPercent:[0,90],gustPeriod:[30,3600],gridStep:[.12,.35],
 pmPenetration:[0,1],maxWindowAch:[0,30],cadr:[0,1800],
 purifierDiameter:[.2,1.2],jet:[0,2],orientation:[0,360],maxMinutes:[1,525600]
};
const BOOLEAN_PARAMETERS=new Set(['windFlowEnabled','timeLimitEnabled']);
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function importNumeric(record,key,fallback,min,max){
 const value=record[key];
 if(value===undefined)return fallback; // compatibility with older exports
 if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)
  throw Error(`Niepoprawna wartość ${key}: oczekiwano liczby w zakresie ${min}–${max}.`);
 return value;
}
function parseImportDocument(doc){
 if(!isRecord(doc))throw Error('Plik JSON musi zawierać obiekt konfiguracji.');
 if(!Array.isArray(doc.rooms)||doc.rooms.length>14)throw Error('Niepoprawna lista pokojów (maksymalnie 14).');
 const params={...DEFAULTS};
 if(doc.parameters!==undefined){
  if(!isRecord(doc.parameters))throw Error('Niepoprawne parametry symulacji.');
  for(const [key,value] of Object.entries(doc.parameters)){
   if(!Object.prototype.hasOwnProperty.call(DEFAULTS,key))continue; // newer format
   if(BOOLEAN_PARAMETERS.has(key)){
    if(typeof value!=='boolean')throw Error('Niepoprawny parametr logiczny: '+key);
   }else{
    const [lo,hi]=INPUT_LIMITS[key];
    if(typeof value!=='number'||!Number.isFinite(value)||value<lo||value>hi)
     throw Error(`Parametr ${key} musi mieścić się w zakresie ${lo}–${hi}.`);
   }
   params[key]=value;
  }
 }
 const rr=doc.rooms.map((r,i)=>{
  if(!isRecord(r))throw Error('Niepoprawny pokój numer '+(i+1));
  const w=importNumeric(r,'w',3,.5,MAX_SPAN),h=importNumeric(r,'h',3,.5,MAX_SPAN);
  return {
   id:r.id===undefined?uid():String(r.id),name:String(r.name??'Pokój').slice(0,36),
   x:importNumeric(r,'x',0,0,MAX_SPAN),y:importNumeric(r,'y',0,0,MAX_SPAN),w,h,
   emission:importNumeric(r,'emission',0,0,100000),extraAch:importNumeric(r,'extraAch',0,0,5),
   supplyM3h:importNumeric(r,'supplyM3h',0,0,600),exhaustM3h:importNumeric(r,'exhaustM3h',0,0,600),
   supplyX:importNumeric(r,'supplyX',.3,0,MAX_SPAN),supplyY:importNumeric(r,'supplyY',.3,0,MAX_SPAN),
   exhaustX:importNumeric(r,'exhaustX',Math.max(.3,w-.3),0,MAX_SPAN),
   exhaustY:importNumeric(r,'exhaustY',Math.max(.3,h-.3),0,MAX_SPAN)
  };
 });
 if(rr.some(r=>!r.id))throw Error('Identyfikator pokoju nie może być pusty.');
 validateRooms(rr);
 const roomIds=new Set(rr.map(r=>r.id));
 const rawDoors=doc.doors??[],rawWindows=doc.windows??[],rawVents=doc.vents??[];
 if(!Array.isArray(rawDoors)||rawDoors.length>100)throw Error('Niepoprawna lista przejść.');
 if(!Array.isArray(rawWindows)||rawWindows.length>100)throw Error('Niepoprawna lista okien.');
 if(!Array.isArray(rawVents)||rawVents.length>80)throw Error('Niepoprawna lista kratek (maksymalnie 80).');
 const dd=rawDoors.map((d,i)=>{
  if(!isRecord(d)||!roomIds.has(String(d.a))||!roomIds.has(String(d.b)))
   throw Error('Przejście '+(i+1)+' odwołuje się do nieistniejącego pokoju.');
  if(d.open!==undefined&&typeof d.open!=='boolean')throw Error('Niepoprawny stan drzwi.');
  if(d.kind!==undefined&&!['door','opening'].includes(d.kind))throw Error('Niepoprawny typ przejścia.');
  return {id:uid(),a:String(d.a),b:String(d.b),width:importNumeric(d,'width',1,.3,8),
   pos:importNumeric(d,'pos',.5,0,1),open:d.kind==='opening'||d.open!==false,
   kind:d.kind==='opening'?'opening':'door',
   gapMm:importNumeric(d,'gapMm',DEFAULT_DOOR_GAP_MM,0,35),
   frameLeakCm2:importNumeric(d,'frameLeakCm2',DEFAULT_DOOR_FRAME_CM2,0,200)};
 });
 for(const d of dd){
  const a=rr.find(r=>r.id===d.a),b=rr.find(r=>r.id===d.b),edge=shared(a,b);
  if(!edge)throw Error('Przejście nie łączy sąsiadujących pokojów.');
  if(d.width>edge.to-edge.from+.01)throw Error('Przejście jest szersze niż wspólna ściana.');
  if(passageOverlap(d,d.pos,rr,dd))throw Error('Przejścia nakładają się na wspólnej ścianie.');
 }
 const ww=rawWindows.map((w,i)=>{
  if(!isRecord(w)||!roomIds.has(String(w.roomId)))
   throw Error('Okno '+(i+1)+' odwołuje się do nieistniejącego pokoju.');
  if(w.side!==undefined&&!['left','right','top','bottom'].includes(w.side))throw Error('Niepoprawna ściana okna.');
  if(w.state!==undefined&&!['closed','tilt','open'].includes(w.state))throw Error('Niepoprawny stan okna.');
  return {id:uid(),roomId:String(w.roomId),side:w.side??'top',pos:importNumeric(w,'pos',.5,0,1),
   width:importNumeric(w,'width',1.2,.3,5),height:importNumeric(w,'height',1.35,.3,3),
   state:w.state??'closed',q100:importNumeric(w,'q100',3,0,100),
   gapMm:importNumeric(w,'gapMm',5,0,50),openPercent:importNumeric(w,'openPercent',10,0,100)};
 });
 for(const w of ww)if(!validWindow(w,rr,ww))
  throw Error('Nieprawidłowa geometria albo nakładające się okna.');
 const vv=rawVents.map((v,i)=>{
  if(!isRecord(v)||!roomIds.has(String(v.roomId)))
   throw Error('Kratka '+(i+1)+' odwołuje się do nieistniejącego pokoju.');
  if(!['supply','exhaust'].includes(v.type))throw Error('Niepoprawny typ kratki.');
  const r=rr.find(r=>r.id===String(v.roomId));
  return {id:uid(),roomId:r.id,type:v.type,rate:importNumeric(v,'rate',0,0,600),
   x:cm(clamp(importNumeric(v,'x',r.w*.5,0,MAX_SPAN),.05,Math.max(.05,r.w-.05))),
   y:cm(clamp(importNumeric(v,'y',r.h*.5,0,MAX_SPAN),.05,Math.max(.05,r.h-.05)))};
 });
 if(rr.length&&!rr.some(r=>r.w>=params.purifierDiameter&&r.h>=params.purifierDiameter))
  throw Error('Żaden pokój nie mieści oczyszczacza o zadanej średnicy.');
 const p=isRecord(doc.purifier)?doc.purifier:{};
 const position={x:importNumeric(p,'x',1,0,MAX_SPAN),y:importNumeric(p,'y',1,0,MAX_SPAN)};
 if(doc.outsideManual!==undefined&&typeof doc.outsideManual!=='boolean')
  throw Error('Niepoprawna informacja o odczycie zewnętrznym.');
 return {rooms:rr,doors:dd,windows:ww,vents:vv,purifier:position,
  parameters:params,outsideManual:doc.outsideManual===true};
}
function restoreImportSnapshot(saved){
 ({rooms,doors,windows,vents,purifier,userParameters,outsideManual,selectedRoomId,grid,
  concentration,buffer,velocity,intake,elapsed,removed,clippedMass,playing,lastGustUpdate,weatherDiagnostics,rankingResults}=saved);
 syncFields();renderEditors();
 if(rankingResults)drawRanking();else $('ranking').innerHTML='';
 $('compareStatus').textContent=saved.compareStatus;
 updateMetrics();render(performance.now());
 $('play').disabled=!grid;$('compare').disabled=!grid;
 $('play').textContent=playing?'❚❚ Pauza':'▶ Start';
}
function applyImportedDocument(doc){
 // Validate every field before touching the currently running simulation.
 const prepared=parseImportDocument(doc);
 const saved={rooms,doors,windows,vents,purifier,userParameters,outsideManual,selectedRoomId,grid,
  concentration,buffer,velocity,intake,elapsed,removed,clippedMass,playing,lastGustUpdate,weatherDiagnostics,
  rankingResults,compareStatus:$('compareStatus').textContent};
 try{
  rooms=prepared.rooms;doors=prepared.doors;windows=prepared.windows;vents=prepared.vents;
  purifier=prepared.purifier;userParameters=prepared.parameters;outsideManual=prepared.outsideManual;
  selectedRoomId=null;syncFields();renderEditors();rebuild();
  if(rooms.length&&!grid)throw Error('Wczytana konfiguracja nie tworzy poprawnego modelu siatki i przepływu.');
 }catch(error){
  restoreImportSnapshot(saved);throw error;
 }
}
// The local library stores configuration, not computed PM fields or time-series.
// JSON export remains the portable backup and uses exactly the same project schema.
const LOCAL_PROJECTS_KEY='aeroplan.projects.v1', LOCAL_DRAFT_KEY='aeroplan.draft.v1';
const MAX_LOCAL_PROJECTS=20;
let localStorageOK=false,autosaveTimer=null,restoringDraft=false;
function currentProjectDocument(){
 getInputs();
 return {version:7,rooms,doors,windows,vents,purifier,parameters:userParameters,outsideManual};
}
function savedProjectList(){
 const raw=localStorage.getItem(LOCAL_PROJECTS_KEY);
 if(raw===null)return [];
 const list=JSON.parse(raw);
 if(!Array.isArray(list)||list.length>MAX_LOCAL_PROJECTS||list.some(x=>
   !isRecord(x)||typeof x.id!=='string'||typeof x.name!=='string'||!isRecord(x.doc)))
  throw Error('Niepoprawne dane zapisanych projektów. Wyeksportuj kopię JSON i sprawdź pamięć przeglądarki.');
 return list;
}
function localInfo(message,failed=false){
 const node=$('localSaveInfo');node.textContent=message;node.classList.toggle('error',failed);
}
function refreshSavedProjects(chosenId=null){
 const select=$('savedProjects'),previous=chosenId??select.value;
 const list=savedProjectList();select.replaceChildren();
 const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=list.length?'Wybierz zapisany projekt…':'Brak zapisanych projektów';select.appendChild(placeholder);
 for(const item of list.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))){
  const opt=document.createElement('option');opt.value=item.id;
  opt.textContent=item.name+(Number.isFinite(item.updatedAt)?' · '+new Date(item.updatedAt).toLocaleString('pl-PL'):'');
  select.appendChild(opt);
 }
 select.value=list.some(x=>x.id===previous)?previous:'';
 $('loadLocal').disabled=$('deleteLocal').disabled=!select.value;
 return list;
}
function storageWrite(key,value){
 localStorage.setItem(key,JSON.stringify(value));
}
function persistCurrentDraft(){
 if(!localStorageOK||restoringDraft)return;
 try{
  storageWrite(LOCAL_DRAFT_KEY,{savedAt:Date.now(),name:$('projectName').value.slice(0,60),doc:currentProjectDocument()});
  localInfo('Ostatnia konfiguracja zapisana automatycznie w tej przeglądarce.');
 }catch(error){localInfo('Automatyczny zapis nie powiódł się: '+error.message+'. Eksportuj projekt do JSON.',true);}
}
function queueDraftSave(){
 if(!localStorageOK||restoringDraft)return;
 clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>{autosaveTimer=null;persistCurrentDraft();},550);
}
function saveNamedProject(){
 if(!localStorageOK)return;
 const name=$('projectName').value.trim().slice(0,60);
 if(!name){localInfo('Wpisz nazwę projektu, aby go zapisać.',true);$('projectName').focus();return;}
 try{
  const doc=currentProjectDocument();parseImportDocument(doc); // reject invalid geometry
  const list=savedProjectList(),existing=list.find(p=>p.name.toLocaleLowerCase('pl-PL')===name.toLocaleLowerCase('pl-PL'));
  if(existing&&!confirm('Nadpisać zapisany projekt „'+existing.name+'”?'))return;
  if(!existing&&list.length>=MAX_LOCAL_PROJECTS)throw Error('Limit 20 projektów. Usuń zbędny zapis lub eksportuj go do JSON.');
  const entry={id:existing?.id||uid(),name,updatedAt:Date.now(),doc};
  const next=existing?list.map(p=>p.id===existing.id?entry:p):[...list,entry];
  storageWrite(LOCAL_PROJECTS_KEY,next);
  refreshSavedProjects(entry.id);persistCurrentDraft();
  localInfo('Zapisano projekt „'+name+'”. Możesz go wczytać po ponownym otwarciu aplikacji.');
  setStatus('Zapisano konfigurację projektu „'+name+'” w tej przeglądarce.');
 }catch(error){localInfo('Nie udało się zapisać projektu: '+error.message+'. Możesz użyć eksportu JSON.',true);}
}
function loadNamedProject(){
 if(!localStorageOK)return;
 const id=$('savedProjects').value;if(!id)return;
 try{
  const entry=savedProjectList().find(x=>x.id===id);if(!entry)throw Error('Nie znaleziono wybranego projektu.');
  if(!confirm('Wczytać „'+entry.name+'”? Zastąpi to bieżący plan i parametry. Zapisz je wcześniej, jeśli chcesz je zachować.'))return;
  applyImportedDocument(entry.doc); // transactional import, never partially alters state
  $('projectName').value=entry.name;
  clearTimeout(autosaveTimer);autosaveTimer=null;
  persistCurrentDraft();
  localInfo('Wczytano projekt „'+entry.name+'”. Zachowano układ oraz ustawienia oczyszczacza.');
  setStatus('Wczytano zapisany projekt „'+entry.name+'”. Symulacja rozpoczyna się od początku.');
 }catch(error){localInfo('Nie udało się wczytać projektu: '+error.message+'. Bieżący plan zachowano.',true);}
}
function deleteNamedProject(){
 if(!localStorageOK)return;
 try{
  const id=$('savedProjects').value,projects=savedProjectList(),entry=projects.find(x=>x.id===id);
  if(!entry)return;
  if(!confirm('Usunąć zapis „'+entry.name+'”? Ta operacja nie usuwa bieżącego planu.'))return;
  storageWrite(LOCAL_PROJECTS_KEY,projects.filter(x=>x.id!==id));refreshSavedProjects('');
  localInfo('Usunięto zapis „'+entry.name+'”. Bieżący plan pozostał bez zmian.');
 }catch(error){localInfo('Nie udało się usunąć zapisu: '+error.message,true);}
}
function initializeLocalStorage(){
 try{
  const check='aeroplan.storage-check';localStorage.setItem(check,'1');localStorage.removeItem(check);
  localStorageOK=true;refreshSavedProjects();
  const raw=localStorage.getItem(LOCAL_DRAFT_KEY);
  if(raw){
   try{
    const draft=JSON.parse(raw);
    if(!isRecord(draft)||!isRecord(draft.doc))throw Error('Niepoprawny format ostatniej sesji.');
    restoringDraft=true;
    try{applyImportedDocument(draft.doc);}finally{restoringDraft=false;}
    if(typeof draft.name==='string'&&draft.name.trim())$('projectName').value=draft.name.slice(0,60);
    localInfo('Przywrócono ostatni plan i parametry z tej przeglądarki.');
    setStatus('Przywrócono ostatnio zapisany układ mieszkania i ustawienia oczyszczacza.');
   }catch(error){restoringDraft=false;localInfo('Nie udało się przywrócić ostatniej sesji: '+error.message+'. Dostępne są zapisane projekty i import JSON.',true);}
  }
 }catch(error){
  localStorageOK=false;
  for(const id of ['projectName','saveLocal','loadLocal','deleteLocal','savedProjects'])$(id).disabled=true;
  localInfo('Pamięć przeglądarki jest niedostępna. Użyj eksportu i importu JSON, aby zachować swoje projekty.',true);
 }
}
$('saveLocal').addEventListener('click',saveNamedProject);
$('loadLocal').addEventListener('click',loadNamedProject);
$('deleteLocal').addEventListener('click',deleteNamedProject);
$('savedProjects').addEventListener('change',()=>{
 const entry=savedProjectList().find(p=>p.id===$('savedProjects').value);
 if(entry)$('projectName').value=entry.name;
 $('loadLocal').disabled=$('deleteLocal').disabled=!entry;
});
// All UI editors change the model before these bubbling document handlers run.
// Pointer release also covers canvas dragging and toggling windows/doors.
document.addEventListener('change',e=>{
 if(e.target.closest('.local-projects')||e.target.id==='jsonFile')return;
 queueDraftSave();
});
document.addEventListener('click',e=>{
 if(!e.target.closest('.local-projects'))queueDraftSave();
});
document.addEventListener('pointerup',e=>{
 if(e.target===canvas)queueDraftSave();
});
window.addEventListener('pagehide',()=>{clearTimeout(autosaveTimer);persistCurrentDraft();});
$('saveJson').addEventListener('click',()=>{
 const data=currentProjectDocument();
 download('aeroplan-mieszkanie.json',new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}));
});
$('loadJson').addEventListener('click',()=>$('jsonFile').click());
$('jsonFile').addEventListener('change',async e=>{
 const file=e.target.files?.[0];if(!file)return;
 try{
  if(file.size>5*1024*1024)throw Error('Plik jest zbyt duży (limit 5 MB).');
  applyImportedDocument(JSON.parse(await file.text()));
  persistCurrentDraft();
  setStatus('Zaimportowano konfigurację.');
 }catch(error){setStatus('Nie udało się zaimportować JSON: '+error.message,true);}
 e.target.value='';
});
 preset();initializeLocalStorage();requestAnimationFrame(tick);
})();

