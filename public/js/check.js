const $=id=>document.getElementById(id);

const S={
  stickers:[],
  sticker:null,
  rules:null,
  stream:null,
  photoBlob:null,
  photoImage:null,
  photoUrl:null,
  selection:null,
  drawing:false,
  start:null,
  analysis:null,
  photoHash:null,
  analyzedSelection:null
};

document.addEventListener("DOMContentLoaded",()=>{
  bind();
  restoreProfile();
  loadConfig();
});

function bind(){
  $("startCameraBtn").onclick=startCamera;
  $("captureBtn").onclick=captureVideo;
  $("photoInput").onchange=pickFile;

  $("selectionStage").addEventListener("pointerdown",startSelect);
  $("selectionStage").addEventListener("pointermove",moveSelect);
  window.addEventListener("pointerup",endSelect);

  $("resetSelectionBtn").onclick=resetSelection;
  $("stickerMissingCheck").onchange=toggleMissing;
  $("analyzeBtn").onclick=analyzeSelected;
  $("submitBtn").onclick=submitInspection;

  ["employeeName","employeeId","department","vehicleNo"].forEach(id=>{
    $(id).addEventListener("input",saveProfile);
  });
}

async function loadConfig(){
  try{
    const r=await fetchTimeout("/api/config",{},15000);
    const d=await r.json();

    if(!r.ok)throw new Error(d.error||"설정 조회 실패");

    S.stickers=d.stickers||[];
    S.rules=d.rules||defaultRules();

    $("configStatus").textContent=S.stickers.length?`${S.stickers.length}종 등록`:"미등록";

    $("stickerTabs").innerHTML=S.stickers.map(x=>`
      <button class="sticker-tab" data-id="${x.id}">
        ${esc(x.name)}
      </button>
    `).join("");

    document.querySelectorAll(".sticker-tab").forEach(b=>{
      b.onclick=()=>selectSticker(Number(b.dataset.id));
    });

    if(S.stickers[0]){
      selectSticker(S.stickers[0].id);
    }else{
      $("referenceBox").innerHTML='<div class="empty">관리자가 기준 스티커를 등록해야 합니다.</div>';
    }
  }catch(e){
    $("configStatus").textContent="오류";
    $("referenceBox").innerHTML=`<div class="message error">${esc(e.message)}</div>`;
  }
}

function selectSticker(id){
  S.sticker=S.stickers.find(x=>Number(x.id)===Number(id));
  if(!S.sticker)return;

  document.querySelectorAll(".sticker-tab").forEach(b=>{
    b.classList.toggle("active",Number(b.dataset.id)===Number(id));
  });

  $("referenceBox").innerHTML=`<img src="${S.sticker.image_url}?v=${Date.now()}" alt="${esc(S.sticker.name)}">`;
  $("stickerTitle").textContent=S.sticker.name;
  $("sideHintText").textContent=`권장 위치: ${sideLabel(S.sticker.side_hint)}`;
  $("guideText").textContent=S.sticker.guide_text || "스티커가 선명하게 보이도록 촬영해 주세요.";

  resetAllAfterPhoto();
}

async function startCamera(){
  stopCamera();

  try{
    S.stream=await navigator.mediaDevices.getUserMedia({
      audio:false,
      video:{
        facingMode:{ideal:"environment"},
        width:{ideal:1920},
        height:{ideal:1080}
      }
    });

    $("cameraVideo").srcObject=S.stream;
    await $("cameraVideo").play();

    $("cameraVideo").style.display="block";
    $("cameraPlaceholder").style.display="none";
    $("captureBtn").disabled=false;
    $("cameraStatus").textContent="LIVE";
  }catch(e){
    $("cameraStatus").textContent="카메라 실패";
  }
}

function stopCamera(){
  if(S.stream)S.stream.getTracks().forEach(t=>t.stop());
  S.stream=null;
}

