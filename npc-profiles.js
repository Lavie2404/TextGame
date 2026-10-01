// NPC profiles are generated once per journey by Ollama (see generateNpcProfile in ai.js) and then kept fixed.
const NPC_PROFILE_SCHEMA = {
  type:'object',
  properties:{
    fullName:{type:'string'},courtesyName:{type:'string'},identity:{type:'string'},appearance:{type:'string'},personality:{type:'string'},
    level:{type:'integer'}
  },
  required:['fullName','courtesyName','identity','appearance','personality','level']
};
const npcProfiles = new Map(), pendingNpcProfiles = new Map();
function resetNpcProfiles(){npcProfiles.clear();pendingNpcProfiles.clear()}
function maxWorldLevel(){return worldRealms.length*10}
function npcRealmLabel(level){return level<1?'Chưa tu luyện':getRealmForLevel(level)||'Chưa rõ'}
// An NPC may be at most this many levels above the player.
const NPC_LEVEL_LEAD=5;
function npcLevelCap(){return Math.min(Math.max(maxWorldLevel(),1),Math.max(0,playerLevel())+NPC_LEVEL_LEAD)}
// NPC gear and techniques are rolled like shop stock: at the NPC's level, any grade up to the realm's grade
// (rollGradeTier in shop.js), named from the same lists as the player's. A mortal (level 0) has none.
function rollNpcLoadout(level){
  if(level<1)return {equipment:[],skills:[]};
  const tier=gradeTierForRealm(Math.floor((level-1)/10)),grades=Object.keys(rarity);
  const make=kind=>{const t=rollGradeTier(tier);return [namedItems[kind][t],grades[t],itemKinds[kind][0]==='Trang bị'?'✦':'☯',true,kind,'',level]};
  const equipment=['weapon','clothing','shoes','accessory'].filter((kind,index)=>index===0||Math.random()<.6).map(make);
  if(Math.random()<.15)equipment.push(make('mount'));
  return {equipment,skills:pickRandom(['attack','defense','speed'],randomInt(1,2)).map(make)};
}
// Base stats plus gear and technique bonuses, the same way effectiveStats() does it for the player.
function npcEffectiveStats(profile){
  const stats={...profile.stats},statFor={weapon:'attack',clothing:'defense',shoes:'speed',accessory:'health'};
  (profile.equipment||[]).forEach(item=>{if(statFor[item[4]])stats[statFor[item[4]]]+=equipmentBonus(item);if(item[4]==='mount')addStats(stats,mountBonus(item))});
  (profile.skills||[]).forEach(item=>{if(['attack','defense','speed'].includes(item[4]))stats[item[4]]+=levelGradeValue(item)});
  for(const key of Object.keys(stats))stats[key]=Math.floor(stats[key]);
  return stats;
}
// Beasts that have not taken human form fight with what their kind is born with. Matched on the species
// the classifier names (loài), longest keyword first; anything unknown falls back to teeth and claws.
const BEAST_REPERTOIRE=[
  [['rắn','mãng xà','trăn','xà','độc xà'],['phun nọc độc','mổ nhanh như chớp','quấn quanh người rồi siết chặt','quật đuôi']],
  [['sói','hổ','sư tử','báo','gấu','lang','hồ ly','cáo','chó','mèo','linh miêu','tê tê'],['vuốt cào','vồ tới','cắn xé','húc ngã','nhảy bổ từ sườn']],
  [['khỉ','vượn','tinh tinh','viên','hầu'],['vung gậy','múa trường côn','nhảy nhót né đòn','đấm bằng hai chi trước','cắn']],
  [['chim','ưng','điêu','hạc','phượng','quạ','đại bàng','cú','kên kên','bằng'],['mổ bằng mỏ','bổ nhào từ trên cao','chụp bằng vuốt','quạt cánh tạo gió']],
  [['rồng','giao long','long','thuồng luồng','giao'],['vuốt rồng cào','quật đuôi','phun hỏa diễm','gọi lôi điện','dâng sóng nước','long tức trấn áp']],
  [['trâu','bò','ngựa','hươu','nai','tê giác','dê','lợn rừng','heo rừng','voi'],['húc bằng sừng','đá hậu','giẫm đạp','lao thẳng tới']],
  [['cá sấu'],['đớp bằng hàm','quật đuôi','xoay tròn tử vong','lao từ dưới nước lên']],
  [['cá','thủy quái','rùa','cua','tôm','ếch','ngao'],['quật đuôi','phun nước','kẹp bằng càng','rụt vào mai cứng','lao từ dưới nước lên']],
  [['nhện','bọ cạp','rết','ong','bọ','trùng','côn trùng'],['chích nọc độc','phun tơ trói','kẹp bằng càng','bu kín']]
];
function beastAttacks(species){
  const lower=String(species||'').toLocaleLowerCase('vi');
  const match=BEAST_REPERTOIRE.map(([keys,moves])=>[keys.filter(key=>lower.includes(key)).sort((x,y)=>y.length-x.length)[0],moves]).filter(([key])=>key).sort((x,y)=>y[0].length-x[0].length)[0];
  return match?match[1]:['cắn','vồ','húc','cào'];
}
// A beast's profile is built here, not by the model: level from the threat the classifier judged, stats
// rolled like any character, gear only once it has taken human form.
// `named` comes from the model: a trait-based kind name (Tật Phong Lang), the trait itself and the signature
// move that trait gives (gọi cuồng phong), which joins the species-born attacks.
function makeBeastProfile(alias,species,transformed,threat,named={}){
  const base=Math.max(0,playerLevel()),offset=threat==='mạnh'?randomInt(2,NPC_LEVEL_LEAD):threat==='yếu'?randomInt(-6,-2):randomInt(-2,2);
  const level=Math.min(npcLevelCap(),Math.max(1,base+offset));
  const name=String(named.name||'').trim()||alias,trait=String(named.trait||'').trim(),move=String(named.signatureMove||'').trim();
  const profile=normalizeNpcProfile({fullName:name,courtesyName:'Không có',identity:`Yêu thú loài ${species}${transformed?', đã hóa hình thành người':', chưa hóa hình'}${trait?`; đặc tính: ${trait}`:''}`,appearance:trait||'Chưa rõ',personality:'Hoang dã, hiếu chiến',level},name);
  if(!transformed){profile.equipment=[];profile.skills=[]}
  const naturalAttacks=transformed?[]:[...(move?[move]:[]),...beastAttacks(species)];
  return {...profile,beast:true,alias,species,transformed,trait,naturalAttacks};
}
// A beast met again under its everyday name ("con sói") keeps the profile it already has.
function findBeastProfile(alias,species){
  return [...npcProfiles.values()].find(p=>p.beast&&(p.alias===alias||p.speaker===alias)&&(p.health==null||p.health>0))
    ||[...npcProfiles.values()].find(p=>p.beast&&p.species===species&&(p.health==null||p.health>0));
}
const npcItemNames=items=>(items||[]).map(item=>`${item[0]} (${item[1]}, cấp ${item[6]})`).join(', ')||'không có';
// Stats follow the same rolling rules as the player (rollCharacterStats in item-rules.js); gear and techniques are rolled fresh.
function normalizeNpcProfile(raw,speaker){
  const text=(value,fallback,limit=240)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,limit)||fallback;
  const level=Math.min(Math.max(0,Math.round(Number(raw.level))||0),npcLevelCap());
  const stats=rollCharacterStats(level);
  return {
    speaker,fullName:text(raw.fullName,speaker,60),courtesyName:text(raw.courtesyName,'Không có',40),
    identity:text(raw.identity,'Chưa rõ'),appearance:text(raw.appearance,'Chưa rõ',400),personality:text(raw.personality,'Chưa rõ',400),
    level,realm:npcRealmLabel(level),stats,...rollNpcLoadout(level)
  };
}
// Compact line per known NPC, fed back into story prompts so later turns stay consistent.
function npcProfilesContext(limit=10){
  const known=[...npcProfiles.values()].slice(-limit);
  if(!known.length)return 'HỒ SƠ NPC ĐÃ XÁC LẬP: chưa có.';
  return `HỒ SƠ NPC ĐÃ XÁC LẬP (giữ đúng, không mâu thuẫn): ${known.map(p=>`${p.speaker} = ${p.fullName}, tự ${p.courtesyName}; ${p.identity}; ${p.realm}${p.level?` cấp ${p.level}`:''}; tính cách: ${p.personality}; ${Object.entries(CHARACTER_STAT_LABELS).map(([key,label])=>`${label} ${npcEffectiveStats(p)[key]}`).join(', ')}; ${p.beast&&!p.transformed?`chiêu thức bản năng: ${p.naturalAttacks.join(', ')}`:`trang bị: ${npcItemNames(p.equipment)}; kỹ năng: ${npcItemNames(p.skills)}`}`).join(' | ')}`;
}

