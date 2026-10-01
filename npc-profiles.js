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
// Stats follow the same rolling rules as the player (rollCharacterStats in item-rules.js).
function normalizeNpcProfile(raw,speaker){
  const text=(value,fallback,limit=240)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,limit)||fallback;
  const level=Math.min(Math.max(0,Math.round(Number(raw.level))||0),Math.max(maxWorldLevel(),1));
  const stats=rollCharacterStats(level);
  return {
    speaker,fullName:text(raw.fullName,speaker,60),courtesyName:text(raw.courtesyName,'Không có',40),
    identity:text(raw.identity,'Chưa rõ'),appearance:text(raw.appearance,'Chưa rõ',400),personality:text(raw.personality,'Chưa rõ',400),
    level,realm:npcRealmLabel(level),stats
  };
}
// Compact line per known NPC, fed back into story prompts so later turns stay consistent.
function npcProfilesContext(limit=10){
  const known=[...npcProfiles.values()].slice(-limit);
  if(!known.length)return 'HỒ SƠ NPC ĐÃ XÁC LẬP: chưa có.';
  return `HỒ SƠ NPC ĐÃ XÁC LẬP (giữ đúng, không mâu thuẫn): ${known.map(p=>`${p.speaker} = ${p.fullName}, tự ${p.courtesyName}; ${p.identity}; ${p.realm}${p.level?` cấp ${p.level}`:''}; tính cách: ${p.personality}; ${Object.entries(CHARACTER_STAT_LABELS).map(([key,label])=>`${label} ${p.stats[key]}`).join(', ')}`).join(' | ')}`;
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
      `<div class="npc-stats">${Object.entries(CHARACTER_STAT_LABELS).map(([key,label])=>`<div><span>${label}</span><b>${key==='health'&&profile.health!=null&&profile.health!==profile.stats.health?`${profile.health.toLocaleString('vi-VN')} / `:''}${profile.stats[key].toLocaleString('vi-VN')}</b></div>`).join('')}</div>`+
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
    if(updated.level===profile.level){updated.stats=profile.stats;if(profile.health!=null)updated.health=Math.min(profile.health,updated.stats.health)}
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