async function captureVideo(){
  const v=$("cameraVideo");
  if(!S.stream||v.readyState<2)return;

  const c=$("captureCanvas");
  c.width=v.videoWidth;
  c.height=v.videoHeight;
  c.getContext("2d").drawImage(v,0,0);

  const blob=await new Promise(resolve=>c.toBlob(resolve,"image/jpeg",.88));
  await preparePhoto(blob);
}

async function pickFile(e){
  const file=e.target.files?.[0];
  if(!file)return;

  try{
    const blob=await compressImage(file,1800,.88);
    await preparePhoto(blob);
  }catch(err){
    alert("사진을 읽지 못했습니다. 다른 사진으로 다시 시도해 주세요.");
  }
}

async function preparePhoto(blob){
  if(!S.sticker){
    alert("먼저 점검할 스티커를 선택해 주세요.");
    return;
  }

  if(S.photoUrl)URL.revokeObjectURL(S.photoUrl);

  S.photoBlob=blob;
  S.photoImage=await blobImage(blob);
  S.photoHash=visualHash64(S.photoImage);
  S.analyzedSelection=null;
  S.photoUrl=URL.createObjectURL(blob);

  $("selectionImage").src=S.photoUrl;
  $("resultPhoto").innerHTML=`<img src="${S.photoUrl}" alt="차량사진">`;

  $("selectionSection").classList.remove("hidden");
  $("analysisSection").classList.add("hidden");

  resetSelection();

  $("selectionSection").scrollIntoView({behavior:"smooth"});
}

function point(e){
  const r=$("selectionStage").getBoundingClientRect();
  return{
    x:clamp((e.clientX-r.left)/r.width,0,1),
    y:clamp((e.clientY-r.top)/r.height,0,1)
  };
}

function startSelect(e){
  if(!S.photoImage||$("stickerMissingCheck").checked)return;

  e.preventDefault();
  S.drawing=true;
  S.start=point(e);
  S.selection={x:S.start.x,y:S.start.y,width:0,height:0};

  $("selectionBox").classList.remove("hidden");
  renderSelection();
}

function moveSelect(e){
  if(!S.drawing||!S.start)return;

  const p=point(e);

  S.selection={
    x:Math.min(S.start.x,p.x),
    y:Math.min(S.start.y,p.y),
    width:Math.abs(p.x-S.start.x),
    height:Math.abs(p.y-S.start.y)
  };

  renderSelection();
}

function endSelect(){
  if(!S.drawing)return;
  S.drawing=false;

  if(!S.selection||S.selection.width<.02||S.selection.height<.02){
    resetSelection();
    return;
  }

  $("selectionStatus").textContent="선택완료";
  $("analyzeBtn").disabled=false;
}

function renderSelection(){
  if(!S.selection)return;

  const s=S.selection;
  Object.assign($("selectionBox").style,{
    left:`${s.x*100}%`,
    top:`${s.y*100}%`,
    width:`${s.width*100}%`,
    height:`${s.height*100}%`
  });
}

function resetSelection(){
  S.selection=null;
  S.drawing=false;
  S.start=null;

  $("selectionBox").classList.add("hidden");
  $("selectionStatus").textContent="영역 선택";
  $("analyzeBtn").disabled=!$("stickerMissingCheck").checked;
}

function toggleMissing(){
  if($("stickerMissingCheck").checked){
    S.selection=null;
    $("selectionBox").classList.add("hidden");
    $("selectionStatus").textContent="스티커 없음";
    $("analyzeBtn").disabled=false;
  }else{
    $("selectionStatus").textContent="영역 선택";
    $("analyzeBtn").disabled=!S.selection;
  }
}

