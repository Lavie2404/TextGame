// Combat is resolved by the numbers, not by the model. Each side has an action gauge that fills by its
// Tốc độ every tick; at 100 it strikes and drops back to 0. Both reaching 100 on the same tick strike
// together (trading blows). A strike deals Công kích − Phòng ngự of the target, at least 1. The fight
// runs until one side's Máu reaches 0. The result is a script the model narrates blow by blow; the
// numbers themselves never appear in the story.
const COMBAT_GAUGE=100;
function simulateCombat(player,enemy){
  const side=(source,name)=>({name,attack:Math.max(0,Math.floor(source.attack||0)),defense:Math.max(0,Math.floor(source.defense||0)),
    speed:Math.max(1,Math.floor(source.speed||0)),maxHealth:Math.max(1,Math.floor(source.maxHealth||source.health||1)),health:Math.max(1,Math.floor(source.health||1)),gauge:0});
  const a=side(player,player.name),b=side(enemy,enemy.name);
  const damage=(from,to)=>Math.max(1,from.attack-to.defense);
  // At least 1 damage per strike and at most 100 ticks per strike, so this many ticks always ends the fight.
  const maxTicks=(a.health+b.health)*COMBAT_GAUGE+COMBAT_GAUGE;
  const strikes=[];
  for(let tick=0;tick<maxTicks&&a.health>0&&b.health>0;tick++){
    a.gauge+=a.speed;b.gauge+=b.speed;
    const aActs=a.gauge>=COMBAT_GAUGE,bActs=b.gauge>=COMBAT_GAUGE;
    if(!aActs&&!bActs)continue;
    // Damage is worked out before it lands so a simultaneous exchange hurts both sides.
    const hitOnB=aActs?damage(a,b):0,hitOnA=bActs?damage(b,a):0;
    if(aActs){a.gauge=0;b.health=Math.max(0,b.health-hitOnB)}
    if(bActs){b.gauge=0;a.health=Math.max(0,a.health-hitOnA)}
    strikes.push({simultaneous:aActs&&bActs,
      hits:[...(aActs?[{from:a.name,to:b.name,damage:hitOnB,targetHealth:b.health,targetMax:b.maxHealth}]:[]),
            ...(bActs?[{from:b.name,to:a.name,damage:hitOnA,targetHealth:a.health,targetMax:a.maxHealth}]:[])]});
  }
  const outcome=a.health<=0&&b.health<=0?'both':a.health<=0?'enemy':b.health<=0?'player':'draw';
  const winner=outcome==='player'?a.name:outcome==='enemy'?b.name:'';
  return {strikes,outcome,winner,player:{name:a.name,health:a.health,maxHealth:a.maxHealth},enemy:{name:b.name,health:b.health,maxHealth:b.maxHealth}};
}
// How a blow reads in prose, from the share of max HP it took and what is left.
function combatBlowWording(hit){
  const share=hit.damage/hit.targetMax,left=hit.targetHealth/hit.targetMax;
  const force=share>=.5?'đòn chí mạng':share>=.25?'đòn rất nặng':share>=.1?'đòn khá nặng':share>=.03?'đòn vừa phải':'đòn sượt nhẹ, gần như không gây hại';
  return {force,state:combatStateWording(left)};
}
function combatStateWording(left){
  return left<=0?'gục xuống, không thể tiếp tục':left<=.2?'thương tích nặng, lảo đảo sắp gục':left<=.5?'bị thương rõ rệt, sức đã hao nhiều':left<=.8?'bị thương nhẹ, vẫn vững thế':'gần như chưa hề hấn gì';
}
const COMBAT_DETAIL_LIMIT=12,COMBAT_PHASES=8;
function describeStrike(strike,index){
  const parts=strike.hits.map(hit=>{const{force,state}=combatBlowWording(hit);return `${hit.from} ra đòn trúng ${hit.to}: ${force}; ${hit.to} ${state}`});
  return `Đòn ${index+1}${strike.simultaneous?' (hai bên cùng xuất thủ, lấy thương đổi thương)':''}: ${parts.join('. ')}.`;
}
// The script handed to the model. A short fight lists every strike; a long one is grouped into phases
// that keep the true count of blows per side and the state each side is left in, so the model can
// narrate a flurry with a few highlighted blows instead of hundreds of lines.
function combatScript(result){
  const {strikes,player,enemy}=result;
  const pct=side=>Math.round(side.health/side.maxHealth*100);
  let lines;
  if(strikes.length<=COMBAT_DETAIL_LIMIT)lines=strikes.map(describeStrike);
  else{
    const size=Math.ceil(strikes.length/COMBAT_PHASES);
    lines=[`Trận đấu kéo dài tổng cộng ${strikes.length} đòn, chia thành ${Math.ceil(strikes.length/size)} đợt; kể mỗi đợt như một loạt chiêu dồn dập, chọn vài đòn tiêu biểu để tả kỹ.`];
    for(let start=0;start<strikes.length;start+=size){
      const chunk=strikes.slice(start,start+size),count={},last={};
      chunk.forEach(strike=>strike.hits.forEach(hit=>{count[hit.from]=(count[hit.from]||0)+1;last[hit.to]=hit}));
      const swaps=chunk.filter(strike=>strike.simultaneous).length;
      const who=Object.entries(count).map(([name,n])=>`${name} ra ${n} đòn`).join(', ');
      const states=Object.values(last).map(hit=>`${hit.to} ${combatStateWording(hit.targetHealth/hit.targetMax)}`).join('; ');
      lines.push(`Đợt ${lines.length} (đòn ${start+1}–${start+chunk.length}): ${who}${swaps?`, trong đó ${swaps} lần hai bên cùng xuất thủ`:''}. Sau đợt này: ${states}.`);
    }
    lines.push(`Đòn cuối cùng — ${describeStrike(strikes.at(-1),strikes.length-1)}`);
  }
  const ending=result.outcome==='player'||result.outcome==='enemy'
    ?`KẾT CỤC: ${result.winner} thắng. ${result.winner===player.name?enemy.name:player.name} gục, không còn sức chiến đấu. ${result.winner} còn khoảng ${pct(result.winner===player.name?player:enemy)}% sức lực.`
    :result.outcome==='both'?'KẾT CỤC: cả hai cùng gục sau đòn cuối, không ai thắng.'
    :`KẾT CỤC: bất phân thắng bại, hai bên kiệt sức dừng tay. ${player.name} còn khoảng ${pct(player)}% sức lực, ${enemy.name} còn khoảng ${pct(enemy)}%.`;
  return [...lines,ending].join('\n');
}
