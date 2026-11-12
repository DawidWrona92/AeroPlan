/* AeroPlan experimental interface shell.
 * Presentation and navigation only: does not change the simulation model or JSON format.
 * The experiment intentionally remains isolated from main until reviewed.
 */
(()=>{'use strict';
 const tabs=Array.from(document.querySelectorAll('[data-config-tab]'));
 const panes=new Map(tabs.map(t=>[t.dataset.configTab,document.getElementById(t.getAttribute('aria-controls'))]));
 function showPanel(name,focus=false){
  if(!panes.has(name))return false;
  for(const tab of tabs){
   const selected=tab.dataset.configTab===name;
   tab.setAttribute('aria-selected',String(selected));
   tab.tabIndex=selected?0:-1;
   const pane=panes.get(tab.dataset.configTab);
   if(pane)pane.hidden=!selected;
   if(selected&&focus)tab.focus();
  }
  return true;
 }
 const nav=document.querySelector('.config-tabs');
 nav?.addEventListener('click',event=>{
  const target=event.target.closest('[data-config-tab]');
  if(target&&nav.contains(target))showPanel(target.dataset.configTab);
 });
 nav?.addEventListener('keydown',event=>{
  const index=tabs.indexOf(document.activeElement);
  if(index<0)return;
  let next=index;
  if(event.key==='ArrowRight'||event.key==='ArrowDown')next=(index+1)%tabs.length;
  else if(event.key==='ArrowLeft'||event.key==='ArrowUp')next=(index+tabs.length-1)%tabs.length;
  else if(event.key==='Home')next=0;
  else if(event.key==='End')next=tabs.length-1;
  else return;
  event.preventDefault();showPanel(tabs[next].dataset.configTab,true);
 });
 document.querySelectorAll('[data-switch-panel]').forEach(button=>button.addEventListener('click',()=>{
  if(showPanel(button.dataset.switchPanel,true)){
   document.querySelector('.sidebar')?.scrollTo({top:0,behavior:'smooth'});
  }
 }));
 // Keep the context editor in sync with the tool selected directly on the map.
 document.querySelectorAll('[data-tool]').forEach(button=>button.addEventListener('click',()=>{
  const name=button.dataset.tool;
  if(name==='purifier')showPanel('purifier');
  else if(name==='supply'||name==='exhaust')showPanel('air');
  else showPanel('plan');
 }));
 document.getElementById('jumpToMap')?.addEventListener('click',()=>{
  document.getElementById('field')?.scrollIntoView({behavior:'smooth',block:'center'});
 });
 // An accessible entry point from the header to the complete backup panel.
 document.querySelectorAll('[data-open-projects]').forEach(button=>button.addEventListener('click',()=>showPanel('projects',true)));
 window.AeroPlanUI=Object.freeze({showPanel});
 showPanel('plan');
})();