async function analyzeSelected(){
  if(!S.photoBlob||!S.sticker)return;

  const missing=$("stickerMissingCheck").checked;

  if(!missing&&!S.selection){
    alert("스티커 영역을 먼저 드래그해 주세요.");
    return;
  }

  $("analysisSection").classList.remove("hidden");
  $("resultStatus").textContent="분석중";

  try{
    if(missing){
      S.analysis=analyzeMissing();
      S.analyzedSelection={x:0,y:0,width:1,height:1};
      renderAnalysis(S.analysis);
      $("analysisSection").scrollIntoView({behavior:"smooth"});
      return;
    }

    const cached=await getCachedAnalysis();

    if(cached){
      S.analysis={
        score:cached.score,
        status:cached.status,
        recommendation:cached.recommendation||"",
        findings:cached.findings||[],
        metrics:{...(cached.metrics||{}),cacheHit:true}
      };
      S.analyzedSelection=cached.crop;
      showAnalyzedCrop(cached.crop);
      renderAnalysis(S.analysis);
      $("findings").insertAdjacentHTML(
        "afterbegin",
        '<div class="finding ok">동일 사진의 이전 분석값을 재사용했습니다. 동일 사진은 항상 같은 결과가 적용됩니다.</div>'
      );
      $("analysisSection").scrollIntoView({behavior:"smooth"});
      return;
    }

    const result=await analyzeCropStable();
    S.analysis=result.analysis;
    S.analyzedSelection=result.crop;

    showAnalyzedCrop(result.crop);
    renderAnalysis(result.analysis);

    await saveCachedAnalysis(result).catch(()=>{});

    $("analysisSection").scrollIntoView({behavior:"smooth"});
  }catch(e){
    console.error(e);
    $("resultStatus").textContent="분석 실패";
    $("findings").innerHTML='<div class="finding">분석 중 오류가 발생했습니다.</div>';
  }
}

function analyzeMissing(){
  $("resultCrop").innerHTML='<div class="camera-placeholder"><strong>스티커 없음</strong></div>';

  return{
    score:0,
    status:"확인필요",
    recommendation:"교체 권고",
    findings:[
      "스티커가 확인되지 않음",
      "추정 누락률 100%",
      "교체 권고"
    ],
    metrics:{
      damage:100,
      shape:0,
      color:100,
      missing:true
    }
  };
}

async function analyzeCropStable(){
  const reference=await loadImage(S.sticker.image_url);

  // 1. Free-form user selection is converted into a reference-ratio box.
  const base=stabilizeSelection(
    S.selection,
    S.photoImage.naturalWidth,
    S.photoImage.naturalHeight,
    reference.naturalWidth/reference.naturalHeight
  );

  // 2. Analyze several tiny perturbations around the same normalized box.
  //    The median is much less affected by one imperfect drag boundary.
  const variants=selectionVariants(base);
  const measurements=[];

  for(const box of variants){
    const canvas=cropBoxCanvas(S.photoImage,box,1100);
    const blob=await canvasBlob(canvas,.92);
    const current=await blobImage(blob);
    const metrics=compareStickerV3(reference,current);
    measurements.push({box,metrics});
  }

  const damage=median(measurements.map(x=>x.metrics.damage));
  const shape=median(measurements.map(x=>x.metrics.shape));
  const color=median(measurements.map(x=>x.metrics.color));

  // Choose the sample closest to the medians as the canonical displayed/stored crop.
  let chosen=measurements[0];
  let chosenDistance=Infinity;

  for(const item of measurements){
    const d=
      Math.abs(item.metrics.damage-damage)+
      Math.abs(item.metrics.shape-shape)*.7+
      Math.abs(item.metrics.color-color)*.2;

    if(d<chosenDistance){
      chosenDistance=d;
      chosen=item;
    }
  }

  const metrics={
    ...chosen.metrics,
    damage:r1(damage),
    shape:r1(shape),
    color:r1(color),
    ensembleCount:measurements.length,
    cropStabilized:true
  };

  const rules=S.rules||defaultRules();

  let status="정상";
  let recommendation="";
  const findings=[];

  if(Number(rules.use_damage)===1){
    if(metrics.damage>=Number(rules.damage_replace_min)){
      status="확인필요";
      recommendation="교체 권고";
      findings.push(`추정 누락/손상률 ${metrics.damage}% → 교체 권고`);
    }else if(metrics.damage>Number(rules.damage_normal_max)){
      status="확인필요";
      findings.push(`추정 누락/손상률 ${metrics.damage}% → 확인필요`);
    }
  }

  if(Number(rules.use_shape)===1&&metrics.shape<Number(rules.shape_similarity_min)){
    status="확인필요";
    findings.push(`형상 유사도 ${metrics.shape}% → 로고·문구·그래픽 변화 확인필요`);
  }

  if(Number(rules.use_color)===1&&metrics.color>Number(rules.color_difference_max)){
    status="확인필요";
    findings.push(`주요 색상차이 ${metrics.color} → 변색·오염 확인필요`);
  }

  if(!findings.length){
    findings.push("설정된 판정기준에서 뚜렷한 이상징후가 없습니다.");
  }

  const score=r1(clamp(
    metrics.shape*.58+
    (100-metrics.damage)*.37+
    (100-Math.min(100,metrics.color))*.05,
    0,100
  ));

  return{
    crop:chosen.box,
    analysis:{
      score,
      status,
      recommendation,
      findings,
      metrics
    }
  };
}

