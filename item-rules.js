const itemPriceWeights = {weapon:1,shoes:2,clothing:3,accessory:4,mount:5,attack:1,speed:2,defense:3,burstAttack:4,burstDefense:4,burstSpeed:4,escape:4,righteous:5,demonic:5,recovery:5,potion:1};
const itemKinds = {
  weapon: ['Trang bị','Vũ khí','Công kích'], clothing: ['Trang bị','Y phục','Phòng ngự'],
  shoes: ['Trang bị','Giày','Tốc độ'], accessory: ['Trang bị','Phụ kiện','Máu'], mount: ['Trang bị','Tọa kỵ','Toàn bộ chỉ số'],
  attack: ['Kỹ năng','Công pháp tấn công','Công kích'], defense: ['Kỹ năng','Công pháp phòng thủ','Phòng ngự'],
  speed: ['Kỹ năng','Công pháp tăng tốc độ','Tốc độ'],
  burstAttack: ['Kỹ năng','Bạo phát tăng công','Công kích'], burstDefense: ['Kỹ năng','Bạo phát tăng thủ','Phòng ngự'],
  burstSpeed: ['Kỹ năng','Bạo phát tăng tốc độ','Tốc độ'], escape: ['Kỹ năng','Bạo phát trốn chạy','Trốn chạy'],
  righteous: ['Kỹ năng','Tâm pháp chính đạo','Tu vi'], demonic: ['Kỹ năng','Tâm pháp ma đạo','Tu vi'],
  recovery: ['Kỹ năng','Tâm pháp dưỡng thân','Hồi máu']
};
const namedItems = {
  weapon:['Thanh Phong Kiếm','Xích Diễm Đao','Hàn Nguyệt Thương','Lôi Đình Kích','Thiên Quang Kiếm','Vạn Tượng Kiếm'],
  clothing:['Hộ Tâm Giáp','Thanh Vân Bào','Hàn Sương Giáp','Huyền Lôi Bào','Thiên Hà Y','Vô Cực Tiên Y'],
  shoes:['Khinh Vân Ngoa','Truy Phong Ngoa','Lưu Ảnh Ngoa','Đạp Lôi Ngoa','Ngự Thiên Ngoa','Vượt Hư Ngoa'],
  accessory:['Thanh Ngọc Bội','Phúc Vân Giới','Tinh Huy Châu','Cát Tường Ấn','Thiên Cơ Bội','Vạn Phúc Linh Châu'],
  mount:['Ô Vân Mã','Xích Phong Câu','Ngân Dực Lang','Lôi Vân Hổ','Thiên Thanh Loan','Cửu Tiêu Long'],
  attack:['Phá Thạch Quyền','Liệt Phong Kiếm Quyết','Xích Viêm Chưởng','Lôi Đình Quyết','Thiên Quang Kiếm Kinh','Vạn Tượng Quyền Kinh'],
  defense:['Thiết Bích Công','Kim Chung Quyết','Huyền Giáp Công','Bất Động Sơn Kinh','Thiên Cương Hộ Thể','Vô Cực Kim Thân'],
  speed:['Ngự Phong Quyết','Lưu Vân Bộ','Ảnh Độn Quyết','Đạp Lôi Bộ','Thiên Hành Quyết','Hư Không Du'],
  burstAttack:['Phá Giới Quyền','Xích Tâm Quyết','Nộ Hải Chưởng','Lôi Nộ Quyết','Thiên Hỏa Tế','Phá Thiên Cấm Quyết'],
  burstDefense:['Nhiên Khí Hộ Thể','Tỏa Sơn Quyết','Ngưng Mạch Giáp','Huyền Sơn Cấm','Thiên Môn Bích','Vạn Kiếp Hộ Thân'],
  burstSpeed:['Tật Ảnh Quyết','Nhiên Phong Bộ','Xé Gió Quyết','Lôi Quang Thiểm','Thiên Ảnh Thiểm','Sát Na Vô Tung'],
  escape:['Thoát Ảnh Thuật','Ẩn Phong Độn','Vụ Ảnh Độn','Lôi Quang Độn','Thiên Ngoại Độn','Hư Không Ly'],
  righteous:['Tụ Khí Thuật','Thanh Tâm Kinh','Ngọc Thanh Quyết','Thái Hòa Kinh','Thiên Địa Dưỡng Tâm','Vô Cực Thanh Tâm'],
  demonic:['Dẫn Huyết Quyết','Huyết Nguyên Kinh','Huyết Hải Tâm Kinh','Huyền Huyết Đại Pháp','Thiên Huyết Ma Kinh','Vạn Huyết Ma Điển'],
  recovery:['Dưỡng Thân Quyết','Hồi Xuân Kinh','Thanh Mộc Trường Sinh Công','Cửu Chuyển Hồi Nguyên','Thiên Địa Tạo Hóa Kinh','Bất Diệt Trường Sinh Điển']
};
const MIND_KINDS=['righteous','demonic','recovery'];
const CHARACTER_STAT_LABELS={attack:'Công kích',defense:'Phòng ngự',speed:'Tốc độ',health:'Máu'};
// Each burst pays differently: HP burned on activation (hpPercent of max HP, never refunded) and/or
// a weakened stat for the following turn, during which no burst can be triggered.
const FATIGUE_PERCENT=30;
const BURST_RULES={
  burstAttack:{stat:'attack',cost:'Đốt huyết',hpPercent:10},
  burstDefense:{stat:'defense',cost:'Cứng đờ',weaken:'speed'},
  burstSpeed:{stat:'speed',cost:'Rách kinh mạch',weaken:'defense'},
  escape:{stat:'speed',cost:'Kiệt sức',hpPercent:5,weaken:'attack'}
};
function burstCostText(kind){
  const rule=BURST_RULES[kind],parts=[];
  if(rule.hpPercent)parts.push(`trừ ${rule.hpPercent}% máu tối đa khi kích hoạt, không hoàn`);
  if(rule.weaken)parts.push(`lượt sau ${CHARACTER_STAT_LABELS[rule.weaken]} -${FATIGUE_PERCENT}% và không bạo phát được`);
  return `Giá: ${rule.cost}, ${parts.join('; ')}`;
}
function itemRank(item){return (rarity[item[1]]??0)+1}
// Everything scales by two coefficients: value = level × 1,2 × 1,5^grade tier (Phàm 0 … Tiên 5), e.g. a level 60 Địa
// weapon gives 60 × 1,2 × 3,375 = +243. Items carry their level at [6]; items without one count as level 1.
// Per-kind scales on top: a mount adds half the value to every stat, a burst three times the value for one turn,
// and a health point (accessory, mount health, Bình máu) is worth 10 HP.
const LEVEL_COEFFICIENT=1.2,GRADE_COEFFICIENT=1.5;
function itemLevel(item){return Math.max(1,Number(item[6])||1)}
function gradeFactor(item){return GRADE_COEFFICIENT**(rarity[item[1]]??0)}
function levelGradeValue(item,scale=1){return Math.round(itemLevel(item)*LEVEL_COEFFICIENT*gradeFactor(item)*scale)}
function equipmentBonus(item){const value=levelGradeValue(item);return item[4]==='accessory'?value*10:value}
function mountBonus(item){const value=levelGradeValue(item,.5);return Object.fromEntries(Object.keys(CHARACTER_STAT_LABELS).map(key=>[key,key==='health'?value*10:value]))}
function burstBonus(item){return levelGradeValue(item,3)}
function burstEffectText(bonus,kind){return `+${bonus.toLocaleString('vi-VN')} ${CHARACTER_STAT_LABELS[BURST_RULES[kind].stat]}`}
// Tâm pháp percentages scale by the grade coefficient, and work fully only when they match the player's current realm:
// each grade away from the realm's grade keeps 75%, and each realm between the manual's level and the player's level
// keeps 85% (one grade and one realm off → 64%). A grade above the realm still nets 1,5 × 0,75 = 1,125× the matching one.
const MIND_GRADE_KEEP=.75,MIND_REALM_KEEP=.85;
function realmIndexForLevel(level){return Math.max(0,Math.floor((level-1)/10))}
function mindMismatch(item){
  const playerRealm=realmIndexForLevel(playerLevel());
  return {grade:Math.abs((rarity[item[1]]??0)-gradeTierForRealm(playerRealm)),realm:Math.abs(realmIndexForLevel(itemLevel(item))-playerRealm)};
}
function mindEfficiency(item){const gap=mindMismatch(item);return MIND_GRADE_KEEP**gap.grade*MIND_REALM_KEEP**gap.realm}
function mindEfficiencyText(item){
  const gap=mindMismatch(item),parts=[gap.grade?`${gap.grade} phẩm`:'',gap.realm?`${gap.realm} cảnh giới`:''].filter(Boolean);
  return parts.length?` Hiệu quả ${Math.round(mindEfficiency(item)*100)}% do lệch ${parts.join(' và ')} so với cảnh giới hiện tại.`:'';
}
function mindPercent(item,base){return Math.round(base*gradeFactor(item)*mindEfficiency(item)*100)/100}
// Sale value = level × 1,2 × 1,5^grade × the kind's price weight; shop prices are twice this.
function itemPrice(item){return Math.max(1,levelGradeValue(item)*(itemPriceWeights[item[4]]||1))}
function itemDescription(item){
  const kind=item[4],rank=itemRank(item),label=itemKinds[kind];
  if(!label)return '';
  let effect=`+${equipmentBonus(item).toLocaleString('vi-VN')} ${label[2]}`;
  if(kind==='mount'){const bonus=mountBonus(item);effect=`+${bonus.attack.toLocaleString('vi-VN')} Công kích, Phòng ngự, Tốc độ; +${bonus.health.toLocaleString('vi-VN')} Máu`}
  if(['attack','defense','speed'].includes(kind))effect=`+${levelGradeValue(item).toLocaleString('vi-VN')} ${label[2]} khi bật`;
  if(kind.startsWith('burst'))effect=`${burstEffectText(burstBonus(item),kind)} cho lượt AI kế tiếp. ${burstCostText(kind)}. Tắt trước lượt AI sẽ hủy bạo phát`;
  if(kind==='escape')effect=`${burstEffectText(burstBonus(item),kind)} cho lượt trốn chạy kế tiếp. ${burstCostText(kind)}. Không bảo đảm thoát`;
  if(kind==='righteous')effect=`+${formatPercent(mindXpPercent(item))}% tu vi cần lên cấp mỗi chương (tổng ${formatPercent(BASE_CHAPTER_XP_PERCENT+mindXpPercent(item))}%).${mindEfficiencyText(item)}`;
  if(kind==='demonic'){const school=demonicSchool(item);effect=school?`${school.label} · +${formatPercent(mindXpPercent(item))}% tu vi cần lên cấp mỗi chương (tổng ${formatPercent(BASE_CHAPTER_XP_PERCENT+mindXpPercent(item))}%).${mindEfficiencyText(item)} ${school.condition(rank)} Lượt không đủ điều kiện: tâm pháp không góp tu vi lượt đó.`:'Nhánh ma đạo chưa hợp lệ; không thể tu luyện';}
  if(kind==='recovery')effect=`+${formatPercent(mindPercent(item,10))}% hồi máu cuối mỗi chương không giao tranh (tổng ${formatPercent(CHAPTER_RECOVERY_PERCENT+mindPercent(item,10))}%).${mindEfficiencyText(item)}`;
  return `${label[1]} · ${effect}`;
}
function itemSlot(kind){return MIND_KINDS.includes(kind)?'mind':kind}
function exclusiveEquip(list,item){
  list.forEach(other=>{if(other!==item&&itemSlot(other[4])===itemSlot(item[4])){
    other[3]=false;
    if(pendingBurst?.name===other[0])pendingBurst=null;
  }});
  item[3]=true;
}
const randomInt=(min,max)=>min+Math.floor(Math.random()*(max-min+1));
// A health point is worth 10 HP from base/level rolls and 100 HP from a realm bonus.
function rollStatPoints(min,max,healthScale){return Object.fromEntries(Object.keys(CHARACTER_STAT_LABELS).map(key=>[key,randomInt(min,max)*(key==='health'?healthScale:1)]))}
function addStats(target,gain){for(const key of Object.keys(gain))target[key]=(target[key]||0)+gain[key];return target}
// Reaching `level` adds 1–10 per stat; entering a new realm (levels 11, 21, …; never 0→1) adds 10–20 more.
function rollLevelUp(level){return {gain:rollStatPoints(1,10,10),realmBonus:level>1&&(level-1)%10===0?rollStatPoints(10,20,100):null}}
// A mortal (level 0) starts at 1–10 per stat, then every level up to `level` is rolled in order.
function rollCharacterStats(level){
  const stats=rollStatPoints(1,10,10);
  for(let current=1;current<=level;current++){const {gain,realmBonus}=rollLevelUp(current);addStats(stats,gain);if(realmBonus)addStats(stats,realmBonus)}
  return stats;
}
function formatStatGain(gain){return Object.entries(CHARACTER_STAT_LABELS).map(([key,label])=>`${label} +${gain[key].toLocaleString('vi-VN')}`).join(' · ')}
let baseStats={attack:100,defense:80,speed:50,health:100};
let pendingBurst=null,burstFatigue=null;
// Current HP; the Máu stat is the maximum. null means "full" until the first render.
let currentHealth=null;
function effectiveStats(){
  // Flat amounts are added first, then every percentage multiplies the total.
  const stats={...baseStats};
  const statFor={weapon:'attack',clothing:'defense',shoes:'speed',accessory:'health'};
  equipment.filter(i=>i[3]!==false).forEach(i=>{
    if(statFor[i[4]])stats[statFor[i[4]]]+=equipmentBonus(i);
    if(i[4]==='mount')addStats(stats,mountBonus(i));
  });
  skills.filter(i=>i[3]!==false&&['attack','defense','speed'].includes(i[4])).forEach(i=>{stats[i[4]]+=levelGradeValue(i)});
  if(pendingBurst)stats[BURST_RULES[pendingBurst.kind].stat]+=pendingBurst.bonus||0;
  if(burstFatigue)stats[burstFatigue.stat]*=1-FATIGUE_PERCENT/100;
  for(const key of Object.keys(stats))stats[key]=Math.floor(stats[key]);
  return stats;
}
function maxHealth(){return effectiveStats().health}
function healthNow(){const max=maxHealth();currentHealth=currentHealth===null?max:Math.min(currentHealth,max);return currentHealth}
function healHealth(amount){const before=healthNow();currentHealth=Math.min(maxHealth(),before+Math.max(0,Math.floor(amount)));return currentHealth-before}

