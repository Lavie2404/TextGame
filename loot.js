// Loot: every AI turn ends with one line "[CHIẾN LỢI PHẨM] tên: số lượng đơn vị; …" (or "… không").
// Coins and demonic materials go to their own counters; everything else is kept here as generic loot.
const LOOT_MARKER=/^\W{0,3}\s*CHIẾN LỢI PHẨM\W{0,3}\s*(.*)$/imu;
const lootItems={};// name -> {count, unit}
function resetLoot(){Object.keys(lootItems).forEach(name=>delete lootItems[name])}
// Splits the loot line off a story reply; returns the story without it plus the parsed entries.
function extractLoot(text){
  const lines=text.split('\n');
  let entries=[],found=false;
  for(let i=lines.length-1;i>=0;i--){
    const match=lines[i].match(LOOT_MARKER);
    if(!match)continue;
    if(!found){entries=parseLootLine(match[1]);found=true}
    lines.splice(i,1);
  }
  return {text:lines.join('\n').trim(),entries,found};
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
// Adds loot to the inventory and returns report lines.
function applyLoot(entries){
  if(!entries.length)return [];
  const gained=[];
  entries.forEach(({name,count,unit})=>{
    const key=lootMaterialKey(name);
    if(key==='coins'){inventoryCoins+=count;gained.push(`tiền +${count.toLocaleString('vi-VN')} đồng`);return}
    if(key){occultMaterials[key]+=count;gained.push(`${materialOffers[key][0]} +${count} ${materialOffers[key][2]}`);return}
    const label=name.charAt(0).toUpperCase()+name.slice(1);
    const stack=lootItems[label]||(lootItems[label]={count:0,unit});
    stack.count+=count;if(unit)stack.unit=unit;
    gained.push(`${label} +${count.toLocaleString('vi-VN')}${unit?` ${unit}`:''}`);
  });
  renderItems();
  return [`Chiến lợi phẩm: ${gained.join(', ')}.`];
}
function lootSummary(){return Object.entries(lootItems).filter(([,stack])=>stack.count>0).map(([name,{count,unit}])=>`${name} ×${count.toLocaleString('vi-VN')}${unit?` ${unit}`:''}`).join('; ')}
function lootRows(){
  return Object.entries(lootItems).filter(([,stack])=>stack.count>0).map(([name,{count,unit}])=>`<div class="item"><span class="item-icon">✧</span><span class="item-details"><b>${escapeHtml(name)} ×${count.toLocaleString('vi-VN')}${unit?` ${escapeHtml(unit)}`:''}</b><small class="item-grade">Chiến lợi phẩm</small><small class="item-effect">Thu được trong truyện; có thể dùng, tặng hoặc đổi chác qua hành động của ngươi.</small></span><span class="item-actions"><button type="button" class="bag-action" data-discard-loot="${escapeHtml(name)}" aria-label="Vứt bỏ ${escapeHtml(name)}">Vứt bỏ</button></span></div>`);
}