function stabilizeSelection(s,photoW,photoH,referenceAspect){
  const px={
    x:s.x*photoW,
    y:s.y*photoH,
    width:s.width*photoW,
    height:s.height*photoH
  };

  const cx=px.x+px.width/2;
  const cy=px.y+px.height/2;

  // Expand rather than trim so sticker content is not accidentally clipped.
  let width=Math.max(px.width,px.height*referenceAspect);
  let height=width/referenceAspect;

  width*=1.06;
  height*=1.06;

  width=Math.min(width,photoW);
  height=Math.min(height,photoH);

  // Quantize to reduce 1~2 px finger/mouse differences.
  const grid=4;
  width=Math.max(grid,Math.round(width/grid)*grid);
  height=Math.max(grid,Math.round(height/grid)*grid);

  let x=Math.round((cx-width/2)/grid)*grid;
  let y=Math.round((cy-height/2)/grid)*grid;

  x=clamp(x,0,photoW-width);
  y=clamp(y,0,photoH-height);

  return{
    x:x/photoW,
    y:y/photoH,
    width:width/photoW,
    height:height/photoH
  };
}

function selectionVariants(base){
  const variants=[];
  const scales=[.96,1,1.04];
  const shifts=[
    [0,0],
    [-.012,0],
    [.012,0],
    [0,-.012],
    [0,.012]
  ];

  // Keep the total work small: center at 3 scales + four shifted baseline crops.
  for(const scale of scales){
    variants.push(scaleBox(base,scale,0,0));
  }

  for(const [dx,dy] of shifts.slice(1)){
    variants.push(scaleBox(base,1,dx,dy));
  }

  return uniqueBoxes(variants);
}

function scaleBox(box,scale,dx,dy){
  const cx=box.x+box.width/2+dx*box.width;
  const cy=box.y+box.height/2+dy*box.height;

  const width=box.width*scale;
  const height=box.height*scale;

  return clampBox({
    x:cx-width/2,
    y:cy-height/2,
    width,
    height
  });
}

function clampBox(b){
  const width=clamp(b.width,.01,1);
  const height=clamp(b.height,.01,1);

  return{
    x:clamp(b.x,0,1-width),
    y:clamp(b.y,0,1-height),
    width,
    height
  };
}

function uniqueBoxes(boxes){
  const seen=new Set();
  const out=[];

  for(const b of boxes){
    const key=[
      b.x,b.y,b.width,b.height
    ].map(v=>v.toFixed(5)).join("|");

    if(seen.has(key))continue;
    seen.add(key);
    out.push(b);
  }

  return out;
}

function cropBoxCanvas(img,s,maxSide){
  const sx=s.x*img.naturalWidth;
  const sy=s.y*img.naturalHeight;
  const sw=s.width*img.naturalWidth;
  const sh=s.height*img.naturalHeight;

  const scale=Math.min(1,maxSide/Math.max(sw,sh));

  const c=document.createElement("canvas");
  c.width=Math.max(1,Math.round(sw*scale));
  c.height=Math.max(1,Math.round(sh*scale));

  c.getContext("2d").drawImage(
    img,sx,sy,sw,sh,
    0,0,c.width,c.height
  );

  return c;
}