// The world's realms are split evenly across the six grades (12 realms: every 2 realms move up one grade).
// With fewer than 6 realms each realm moves up one grade and the top grades are simply never reached.
const GRADE_COUNT=6;
function gradeTierForRealm(realmIndex){
  const count=Math.max(worldRealms.length,1);
  return Math.min(GRADE_COUNT-1,count<GRADE_COUNT?realmIndex:Math.floor(realmIndex*GRADE_COUNT/count));
}
// Level 0 (a mortal) is a real level; only a missing label falls back to 1.
function playerLevel(){const level=document.querySelector('#player-realm')?.textContent.match(/Cấp\s+(\d+)/)?.[1];return level===undefined?1:Number(level)}
// Bình máu are stacked by grade and level ("Địa phẩm@65" -> count) and heal level × 1,2 × 1,5^grade × 10 HP.
const potions={};
function potionKey(grade,level){return `${grade}@${level}`}
function potionFromKey(key){const [grade,level]=key.split('@');return ['Bình máu',grade,'⚱',false,'potion',undefined,Number(level)]}
function potionHeal(potion){return levelGradeValue(potion)*10}
function potionDescription(potion){return `Vật phẩm tiêu hao · Hồi ${potionHeal(potion).toLocaleString('vi-VN')} máu; dùng 1 lần mất 1 bình`}
function usePotion(key){
  const potion=potionFromKey(key);
  if(!potions[key])return `Không còn Bình máu ${potion[1]} cấp ${itemLevel(potion)}.`;
  if(healthNow()>=maxHealth())return 'Máu đang đầy, không cần dùng Bình máu.';
  const healed=healHealth(potionHeal(potion));
  potions[key]--;
  return `Đã dùng Bình máu ${potion[1]} cấp ${itemLevel(potion)}, hồi ${healed.toLocaleString('vi-VN')} máu.`;
}
function renderConsumables(){
  const list=document.querySelector('#consumable-list');if(!list)return;
  const owned=Object.entries(potions).filter(([,count])=>count>0);
  const potionRows=owned.map(([key,count])=>{const potion=potionFromKey(key),grade=potion[1];return `<div class="item"><span class="item-icon">⚱</span><span class="item-details"><b>Bình máu ×${count}</b><small class="item-grade rarity-${rarity[grade]}">${escapeHtml(grade)} · Cấp ${itemLevel(potion)}</small><small class="item-effect">${escapeHtml(potionDescription(potion))}</small></span><span class="item-actions"><button type="button" class="item-toggle" data-use-potion="${escapeHtml(key)}" aria-label="Dùng Bình máu ${escapeHtml(grade)} cấp ${itemLevel(potion)}">Dùng</button></span></div>`});
  // Demonic materials are consumed automatically, so they are listed without a button.
  const materialRows=Object.entries(occultMaterials).filter(([,count])=>count>0).map(([key,count])=>`<div class="item"><span class="item-icon">☗</span><span class="item-details"><b>${escapeHtml(materialOffers[key][0])} ×${count}</b><small class="item-grade">Nguyên liệu</small><small class="item-effect">${escapeHtml(materialDescription(key))}</small></span></div>`);
  list.innerHTML=[...potionRows,...materialRows,...lootRows()].join('')||'<p class="inventory-empty">Chưa có vật phẩm. Mua Bình máu, độc thảo, oán phù ở tab Vật phẩm của Cửa hàng; chiến lợi phẩm trong truyện cũng nằm ở đây.</p>';
}

