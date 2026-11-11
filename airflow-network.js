/* AeroPlan multizone pressure network. Wind pressures, large openings and leakage.
 * NIST CONTAM/ASHRAE-style pressure-flow laws, not building CFD or calibrated Cp.
 * Each room is assumed to have a single reference pressure (Pa).
 */
(function(root){'use strict';
 const rho=1.204, EPS=.015;
 const bounded=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
 const sign=x=>x<0?-1:1;
 function powerFlow(dp,coefficient,exponent,limit=Infinity){
  if(!coefficient||limit===0||!Number.isFinite(dp))return 0;
  // Smooth derivative at zero without the several-percent offset at normal pressure drops.
  // For |dp| >> EPS this tends to coefficient * |dp|**exponent.
  const magnitude=coefficient*Math.abs(dp)*Math.pow(dp*dp+EPS*EPS,(exponent-1)/2);
  return sign(dp)*(Number.isFinite(limit)&&limit>0?limit*Math.tanh(Math.max(0,magnitude)/limit):Math.max(0,magnitude));
 }
 function cp(side,angle){
  const normals={left:0,right:Math.PI,top:Math.PI/2,bottom:-Math.PI/2};
  const cos=Math.cos(angle-normals[side]);
  // Exposed simplified facade coefficients. Tune only with exterior measurements.
  return cos>=0?0.6*cos:-.3*Math.abs(cos);
 }
 function solve(input){
  const {rooms,windows=[],doors=[],vents=[],windSpeed=0,windDirection=0,backgroundAch=0,height=2.6}=input;
  const n=rooms.length,pressures=new Float64Array(n);
  const angle=windDirection*Math.PI/180,windPa=.5*rho*windSpeed*windSpeed;
  const external=[];
  const internal=[];
  const qFixed=new Float64Array(n);
  // q: positive means outside -> inside, pressure drop = exterior - indoor.
  windows.forEach((w,i)=>{
   if(w.roomIndex<0||w.roomIndex>=n||w.area<=0)return;
   const base=w.state==='closed'?
     Math.max(0,w.q100||0)*w.area/Math.pow(100,.67):
     .60*Math.max(0,w.openArea||0)*Math.sqrt(2/rho)*3600;
   const exponent=w.state==='closed'?.67:.5;
   const extPressure=windPa*cp(w.side,angle);
   external.push({id:w.id,kind:'window',index:i,room:w.roomIndex,base,exponent,extPressure,
    limit:w.state==='closed'?Infinity:(w.maxQ??Infinity),penetration:w.penetration??1});
  });
  // Background envelope leakage is pressure driven; unmeasured two-way air exchange is separate.
  rooms.forEach((room,i)=>{
   const ach=Math.max(0,backgroundAch+Number(room.extraAch||0));
   if(ach<=0)return;
   const referenceQ=ach*room.w*room.h*height;
   const base=referenceQ/Math.pow(4,.65);
   external.push({id:'leak-'+i,kind:'leak',index:i,room:i,base,exponent:.65,extPressure:0,
    limit:Infinity,penetration:input.pmPenetration??.8});
  });
  doors.forEach((d,i)=>{
   if(d.a<0||d.b<0||d.a>=n||d.b>=n||d.a===d.b||!d.area)return;
   internal.push({id:d.id,index:i,a:d.a,b:d.b,base:.60*d.area*Math.sqrt(2/rho)*3600,exponent:.5});
  });
  vents.forEach((v,i)=>{
   if(v.roomIndex<0||v.roomIndex>=n)return;
   const flow=Math.max(0,v.rate||0)*(v.type==='exhaust'?-1:1);
   qFixed[v.roomIndex]+=flow;
  });
  const flowExternal=(link,press)=>powerFlow(link.extPressure-press,link.base,link.exponent,link.limit);
  const flowDoor=(link,pa,pb)=>powerFlow(pa-pb,link.base,link.exponent);
  // Newton pressure solve for the connected flow network (Jacobian is symmetric).
  // The external ground node fixes reference pressure; isolated components are regularized.
  function evaluate(matrix=false){
   const residual=new Float64Array(n),diag=matrix?Array.from({length:n},()=>new Float64Array(n)):null;
   for(let i=0;i<n;i++)residual[i]=qFixed[i];
   for(const link of external){
    const dp=link.extPressure-pressures[link.room],q=flowExternal(link,pressures[link.room]);
    residual[link.room]+=q;
    if(diag){const frac=Number.isFinite(link.limit)&&link.limit>0?q/link.limit:0;
     const derivative=link.limit===0?0:link.base*Math.pow(dp*dp+EPS*EPS,(link.exponent-3)/2)*(EPS*EPS+link.exponent*dp*dp)*(1-Math.min(.99999999,frac*frac));
     diag[link.room][link.room]+=derivative;
    }
   }
   for(const link of internal){
    const dp=pressures[link.a]-pressures[link.b],q=flowDoor(link,pressures[link.a],pressures[link.b]);
    residual[link.a]-=q;residual[link.b]+=q;
    if(diag){const derivative=link.base*Math.pow(dp*dp+EPS*EPS,(link.exponent-3)/2)*(EPS*EPS+link.exponent*dp*dp);
     diag[link.a][link.a]+=derivative;diag[link.b][link.b]+=derivative;
     diag[link.a][link.b]-=derivative;diag[link.b][link.a]-=derivative;
    }
   }
   let error=0;for(let i=0;i<n;i++)error=Math.max(error,Math.abs(residual[i]));
   return {residual,matrix:diag,error};
  }
  function linearSolve(mat,rhs){
   const a=mat.map((row,i)=>Float64Array.from([...row,rhs[i]])),N=rhs.length;
   for(let i=0;i<N;i++){
    let pivot=i;for(let k=i+1;k<N;k++)if(Math.abs(a[k][i])>Math.abs(a[pivot][i]))pivot=k;
    if(pivot!==i)[a[i],a[pivot]]=[a[pivot],a[i]];
    if(Math.abs(a[i][i])<1e-10)return null;
    for(let j=i+1;j<N;j++){const ratio=a[j][i]/a[i][i];if(!ratio)continue;
     for(let k=i;k<=N;k++)a[j][k]-=ratio*a[i][k];
    }
   }
   const x=new Float64Array(N);for(let i=N-1;i>=0;i--){let val=a[i][N];for(let k=i+1;k<N;k++)val-=a[i][k]*x[k];x[i]=val/a[i][i];}
   return x;
  }
  let iterations=0,maxResidual=Infinity;
  for(let it=0;it<90;it++){
   const evaluated=evaluate(true);maxResidual=evaluated.error;iterations=it+1;
   if(maxResidual<1e-5)break;
   for(let i=0;i<n;i++)evaluated.matrix[i][i]+=1e-5;
   const delta=linearSolve(evaluated.matrix,evaluated.residual);if(!delta)break;
   const saved=Float64Array.from(pressures);let improved=false;
   for(let alpha=1;alpha>=1/1024;alpha/=2){
    for(let i=0;i<n;i++)pressures[i]=bounded(saved[i]+alpha*delta[i],-1000,1000);
    if(evaluate(false).error<maxResidual){improved=true;break;}
   }
   if(!improved){pressures.set(saved);break;}
  }
  maxResidual=evaluate(false).error;
  const windowFlows={},leakFlows={},doorFlows={},ventFlows={};
  for(const link of external){const q=flowExternal(link,pressures[link.room]);if(link.kind==='window')windowFlows[link.id]=q;else leakFlows[link.room]=q;}
  for(const link of internal)doorFlows[link.id]=flowDoor(link,pressures[link.a],pressures[link.b]);
  vents.forEach(v=>ventFlows[v.id]=Math.max(0,v.rate||0)*(v.type==='exhaust'?-1:1));
  const totalSupply=Object.values(windowFlows).reduce((s,x)=>s+Math.max(0,x),0)+Object.values(leakFlows).reduce((s,x)=>s+Math.max(0,x),0)+Object.values(ventFlows).reduce((s,x)=>s+Math.max(0,x),0);
  const totalExhaust=Object.values(windowFlows).reduce((s,x)=>s+Math.max(0,-x),0)+Object.values(leakFlows).reduce((s,x)=>s+Math.max(0,-x),0)+Object.values(ventFlows).reduce((s,x)=>s+Math.max(0,-x),0);
  return {pressures:Array.from(pressures),windowFlows,doorFlows,leakFlows,ventFlows,windPa,
    totalSupply,totalExhaust,maxResidual,iterations,converged:maxResidual<.05};
 }
 root.AeroPressure={solve,powerFlow,cp};
})(typeof window!=='undefined'?window:globalThis);