function showAnalyzedCrop(box){
  const canvas=cropBoxCanvas(S.photoImage,box,1100);
  const url=canvas.toDataURL("image/jpeg",.92);
  $("resultCrop").innerHTML=`<img src="${url}" alt="자동 보정된 스티커 분석영역">`;
}

async function getCachedAnalysis(){
  if(!S.photoHash||!S.sticker)return null;

  try{
    const q=new URLSearchParams({
      sticker_id:String(S.sticker.id),
      algorithm_version:"v4-stable",
      image_hash:S.photoHash
    });

    const r=await fetchTimeout(`/api/analysis-cache?${q}`,{cache:"no-store"},10000);
    const d=await r.json();

    if(!r.ok||!d.hit)return null;
    return d.result||null;
  }catch{
    return null;
  }
}

async function saveCachedAnalysis(result){
  if(!S.photoHash||!S.sticker)return;

  await fetchTimeout("/api/analysis-cache",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({
      sticker_id:S.sticker.id,
      algorithm_version:"v4-stable",
      image_hash:S.photoHash,
      crop:result.crop,
      result:result.analysis
    })
  },10000);
}

function visualHash64(img){
  const c=document.createElement("canvas");
  c.width=9;
  c.height=8;

  const ctx=c.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(img,0,0,9,8);

  const d=ctx.getImageData(0,0,9,8).data;
  const gray=[];

  for(let i=0;i<d.length;i+=4){
    gray.push(.299*d[i]+.587*d[i+1]+.114*d[i+2]);
  }

  let hex="";
  let nibble=0;
  let count=0;

  for(let y=0;y<8;y++){
    for(let x=0;x<8;x++){
      const bit=gray[y*9+x]>gray[y*9+x+1]?1:0;
      nibble=(nibble<<1)|bit;
      count++;

      if(count===4){
        hex+=nibble.toString(16);
        nibble=0;
        count=0;
      }
    }
  }

  return hex;
}

function median(values){
  const a=values
    .filter(Number.isFinite)
    .slice()
    .sort((x,y)=>x-y);

  if(!a.length)return 0;

  const m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}

function compareStickerV3(reference,current){
  const W=256;
  const H=128;
  const CELL=16;
  const BINS=9;

  const refCanvas=fitImageCanvas(reference,W,H);
  const curCanvas=fitImageCanvas(current,W,H);

  const refHog=hogGridFromCanvas(refCanvas,CELL,BINS);
  const informative=buildInformativeMask(refHog.energy);

  let best=null;

  const scales=[.85,1.0,1.15];
  const shiftsX=[-24,-12,0,12,24];
  const shiftsY=[-16,-8,0,8,16];

  for(const sx of scales){
    for(const sy of scales){
      for(const tx of shiftsX){
        for(const ty of shiftsY){
          const transformed=transformCanvas(curCanvas,W,H,sx,sy,tx,ty);
          const curHog=hogGridFromCanvas(transformed,CELL,BINS);
          const result=hogSimilarity(refHog,curHog,informative);

          if(!best||result.weightedMean>best.weightedMean){
            best={
              ...result,
              canvas:transformed,
              sx,sy,tx,ty
            };
          }
        }
      }
    }
  }

  const shape=r1(clamp(best.weightedMean*100,0,100));

  let lowWeight=0;
  let totalWeight=0;

  for(let i=0;i<best.sims.length;i++){
    if(!informative[i])continue;

    const w=refHog.energy[i]/Math.max(.0001,refHog.informativeMeanEnergy);
    totalWeight+=w;

    if(best.sims[i]<.70){
      lowWeight+=w;
    }
  }

  const lowCoverage=clamp(
    lowWeight/Math.max(.0001,totalWeight)*100,
    0,100
  );

  const structuralDeficit=clamp(
    (.88-best.weightedMean)/(.88-.55)*100,
    0,100
  );

  // Balanced calibration:
  // normal cross-colour sample stays low;
  // broad logo/text loss rises into the 30%+ range.
  const damage=r1(clamp(
    .75*Math.min(100,lowCoverage*1.30)+
    .25*structuralDeficit,
    0,100
  ));

  const color=r1(compareStickerColor(refCanvas,best.canvas));

  return{
    damage,
    shape,
    color,
    lowCoverage:r1(lowCoverage),
    structuralDeficit:r1(structuralDeficit),
    alignment:`${best.sx.toFixed(2)}×${best.sy.toFixed(2)} / ${best.tx},${best.ty}`
  };
}

