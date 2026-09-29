// Schools are categories; each manual has its own name and a school key at [5].
const demonicSchools = {
  blood: {label:'Huyết công',names:['Dẫn Huyết Quyết','Huyết Nguyên Kinh','Huyết Hải Tâm Kinh','Huyền Huyết Đại Pháp','Thiên Huyết Ma Kinh','Vạn Huyết Ma Điển'],condition:rank=>`Mỗi lượt cần ${rank} phần máu người hoặc động vật.`,pay:rank=>consumeCultivationBlood(rank)},
  necromancy: {label:'Tử Linh thuật',names:['Dẫn Thi Quyết','U Minh Dịch Linh Kinh','Bạch Cốt Khế Thư','Vong Xuyên Ngự Linh Lục','Cửu U Dịch Hồn Kinh','Vạn Linh Quy Táng Điển'],condition:rank=>`Cần ít nhất một nô bộc tử linh; dùng thi thể người hoặc động vật để tạo nô bộc. Điều khiển tối đa ${rank*2} nô bộc.`,pay:()=>servants.length>0},
  poison: {label:'Độc công',names:['Thực Độc Quyết','Bích Chướng Tâm Kinh','Ngũ Độc Quy Nguyên','U La Độc Kinh','Thiên Chu Tâm Pháp','Vạn Độc Quy Tông'],condition:rank=>`Mỗi lượt hấp thu ${rank} phần độc thảo; thiếu độc thảo không thể tu luyện.`,pay:rank=>consumeMaterial('poison',rank)},
  curse: {label:'Chú oán',names:['Kết Oán Quyết','Hắc Ấn Chú Kinh','U Oán Tỏa Tâm','Cửu Kết Chú Thư','Thiên Oán Linh Văn','Vạn Kiếp Chú Điển'],condition:rank=>`Mỗi lượt cần ${rank} lá oán phù làm vật dẫn.`,pay:rank=>consumeMaterial('talisman',rank)},
  shadow: {label:'Ảnh tu',names:['Ẩn Ảnh Quyết','Vô Đăng Tâm Kinh','Tàng Nguyệt Ảnh Lục','Hắc Dạ Quy Nguyên','Thiên Ảnh Vô Hình','Vĩnh Dạ Tâm Điển'],condition:()=> 'Phải nhập thất trong bóng tối: mỗi lượt nhập thất không dùng bạo phát; cần bật chế độ nhập thất.',pay:()=>shadowRetreat&&!pendingBurst}
};
const occultMaterials={animalCorpse:0,humanCorpse:0,poison:0,talisman:0};
const materialOffers={animalCorpse:['Thi thể động vật',20],humanCorpse:['Thi thể người',20],poison:['Độc thảo',5],talisman:['Oán phù',5]};
let servants=[],nextServantId=1,shadowRetreat=false;
function demonicSchool(item){return demonicSchools[item[5]||'blood']}
function consumeMaterial(key,amount){if((occultMaterials[key]||0)<amount)return false;occultMaterials[key]-=amount;return true}
function activeNecromancy(){return skills.find(item=>item[3]!==false&&item[4]==='demonic'&&item[5]==='necromancy')}
function raiseServant(source){
  const art=activeNecromancy();
  if(!art)return 'Hãy bật một tâm pháp Tử Linh thuật trước.';
  if(!['animalCorpse','humanCorpse'].includes(source))return 'Thi thể không hợp lệ.';
  if(servants.length>=itemRank(art)*2)return 'Đã đạt giới hạn điều khiển nô bộc của tâm pháp.';
  if(!consumeMaterial(source,1))return 'Không có thi thể tương ứng.';
  servants.push({id:nextServantId,name:`U Ảnh ${nextServantId++}`,source,job:'rest'});
  return 'Đã tạo nô bộc tử linh. Chọn công việc để sai khiến.';
}
function controlledServants(){const art=activeNecromancy();return art?servants.slice(0,itemRank(art)*2):[]}
function performServantWork(){
  let coins=0,herbs=0;
  controlledServants().forEach(servant=>{if(servant.job==='work')coins+=5;if(servant.job==='gather')herbs++});
  inventoryCoins+=coins;occultMaterials.poison+=herbs;
  return coins||herbs?` Nô bộc mang về ${coins} đồng, ${herbs} phần độc thảo.`:'';
}
function occultContext(){return `NGUYÊN LIỆU PHÁP MÔN: ${Object.entries(materialOffers).map(([key,[label]])=>`${label} ${occultMaterials[key]}`).join(', ')}. Nhập thất bóng tối: ${shadowRetreat?'bật, không tham gia hành động ngoài thất':'tắt'}. Nô bộc đang điều khiển: ${controlledServants().map(s=>`${s.name} (${s.source==='humanCorpse'?'thi thể người':'thi thể động vật'}, ${s.job==='work'?'làm việc kiếm tiền':s.job==='gather'?'hái độc thảo':'chờ lệnh'})`).join('; ')||'không có'}. Các nô bộc khác ngừng làm việc khi không đủ khả năng điều khiển. Không tự tạo tài nguyên hoặc nô bộc ngoài số liệu này.`}
function renderOccultPanel(){
  const panel=document.querySelector('#occult-panel');if(!panel)return;
  const activeIds=new Set(controlledServants().map(s=>s.id));
  panel.innerHTML=`<p class="inventory-empty">Nguyên liệu chỉ dùng cho nhánh pháp môn tương ứng.</p>`+Object.entries(materialOffers).map(([key,[label,price]])=>`<p class="inventory-empty">${label}: ${occultMaterials[key]}</p><button type="button" data-buy-material="${key}" ${inventoryCoins<price?'disabled':''}>Mua ${label} · ${price} đồng</button>`).join('')+
    `<p class="inventory-empty">Ảnh tu</p><label><input type="checkbox" id="shadow-retreat" ${shadowRetreat?'checked':''}> Nhập thất bóng tối (không dùng bạo phát)</label><p class="inventory-empty">Tử linh: mỗi lượt thành công, nô bộc làm việc nhận 5 đồng hoặc hái 1 độc thảo. Cần đang bật Tử Linh thuật; nô bộc vượt giới hạn sẽ nghỉ.</p><button type="button" data-raise="animalCorpse">Tạo nô bộc từ thi thể động vật</button><button type="button" data-raise="humanCorpse">Tạo nô bộc từ thi thể người</button>`+
    servants.map(s=>`<label>${s.name} · ${s.source==='humanCorpse'?'Người':'Động vật'} · ${activeIds.has(s.id)?'Đang điều khiển':'Ngừng hoạt động'}<select data-servant-job="${s.id}"><option value="rest" ${s.job==='rest'?'selected':''}>Chờ lệnh</option><option value="work" ${s.job==='work'?'selected':''}>Làm việc kiếm tiền</option><option value="gather" ${s.job==='gather'?'selected':''}>Hái độc thảo</option></select></label>`).join('');
}
