// Loot: every AI turn ends with "[CHIẾN LỢI PHẨM] tên: số lượng đơn vị; …" (or "… không") listing what defeated
// creatures and enemies may yield, optionally preceded by "[NHẬN ĐƯỢC] …" for things given, paid or bought in the story.
// Coins and demonic materials go to their own counters; everything else is kept here as generic loot.
const LOOT_MARKER=/^[^\p{L}\p{N}\n]{0,6}(CHIẾN LỢI PHẨM|NHẬN ĐƯỢC)[^\p{L}\p{N}\n]{0,6}(.*)$/imu;
const lootItems={};// name -> {count, unit}
function resetLoot(){Object.keys(lootItems).forEach(name=>delete lootItems[name])}
// Splits the loot lines off a story reply; returns the story without them plus the parsed entries.
// Entries from [NHẬN ĐƯỢC] are marked certain: they skip the drop roll.
function extractLoot(text){
  // Markers must sit at a line start to be found; push one the model glued onto a paragraph onto its own line.
  text=text.normalize('NFC').replace(/[ \t]*(\**\[?\s*(?:CHIẾN LỢI PHẨM|NHẬN ĐƯỢC)\s*\]?\**\s*[:：]?)/giu,'\n$1');
  const lines=text.split('\n'),seen=new Set();
  let entries=[];
  for(let i=lines.length-1;i>=0;i--){
    const match=lines[i].match(LOOT_MARKER);
    if(!match)continue;
    const certain=/NHẬN/iu.test(match[1]);
    if(!seen.has(certain)){entries=[...parseLootLine(match[2]).map(entry=>({...entry,certain})),...entries];seen.add(certain)}
    lines.splice(i,1);
  }
  return {text:lines.join('\n').trim(),entries,found:seen.size>0};
}
function parseLootLine(line){
  const cleaned=line.replace(/\*+/g,'').trim();
  if(!cleaned||/^(không|không có|không gì|trống|0)\b/iu.test(cleaned))return [];
  const number=value=>Math.round(Number(value.replace(/\./g,'').replace(',','.')))||0;
  return cleaned.split(/[;；\n]+/).map(part=>part.trim().replace(/[.。]+$/,'')).filter(Boolean).map(part=>{
    let match=part.match(/^(.+?)\s*[:：×x]\s*(\d[\d.,]*)\s*(.*)$/u);// "thịt sói: 20 cân"
    if(match)return {name:match[1].trim(),count:number(match[2]),unit:match[3].trim()};
    match=part.match(/^(\d[\d.,]*)\s+(.+)$/u);// "3 nanh sói"
    if(match)return {name:match[2].trim(),count:number(match[1]),unit:''};
    return null;
  }).filter(entry=>entry&&entry.count>0&&entry.name&&!/^không/iu.test(entry.name));
}
// Names the story uses for things the system tracks itself.
function lootMaterialKey(name){
  const lower=name.toLowerCase();
  if(/^(tiền|đồng|bạc|tiền đồng|tiền bạc|đồng tiền)$/u.test(lower))return 'coins';
  // \b does not treat Vietnamese letters as word characters, so test for a following space or end instead.
  if(/^máu(\s|$)/u.test(lower))return /người/u.test(lower)?'humanBlood':'animalBlood';
  if(/^(thi thể|xác|thân xác|tử thi|xác chết)(\s|$)/u.test(lower))return /người/u.test(lower)?'humanCorpse':'animalCorpse';
  if(/độc thảo/u.test(lower))return 'poison';
  if(/oán phù/u.test(lower))return 'talisman';
  return null;
}
// Blood and corpses (the materials no shop sells) are gathered only while the active demonic tâm pháp is the school
// that cultivates with them: Huyết công takes blood and leaves corpses, Tử Linh thuật the reverse, everyone else neither.
function lootCollects(key){
  if(materialSold(key))return true;
  const art=activeDemonic();
  return !!art&&demonicSchool(art).materials.includes(key);
}
// Beast parts always drop from a slain beast; people yield none, so a "… người" part is ignored.
const BODY_PART=/^(thịt|da|nanh|vuốt|lông|xương|sừng|móng|gân|răng|vảy|đuôi|cánh|ngà|gạc|bờm|mai|mật)(\s|$)/u;
// Everything else a defeated enemy might carry only drops by chance; the branch's own blood or corpses always do.
const DROP_CHANCE={coins:.5,poison:.3,talisman:.2,other:.3};
function lootDropChance(name,key){
  if(BODY_PART.test(name.toLowerCase()))return /người/u.test(name.toLowerCase())?0:1;
  if(key&&key!=='coins'&&!materialSold(key))return 1;
  return DROP_CHANCE[key||'other'];
}
// The amount the story lists for a drop is its maximum; what actually drops is random between half of it and all of it.
function rollDropAmount(listed){const least=Math.max(1,Math.ceil(listed/2));return least+Math.floor(Math.random()*(listed-least+1))}
// Adds loot to the inventory and returns report lines.
function applyLoot(entries){
  if(!entries.length)return [];
  const gained=[],missed=[];
  entries.forEach(({name,count:listed,unit,certain})=>{
    const key=lootMaterialKey(name);
    if(key&&key!=='coins'&&!lootCollects(key))return;
    const label=key==='coins'?'tiền':key?materialOffers[key][0]:name.charAt(0).toUpperCase()+name.slice(1);
    const chance=certain?1:lootDropChance(name,key);
    if(chance<=0)return;
    if(Math.random()>=chance){missed.push(label);return}
    // Things given, paid or bought in the story arrive in full; drops are rolled.
    const count=certain?listed:rollDropAmount(listed);
    if(key==='coins'){inventoryCoins+=count;gained.push(`tiền +${count.toLocaleString('vi-VN')} đồng`);return}
    if(key){occultMaterials[key]+=count;gained.push(`${label} +${count} ${materialOffers[key][2]}`);return}
    const stack=lootItems[label]||(lootItems[label]={count:0,unit});
    stack.count+=count;if(unit)stack.unit=unit;
    gained.push(`${label} +${count.toLocaleString('vi-VN')}${unit?` ${unit}`:''}`);
  });
  renderItems();
  return [
    gained.length?`Chiến lợi phẩm: ${gained.join(', ')}.`:'',
    missed.length?`Lần này không rơi: ${[...new Set(missed)].join(', ')}.`:''
  ].filter(Boolean);
}
function lootSummary(){return Object.entries(lootItems).filter(([,stack])=>stack.count>0).map(([name,{count,unit}])=>`${name} ×${count.toLocaleString('vi-VN')}${unit?` ${unit}`:''}`).join('; ')}
function lootRows(){
  return Object.entries(lootItems).filter(([,stack])=>stack.count>0).map(([name,{count,unit}])=>`<div class="item"><span class="item-icon">✧</span><span class="item-details"><b>${escapeHtml(name)} ×${count.toLocaleString('vi-VN')}${unit?` ${escapeHtml(unit)}`:''}</b><small class="item-grade">Chiến lợi phẩm</small><small class="item-effect">Thu được trong truyện; có thể dùng, tặng hoặc đổi chác qua hành động của ngươi.</small></span><span class="item-actions"><button type="button" class="bag-action" data-discard-loot="${escapeHtml(name)}" aria-label="Vứt bỏ ${escapeHtml(name)}">Vứt bỏ</button></span></div>`);
}