function fitImageCanvas(img,W,H){
  const c=document.createElement("canvas");
  c.width=W;
  c.height=H;

  const ctx=c.getContext("2d",{willReadFrequently:true});
  ctx.fillStyle="#808080";
  ctx.fillRect(0,0,W,H);
  ctx.drawImage(img,0,0,W,H);

  return c;
}

function transformCanvas(source,W,H,sx,sy,tx,ty){
  const c=document.createElement("canvas");
  c.width=W;
  c.height=H;

  const ctx=c.getContext("2d",{willReadFrequently:true});
  ctx.fillStyle="#808080";
  ctx.fillRect(0,0,W,H);

  ctx.save();
  ctx.translate(W/2+tx,H/2+ty);
  ctx.scale(sx,sy);
  ctx.drawImage(source,-W/2,-H/2,W,H);
  ctx.restore();

  return c;
}

function hogGridFromCanvas(canvas,cell,bins){
  const W=canvas.width;
  const H=canvas.height;
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  const rgba=ctx.getImageData(0,0,W,H).data;

  const gray=new Float32Array(W*H);

  for(let p=0,i=0;p<W*H;p++,i+=4){
    gray[p]=.299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2];
  }

  const mag=new Float32Array(W*H);
  const ang=new Float32Array(W*H);

  for(let y=1;y<H-1;y++){
    for(let x=1;x<W-1;x++){
      const p=y*W+x;
      const dx=(gray[p+1]-gray[p-1])*.5;
      const dy=(gray[p+W]-gray[p-W])*.5;

      mag[p]=Math.sqrt(dx*dx+dy*dy);

      let a=Math.atan2(dy,dx)*180/Math.PI;
      if(a<0)a+=180;
      if(a>=180)a-=180;

      ang[p]=a;
    }
  }

  const cols=Math.floor(W/cell);
  const rows=Math.floor(H/cell);

  const histograms=[];
  const energy=[];
  const binWidth=180/bins;

  for(let cy=0;cy<rows;cy++){
    for(let cx=0;cx<cols;cx++){
      const hist=new Float32Array(bins);
      let e=0;

      for(let yy=0;yy<cell;yy++){
        for(let xx=0;xx<cell;xx++){
          const x=cx*cell+xx;
          const y=cy*cell+yy;
          const p=y*W+x;

          const m=mag[p];
          let bin=Math.floor(ang[p]/binWidth);

          if(bin<0)bin=0;
          if(bin>=bins)bin=bins-1;

          hist[bin]+=m;
          e+=m;
        }
      }

      let norm=0;
      for(let i=0;i<bins;i++)norm+=hist[i]*hist[i];
      norm=Math.sqrt(norm);

      if(norm>.000001){
        for(let i=0;i<bins;i++)hist[i]/=norm;
      }

      histograms.push(hist);
      energy.push(e);
    }
  }

  const sorted=energy.slice().sort((a,b)=>a-b);
  const threshold=sorted.length
    ? sorted[Math.floor(sorted.length*.50)]
    : 0;

  const informativeEnergies=energy.filter(e=>e>threshold);
  const informativeMeanEnergy=informativeEnergies.length
    ? informativeEnergies.reduce((a,b)=>a+b,0)/informativeEnergies.length
    : 1;

  return{
    histograms,
    energy,
    rows,
    cols,
    informativeMeanEnergy
  };
}

function buildInformativeMask(energy){
  const sorted=energy.slice().sort((a,b)=>a-b);
  const threshold=sorted.length
    ? sorted[Math.floor(sorted.length*.50)]
    : 0;

  return energy.map(v=>v>threshold);
}