(() => {
  const modal=document.querySelector('#npc-modal'),body=document.querySelector('#npc-profile-body'),title=document.querySelector('#npc-profile-title');
  let shownSpeaker='';
  const close=()=>{modal.classList.remove('open');shownSpeaker=''};
  document.querySelector('#close-npc-modal').onclick=close;
  modal.addEventListener('click',event=>{if(event.target===modal)close()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&modal.classList.contains('open'))close()});

  const NO_COURTESY=/^(?:không có|không|chưa có|chưa rõ|-|—)?$/iu;
  // Every field is editable in place; level is re-rolled into stats on save (same rules as the player).
  function renderProfile(profile,notice=''){
    title.textContent=profile.fullName;
    const field=(label,key,value,multiline=false,extra='',attrs='')=>`<div><dt><label for="npc-${key}">${label}</label></dt><dd>${multiline
      ?`<textarea id="npc-${key}" data-key="${key}" rows="2">${escapeHtml(String(value))}</textarea>`
      :`<input id="npc-${key}" data-key="${key}"${attrs} value="${escapeHtml(String(value)).replace(/"/g,'&quot;')}" />`}${extra}</dd></div>`;
    const needsCourtesy=NO_COURTESY.test(String(profile.courtesyName).trim());
    body.innerHTML=`<form id="npc-profile-form"><dl class="npc-profile">`+
      field('Họ và tên','fullName',profile.fullName)+
      field('Tự','courtesyName',needsCourtesy?'':profile.courtesyName,false,`<button type="button" class="create-item npc-inline" id="npc-courtesy-ai"${needsCourtesy?'':' hidden'}>AI đặt tên tự</button>`)+
      field('Thân phận','identity',profile.identity,true)+
      field('Ngoại hình','appearance',profile.appearance,true)+
      field('Tính cách','personality',profile.personality,true)+
      `<div><dt>Cảnh giới</dt><dd id="npc-realm">${escapeHtml(profile.realm)}</dd></div>`+
      field('Cấp độ','level',profile.level,false,'',' type="number" min="0"')+
      `</dl></form>`+
      `<div class="npc-stats">${Object.entries(CHARACTER_STAT_LABELS).map(([key,label])=>`<div><span>${label}</span><b>${key==='health'&&profile.health!=null&&profile.health!==npcEffectiveStats(profile).health?`${profile.health.toLocaleString('vi-VN')} / `:''}${npcEffectiveStats(profile)[key].toLocaleString('vi-VN')}</b></div>`).join('')}</div>`+
      `<p class="npc-note">Chỉ số đã gồm trang bị và kỹ năng; đổi cấp độ sẽ quay lại toàn bộ.</p>`+
      (profile.beast&&!profile.transformed?`<div class="npc-loadout"><h3>Chiêu thức bản năng</h3><small>${escapeHtml(profile.naturalAttacks.join(' · '))}</small></div>`:'')+
      ['Trang bị','Kỹ năng'].map((label,index)=>{const items=index?profile.skills:profile.equipment;return `<div class="npc-loadout"><h3>${label}</h3>${items?.length?items.map(item=>`<div class="item"><span class="item-icon">${escapeHtml(item[2])}</span><span class="item-details"><b>${escapeHtml(item[0])}</b><small>${escapeHtml(item[1])} · Cấp ${item[6]}</small><small>${escapeHtml(itemDescription(item))}</small></span></div>`).join(''):'<small class="npc-empty">Không có.</small>'}</div>`}).join('')+
      `<div class="npc-actions"><button type="button" class="create-item" id="npc-save">Lưu hồ sơ</button><span class="npc-notice" role="status">${escapeHtml(notice)}</span></div>`;
    const form=body.querySelector('#npc-profile-form');
    const courtesyInput=form.querySelector('#npc-courtesyName'),courtesyButton=body.querySelector('#npc-courtesy-ai');
    courtesyInput.addEventListener('input',()=>{courtesyButton.hidden=courtesyInput.value.trim()!==''});
    form.querySelector('#npc-level').addEventListener('input',event=>{body.querySelector('#npc-realm').textContent=npcRealmLabel(Number(event.target.value)||0)});
    form.addEventListener('submit',event=>{event.preventDefault();saveProfile(profile)});
    body.querySelector('#npc-save').addEventListener('click',()=>saveProfile(profile));
    courtesyButton.addEventListener('click',async()=>{
      courtesyButton.disabled=true;courtesyButton.textContent='AI đang đặt…';
      try{
        const name=await window.generateNpcCourtesyName(readForm(profile));
        courtesyInput.value=name;courtesyButton.hidden=true;
        body.querySelector('.npc-notice').textContent=`Đã đặt tên tự "${name}"; bấm Lưu hồ sơ để giữ.`;
      }catch(error){body.querySelector('.npc-notice').textContent=`Chưa đặt được tên tự: ${error.message||'Ollama không phản hồi.'}`}
      finally{courtesyButton.disabled=false;courtesyButton.textContent='AI đặt tên tự'}
    });
  }
  function readForm(profile){
    const raw={...profile};
    body.querySelectorAll('[data-key]').forEach(input=>{raw[input.dataset.key]=input.value});
    if(!String(raw.courtesyName).trim())raw.courtesyName='Không có';
    return raw;
  }
  function saveProfile(profile){
    const updated=normalizeNpcProfile(readForm(profile),profile.speaker);
    // Stats are only re-rolled when the level actually changed.
    if(profile.beast)Object.assign(updated,{beast:true,species:profile.species,transformed:profile.transformed,naturalAttacks:profile.naturalAttacks});
    if(updated.level===profile.level){updated.stats=profile.stats;updated.equipment=profile.equipment;updated.skills=profile.skills;if(profile.health!=null)updated.health=Math.min(profile.health,npcEffectiveStats(updated).health)}
    npcProfiles.set(profile.speaker,updated);
    renderProfile(updated,'Đã lưu hồ sơ; truyện sẽ dùng thông tin này từ lượt sau.');
  }
  function renderMessage(message,retry=false){
    body.innerHTML=`<p class="modal-intro" role="status">${escapeHtml(message)}</p>${retry?'<button type="button" class="create-item" id="npc-retry">Thử lại</button>':''}`;
    document.querySelector('#npc-retry')?.addEventListener('click',()=>openNpcProfile(shownSpeaker));
  }
  async function openNpcProfile(speaker){
    shownSpeaker=speaker;modal.classList.add('open');title.textContent=speaker;
    if(npcProfiles.has(speaker))return renderProfile(npcProfiles.get(speaker));
    renderMessage('Ollama đang lập hồ sơ từ những gì truyện đã kể về nhân vật này… Nếu AI đang viết lượt truyện, yêu cầu sẽ chờ tới lượt.');
    try{
      if(typeof window.generateNpcProfile!=='function')throw new Error('Không tải được mô-đun AI. Hãy tải lại trang.');
      if(!pendingNpcProfiles.has(speaker))pendingNpcProfiles.set(speaker,window.generateNpcProfile(speaker).finally(()=>pendingNpcProfiles.delete(speaker)));
      const profile=normalizeNpcProfile(await pendingNpcProfiles.get(speaker),speaker);
      npcProfiles.set(speaker,profile);
      if(shownSpeaker===speaker)renderProfile(profile);
    }catch(error){
      if(shownSpeaker===speaker)renderMessage(`Chưa lập được hồ sơ: ${error.message||'Ollama không phản hồi.'}`,true);
    }
  }
  document.querySelector('#story').addEventListener('click',event=>{
    const avatar=event.target.closest('.story-entry.npc .avatar');
    const speaker=avatar?.closest('.story-entry').querySelector('.speaker')?.firstChild?.textContent.trim();
    if(speaker)openNpcProfile(speaker);
  });
})();