// End of chapter: without combat, recover 10% of max HP plus the active recovery mind art's bonus.
const CHAPTER_RECOVERY_PERCENT=10;
function chapterRecoveryPercent(){const mind=activeMind();return CHAPTER_RECOVERY_PERCENT+(mind?.[4]==='recovery'?mindPercent(mind,10):0)}
function applyChapterRecovery(hadCombat){
  if(hadCombat)return 'Chương này có giao tranh: không hồi máu cuối chương.';
  const percent=chapterRecoveryPercent(),healed=healHealth(maxHealth()*percent/100);
  renderItems();
  return `Cuối chương không giao tranh: hồi ${formatPercent(percent)}% máu, +${healed.toLocaleString('vi-VN')} máu (${healthNow().toLocaleString('vi-VN')} / ${maxHealth().toLocaleString('vi-VN')}).`;
}
function activeMind(){return skills.find(i=>i[3]!==false&&MIND_KINDS.includes(i[4]))}
// Pays a burst's activation cost; returns an error message, or '' when the burst may proceed.
function payBurstActivation(item){
  const rule=BURST_RULES[item[4]];
  if(!rule.hpPercent)return '';
  const cost=Math.ceil(maxHealth()*rule.hpPercent/100);
  if(healthNow()<=cost)return `Không đủ máu để ${rule.cost}: cần hơn ${cost.toLocaleString('vi-VN')} máu.`;
  currentHealth-=cost;
  return '';
}
function renderCharacterStats(){
  const stats=effectiveStats();
  Object.entries(stats).forEach(([key,value])=>{const el=document.getElementById(key);if(el)el.textContent=key==='health'?`${healthNow().toLocaleString('vi-VN')} / ${value.toLocaleString('vi-VN')}`:value});
  renderDemonicPanel();renderConsumables();
}
// Tu vi needed to go from `level` to the next: level × 100, × 1,5 for every realm already passed
// (level 10: 1.000, level 11: 1.650, level 21: 4.730). Leftover tu vi carries into the next level.
// A mortal at level 0 needs 50 to take the first step to level 1.
function xpToNextLevel(level){return level<1?50:Math.round(level*100*GRADE_COEFFICIENT**Math.floor((level-1)/10)/10)*10}
let playerXp=0;
function currentXp(){return playerXp}
function renderProgress(level,xp){
  const need=xpToNextLevel(level),realm=realmLabelForLevel(level);
  playerXp=Math.max(0,xp);
  document.querySelector('#custom-level').value=level;
  document.querySelector('#xp-label').textContent=`${xp.toLocaleString('vi-VN')} / ${need.toLocaleString('vi-VN')}`;
  document.querySelector('#xp-fill').style.width=`${Math.min(100,xp/need*100)}%`;
  document.querySelector('#player-realm').textContent=`${realm||'Chưa có cảnh giới'} · Cấp ${level}`;renderRealmPanels(realm,level);
}
// Tu vi is granted once per chapter: BASE_CHAPTER_XP_PERCENT of the tu vi needed for the next level, plus the tâm pháp's
// percentage, earned a quarter per turn while it is active and its conditions are met.
const BASE_CHAPTER_XP_PERCENT=2.5,TURNS_PER_CHAPTER=4;
let chapterMindPercent=0;
function mindXpPercent(item){return item?.[4]==='righteous'?mindPercent(item,2.5):item?.[4]==='demonic'?mindPercent(item,5):0}
const formatPercent=value=>value.toLocaleString('vi-VN',{maximumFractionDigits:2});
function awardChapterCultivation(){
  const percent=BASE_CHAPTER_XP_PERCENT+chapterMindPercent;chapterMindPercent=0;
  let level=playerLevel(),xp=currentXp();
  const gain=Math.round(xpToNextLevel(level)*percent/100);
  xp+=gain;
  const report=[`Hết chương: tu vi +${gain.toLocaleString('vi-VN')} (${formatPercent(percent)}% tu vi cần để lên cấp ${level+1}).`];
  healthNow();
  while(xp>=xpToNextLevel(level)&&getRealmForLevel(level+1)){
    xp-=xpToNextLevel(level);level++;
    // Max HP gained from a level-up is also added to current HP.
    const {gain:levelGain,realmBonus}=rollLevelUp(level);
    addStats(baseStats,levelGain);currentHealth+=levelGain.health;report.push(`${level===1?`Bắt đầu tu luyện, bước vào ${getRealmForLevel(1)}. `:''}Lên cấp ${level}: ${formatStatGain(levelGain)}.`);
    if(realmBonus){addStats(baseStats,realmBonus);currentHealth+=realmBonus.health;report.push(`Đột phá ${getRealmForLevel(level)}, thưởng: ${formatStatGain(realmBonus)}.`)}
  }
  renderProgress(level,Math.min(xp,xpToNextLevel(level)));renderItems();
  return report;
}
function completeProgressionTurn(){
  const mind=activeMind(),report=[];
  if(mindXpPercent(mind)){
    let met=true;
    if(mind[4]==='demonic'){
      const required=itemRank(mind),school=demonicSchool(mind);
      met=!!school?.pay(required);
      report.push(met?`Đã đáp ứng điều kiện ${school.label}.`:`Chưa đủ điều kiện tu luyện ${mind[0]}: ${school?.condition(required)||'nhánh không hợp lệ'} Lượt này tâm pháp không góp tu vi.`);
    }
    if(met)chapterMindPercent+=mindXpPercent(mind)/TURNS_PER_CHAPTER;
  }
  report.push(`Tu vi tích lũy chương này: ${formatPercent(BASE_CHAPTER_XP_PERCENT+chapterMindPercent)}% tu vi cần để lên cấp, cộng khi hết chương.`);
  const servantMessage=performServantWork().trim();if(servantMessage)report.push(servantMessage);
  const weaken=pendingBurst&&BURST_RULES[pendingBurst.kind].weaken;
  burstFatigue=weaken?{name:pendingBurst.name,cost:BURST_RULES[pendingBurst.kind].cost,stat:weaken}:null;
  if(burstFatigue)report.push(`${burstFatigue.name} để lại ${burstFatigue.cost} cho lượt tới: ${CHARACTER_STAT_LABELS[burstFatigue.stat]} -${FATIGUE_PERCENT}%, không thể bạo phát.`);
  pendingBurst=null;renderItems();
  showTurnReport(report);
}
// End-of-turn results get their own framed box in the story; story context readers skip it.
function showTurnReport(lines){
  const box=document.createElement('section');box.className='turn-report';box.setAttribute('role','status');
  const heading=document.createElement('div');heading.className='turn-report-kicker';heading.textContent='KẾT QUẢ LƯỢT';box.append(heading);
  lines.forEach(line=>{const p=document.createElement('p');p.textContent=line;box.append(p)});
  document.querySelector('#story').append(box);
}
function appendTurnReport(line){
  const box=[...document.querySelectorAll('#story .turn-report')].pop();
  if(!box)return showTurnReport([line]);
  const p=document.createElement('p');p.textContent=line;box.append(p);
}