function hogSimilarity(A,B,informative){
  const sims=new Float32Array(A.histograms.length);

  let weighted=0;
  let totalWeight=0;

  for(let i=0;i<A.histograms.length;i++){
    const a=A.histograms[i];
    const b=B.histograms[i];

    let dot=0;
    for(let k=0;k<a.length;k++)dot+=a[k]*b[k];

    const sim=clamp(dot,0,1);
    sims[i]=sim;

    if(!informative[i])continue;

    const w=A.energy[i]/Math.max(.0001,A.informativeMeanEnergy);

    weighted+=sim*w;
    totalWeight+=w;
  }

  return{
    sims,
    weightedMean:weighted/Math.max(.0001,totalWeight)
  };
}

function compareStickerColor(refCanvas,curCanvas){
  const A=dominantChromaticVector(refCanvas);
  const B=dominantChromaticVector(curCanvas);

  if(!A||!B)return 0;

  const distance=Math.sqrt(
    (A[0]-B[0])**2+
    (A[1]-B[1])**2+
    (A[2]-B[2])**2
  );

  return clamp(distance*175,0,100);
}

function dominantChromaticVector(canvas){
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;

  let sr=0,sg=0,sb=0,count=0;

  for(let i=0;i<rgba.length;i+=4){
    const r=rgba[i];
    const g=rgba[i+1];
    const b=rgba[i+2];

    const max=Math.max(r,g,b);
    const min=Math.min(r,g,b);
    const saturation=max===0?0:(max-min)/max;

    if(saturation>.28&&max>40){
      const sum=r+g+b||1;

      sr+=r/sum;
      sg+=g/sum;
      sb+=b/sum;
      count++;
    }
  }

  if(count<20)return null;

  return[
    sr/count,
    sg/count,
    sb/count
  ];
}

function cropSelectedCanvas(img,s,maxSide){
  const sx=s.x*img.naturalWidth;
  const sy=s.y*img.naturalHeight;
  const sw=s.width*img.naturalWidth;
  const sh=s.height*img.naturalHeight;

  const scale=Math.min(1,maxSide/Math.max(sw,sh));

  const c=document.createElement("canvas");
  c.width=Math.max(1,Math.round(sw*scale));
  c.height=Math.max(1,Math.round(sh*scale));

  c.getContext("2d").drawImage(img,sx,sy,sw,sh,0,0,c.width,c.height);

  return c;
}

function renderAnalysis(a){
  $("resultStatus").textContent=a.recommendation?`${a.status} · ${a.recommendation}`:a.status;
  $("resultStatus").className=`badge ${a.status==="정상"?"pill normal":"pill review"}`;

  $("scoreValue").textContent=a.score;
  $("damageValue").textContent=`${a.metrics.damage}%`;
  $("shapeValue").textContent=`${a.metrics.shape}%`;
  $("colorValue").textContent=a.metrics.color;

  $("findings").innerHTML=a.findings.map(x=>`
    <div class="finding ${a.status==="정상"?"ok":""}">
      ${esc(x)}
    </div>
  `).join("");
}

async function submitInspection(){
  if(!S.photoBlob||!S.analysis){
    setSubmitMessage("분석을 먼저 완료해 주세요.","error");
    return;
  }

  const name=$("employeeName").value.trim();
  const vehicle=$("vehicleNo").value.trim();

  if(!name||!vehicle){
    setSubmitMessage("성명과 차량번호를 입력해 주세요.","error");
    return;
  }

  const missing=$("stickerMissingCheck").checked;
  const s=S.analyzedSelection||S.selection||{x:0,y:0,width:1,height:1};

  const meta={
    employee_name:name,
    employee_id:$("employeeId").value.trim(),
    department:$("department").value.trim(),
    vehicle_no:vehicle,
    sticker_id:S.sticker.id,
    crop_x:s.x,
    crop_y:s.y,
    crop_width:s.width,
    crop_height:s.height,
    sticker_missing:missing,
    score:S.analysis.score,
    status:S.analysis.status,
    findings:S.analysis.findings,
    metrics:S.analysis.metrics
  };

  const fd=new FormData();
  fd.append("meta",JSON.stringify(meta));
  fd.append("file",S.photoBlob,"inspection.jpg");

  $("submitBtn").disabled=true;
  setSubmitMessage("저장 중입니다...","info");

  try{
    const r=await fetchTimeout("/api/inspection",{method:"POST",body:fd},30000);
    const d=await r.json();

    if(!r.ok)throw new Error(d.error||"저장 실패");

    setSubmitMessage(`제출 완료 · 접수번호 #${d.id}`,"success");
  }catch(e){
    setSubmitMessage(`${e.message} 다시 시도해 주세요.`,"error");
  }finally{
    $("submitBtn").disabled=false;
  }
}

function resetAllAfterPhoto(){
  $("selectionSection").classList.add("hidden");
  $("analysisSection").classList.add("hidden");
  S.photoBlob=null;
  S.photoImage=null;
  S.selection=null;
  S.analysis=null;
  S.photoHash=null;
  S.analyzedSelection=null;
}

function defaultRules(){
  return{
    damage_normal_max:10,
    damage_replace_min:30,
    shape_similarity_min:70,
    color_difference_max:35,
    use_damage:1,
    use_shape:1,
    use_color:1
  };
}

function sideLabel(v){
  return({
    both:"좌·우 측면 공통",
    driver:"운전석 측면",
    passenger:"조수석 측면",
    rear:"후면",
    front:"전면"
  })[v]||v;
}

function setSubmitMessage(t,c){
  $("submitMessage").textContent=t;
  $("submitMessage").className=`message ${c}`;
}

async function compressImage(file,maxSide,quality){
  const img=await blobImage(file);
  const scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));

  const c=document.createElement("canvas");
  c.width=Math.round(img.naturalWidth*scale);
  c.height=Math.round(img.naturalHeight*scale);

  c.getContext("2d").drawImage(img,0,0,c.width,c.height);

  return canvasBlob(c,quality);
}

function canvasBlob(canvas,quality){
  return new Promise((resolve,reject)=>{
    canvas.toBlob(
      b=>b?resolve(b):reject(new Error("이미지 변환 실패")),
      "image/jpeg",
      quality
    );
  });
}

function blobImage(blob){
  return new Promise((resolve,reject)=>{
    const u=URL.createObjectURL(blob);
    const img=new Image();

    img.onload=()=>{
      URL.revokeObjectURL(u);
      resolve(img);
    };

    img.onerror=()=>{
      URL.revokeObjectURL(u);
      reject(new Error("이미지 로드 실패"));
    };

    img.src=u;
  });
}

function loadImage(url){
  return new Promise((resolve,reject)=>{
    const img=new Image();

    img.onload=()=>resolve(img);
    img.onerror=()=>reject(new Error("기준 스티커 로드 실패"));
    img.src=`${url}?v=${Date.now()}`;
  });
}

function fetchTimeout(url,opts={},ms=20000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),ms);

  return fetch(url,{...opts,signal:controller.signal})
    .catch(e=>{
      if(e.name==="AbortError")throw new Error("서버 응답시간을 초과했습니다.");
      throw e;
    })
    .finally(()=>clearTimeout(timer));
}

function saveProfile(){
  localStorage.setItem("sticker_compare_profile",JSON.stringify({
    employeeName:$("employeeName").value,
    employeeId:$("employeeId").value,
    department:$("department").value,
    vehicleNo:$("vehicleNo").value
  }));
}

function restoreProfile(){
  try{
    const p=JSON.parse(localStorage.getItem("sticker_compare_profile")||"{}");

    Object.keys(p).forEach(k=>{
      if($(k))$(k).value=p[k]||"";
    });
  }catch{}
}

function mean(a){return a.reduce((x,y)=>x+y,0)/(a.length||1)}
function clamp(v,a,b){return Math.min(b,Math.max(a,v))}
function r1(v){return Math.round(v*10)/10}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
