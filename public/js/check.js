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
  window.addEventListener("resize",updateOrientationGuide);
  window.addEventListener("orientationchange",()=>setTimeout(updateOrientationGuide,250));

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

  const guide=S.sticker.guide_example;

  if(guide){
    $("referenceBox").innerHTML=`<img src="${guide.image_url}?v=${Date.now()}" alt="정상부착 예시사진 1번">`;

    if(guide.calibrated){
      const roi=document.createElement("div");
      roi.className="guide-roi";
      roi.style.cssText=`left:${Number(guide.crop_x)*100}%;top:${Number(guide.crop_y)*100}%;width:${Number(guide.crop_width)*100}%;height:${Number(guide.crop_height)*100}%`;
      roi.innerHTML="<span>스티커 위치</span>";
      $("referenceBox").appendChild(roi);
    }
  }else{
    $("referenceBox").innerHTML='<div class="empty">관리자가 정상부착 예시사진을 등록해야 합니다.</div>';
  }

  $("stickerTitle").textContent=`${S.sticker.name} · 정상부착 예시사진 1번`;
  $("sideHintText").textContent=`권장 위치: ${sideLabel(S.sticker.side_hint)}`;
  $("guideText").textContent=S.sticker.guide_text || "예시사진과 비슷하게 차량과 스티커가 함께 보이도록 촬영해 주세요.";

  resetAllAfterPhoto();
}

async function startCamera(){
  stopCamera();
  try{
    S.stream=await navigator.mediaDevices.getUserMedia({
      audio:false,
      video:{
        facingMode:{ideal:"environment"},
        width:{ideal:1920},height:{ideal:1080},aspectRatio:{ideal:16/9}
      }
    });
    $("cameraVideo").srcObject=S.stream;
    await $("cameraVideo").play();
    $("cameraVideo").style.display="block";
    $("cameraPlaceholder").style.display="none";
    $("captureBtn").disabled=false;
    updateOrientationGuide();
    updateCameraStatus();
  }catch(e){
    $("cameraStatus").textContent="카메라 실패";
    $("captureBtn").disabled=true;
  }
}

function stopCamera(){
  if(S.stream)S.stream.getTracks().forEach(t=>t.stop());
  S.stream=null;
  if($("captureBtn"))$("captureBtn").disabled=true;
}

async function captureVideo(){
  const v=$("cameraVideo");
  if(!S.stream||v.readyState<2)return;
  const c=$("captureCanvas");
  c.width=v.videoWidth;
  c.height=v.videoHeight;
  c.getContext("2d").drawImage(v,0,0,c.width,c.height);
  const blob=await new Promise(resolve=>c.toBlob(resolve,"image/jpeg",.90));
  await preparePhoto(blob);
}

function updateOrientationGuide(){
  if(!$("portraitGuide"))return;
  const isPortrait=window.innerHeight>window.innerWidth;
  $("portraitGuide").classList.toggle("hidden",!(S.stream&&isPortrait));
  if(S.stream)updateCameraStatus();
}

function updateCameraStatus(){
  if(!S.stream)return;
  const isLandscape=window.innerWidth>=window.innerHeight;
  $("cameraStatus").textContent=isLandscape?"가로 촬영 준비":"세로 화면";
  $("orientationMessage").className=`message ${isLandscape?"success":"warn"} compact-orientation-message`;
  $("orientationMessage").textContent=isLandscape
    ? "가로 촬영 준비 완료. 프레임 안에 차량 전체와 스티커가 함께 보이도록 맞춘 뒤 바로 아래 촬영 버튼을 눌러주세요."
    : "휴대폰을 가로로 돌려주세요. 가로모드에서 촬영 프레임과 촬영 버튼이 한 화면에 보이도록 구성되어 있습니다.";
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

    const calibrated=(S.sticker.examples||[]).filter(x=>x.calibrated);

    if(!calibrated.length){
      S.analysis={
        score:0,
        status:"판정불가",
        recommendation:"",
        findings:["관리자가 정상부착 예시사진의 스티커 영역을 먼저 설정해야 합니다."],
        metrics:{damage:0,shape:0,color:0,confidence:0,missing:false}
      };
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
        '<div class="finding ok">동일 사진의 이전 분석결과를 재사용했습니다.</div>'
      );
      $("analysisSection").scrollIntoView({behavior:"smooth"});
      return;
    }

    const result=await analyzeAgainstMasterAndExamples(calibrated);

    S.analysis=result.analysis;
    S.analyzedSelection=result.crop;

    showAnalyzedCrop(result.crop);
    renderAnalysis(result.analysis);

    await saveCachedAnalysis(result).catch(()=>{});

    $("analysisSection").scrollIntoView({behavior:"smooth"});
  }catch(e){
    console.error(e);
    $("resultStatus").textContent="분석 실패";
    $("findings").innerHTML='<div class="finding">분석 중 오류가 발생했습니다. 스티커 영역을 다시 선택해 주세요.</div>';
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
      "구조 손상지수 100%",
      "교체 권고"
    ],
    metrics:{
      damage:100,
      shape:0,
      color:100,
      confidence:100,
      missing:true
    }
  };
}

async function analyzeAgainstMasterAndExamples(examples){
  const master=await loadImage(S.sticker.image_url);
  const masterDescriptor=buildMasterDescriptor(master);

  const normalComparisons=[];

  for(const ex of examples){
    const img=await loadImage(ex.image_url);
    const crop=cropImageElement(img,{
      x:Number(ex.crop_x),
      y:Number(ex.crop_y),
      width:Number(ex.crop_width),
      height:Number(ex.crop_height)
    },1000);

    const cmp=compareNormalizedStructure(masterDescriptor,crop);
    normalComparisons.push(cmp);
  }

  const calibration=buildCalibration(masterDescriptor,normalComparisons);

  const base=stabilizeSelection(
    S.selection,
    S.photoImage.naturalWidth,
    S.photoImage.naturalHeight,
    master.naturalWidth/Math.max(1,master.naturalHeight)
  );

  const candidates=selectionSearchVariants(base);
  let best=null;

  for(const box of candidates){
    const canvas=cropBoxCanvas(S.photoImage,box,1100);
    const cmp=compareNormalizedStructure(masterDescriptor,canvas);
    const relative=relativeStructureScore(cmp.sims,calibration);

    if(!best||relative>best.relative){
      best={box,cmp,relative};
    }
  }

  const damage=calibratedDamageIndex(best.cmp.sims,calibration);
  const preservation=calibratedPreservation(best.cmp.sims,calibration);

  const baselineGlobal=median(normalComparisons.map(x=>x.global));
  const confidence=r1(clamp(
    best.cmp.global/Math.max(.05,baselineGlobal)*100,
    0,100
  ));

  const color=calibratedColorDifference(best.cmp.colorVector,normalComparisons);

  const metrics={
    damage:r1(damage),
    shape:r1(preservation),
    color:r1(color),
    confidence,
    baselineGlobal:r1(baselineGlobal*100),
    stableCells:calibration.stableIndices.length,
    normalExamples:normalComparisons.length,
    missing:false
  };

  const rules=S.rules||defaultRules();
  let status="정상";
  let recommendation="";
  const findings=[];

  // Low confidence is NOT damage.
  if(confidence<62||calibration.stableIndices.length<12){
    status="판정불가";
    findings.push("스티커 구조 검출신뢰도가 낮아 손상으로 판정하지 않았습니다. 영역을 다시 지정하거나 예시사진과 비슷한 각도로 재촬영해 주세요.");
  }else{
    if(Number(rules.use_damage)===1){
      if(metrics.damage>=Number(rules.damage_replace_min)){
        status="확인필요";
        recommendation="교체 권고";
        findings.push(`구조 손상지수 ${metrics.damage}% → 교체 권고`);
      }else if(metrics.damage>Number(rules.damage_normal_max)){
        status="확인필요";
        findings.push(`구조 손상지수 ${metrics.damage}% → 확인필요`);
      }
    }

    if(Number(rules.use_shape)===1&&metrics.shape<Number(rules.shape_similarity_min)){
      status="확인필요";
      findings.push(`구조 보존율 ${metrics.shape}% → 로고·문구·그래픽 확인필요`);
    }

    if(Number(rules.use_color)===1&&metrics.color>Number(rules.color_difference_max)){
      status="확인필요";
      findings.push(`정상부착 예시 대비 색상차이 ${metrics.color} → 변색·오염 확인필요`);
    }

    if(!findings.length){
      findings.push("정상부착 예시의 정상변동 범위 안에서 스티커 구조가 보존되어 있습니다.");
    }
  }

  const score=status==="판정불가"
    ? r1(confidence*.5)
    : r1(clamp(
        (100-metrics.damage)*.50+
        metrics.shape*.35+
        confidence*.10+
        (100-Math.min(100,metrics.color))*.05,
        0,100
      ));

  return{
    crop:best.box,
    analysis:{
      score,
      status,
      recommendation,
      findings,
      metrics
    }
  };
}

function buildMasterDescriptor(img){
  const W=256,H=128,CELL=8,BINS=9;
  const canvas=fitImageCanvas(img,W,H);
  const hog=hogGridFromCanvas(canvas,CELL,BINS);

  const sorted=hog.energy.slice().sort((a,b)=>a-b);
  const threshold=sorted.length
    ? sorted[Math.floor(sorted.length*.55)]
    : 0;

  const informative=hog.energy.map(v=>v>threshold);

  return{
    canvas,
    hog,
    informative,
    W,H,CELL,BINS
  };
}

function compareNormalizedStructure(masterDescriptor,imageOrCanvas){
  const canvas=imageOrCanvas instanceof HTMLCanvasElement
    ? fitCanvasToSize(imageOrCanvas,masterDescriptor.W,masterDescriptor.H)
    : fitImageCanvas(imageOrCanvas,masterDescriptor.W,masterDescriptor.H);

  let best=null;

  const scales=[.92,1,1.08];
  const shifts=[-8,0,8];

  for(const sx of scales){
    for(const sy of scales){
      for(const tx of shifts){
        for(const ty of shifts){
          const transformed=transformCanvas(
            canvas,
            masterDescriptor.W,
            masterDescriptor.H,
            sx,sy,tx,ty
          );

          const hog=hogGridFromCanvas(
            transformed,
            masterDescriptor.CELL,
            masterDescriptor.BINS
          );

          const result=hogSimilarity(
            masterDescriptor.hog,
            hog,
            masterDescriptor.informative
          );

          if(!best||result.weightedMean>best.global){
            best={
              sims:Array.from(result.sims),
              global:result.weightedMean,
              canvas:transformed,
              colorVector:dominantChromaticVector(transformed)
            };
          }
        }
      }
    }
  }

  return best;
}

function buildCalibration(masterDescriptor,comparisons){
  const cellCount=masterDescriptor.hog.histograms.length;
  const baseline=new Float32Array(cellCount);
  const variability=new Float32Array(cellCount);
  const stableIndices=[];

  for(let i=0;i<cellCount;i++){
    if(!masterDescriptor.informative[i])continue;

    const values=comparisons.map(c=>Number(c.sims[i]||0));
    const med=median(values);
    const deviations=values.map(v=>Math.abs(v-med));

    baseline[i]=med;
    variability[i]=median(deviations);

    // Only structure that is actually stable in normal attached examples
    // becomes a damage-measurement point.
    if(med>=.52){
      stableIndices.push(i);
    }
  }

  return{
    baseline,
    variability,
    stableIndices,
    weights:masterDescriptor.hog.energy,
    meanEnergy:masterDescriptor.hog.informativeMeanEnergy
  };
}

function relativeStructureScore(sims,calibration){
  let sum=0,total=0;

  for(const i of calibration.stableIndices){
    const base=Math.max(.10,calibration.baseline[i]);
    const w=calibration.weights[i]/Math.max(.0001,calibration.meanEnergy);

    sum+=clamp(Number(sims[i]||0)/base,0,1)*w;
    total+=w;
  }

  return sum/Math.max(.0001,total);
}

function calibratedDamageIndex(sims,calibration){
  let lost=0,total=0;

  for(const i of calibration.stableIndices){
    const base=calibration.baseline[i];
    const variation=calibration.variability[i];

    // Normal photo-to-photo variation is tolerated.
    const margin=Math.max(.07,variation*2.5);
    const w=calibration.weights[i]/Math.max(.0001,calibration.meanEnergy);

    total+=w;

    if(Number(sims[i]||0)<base-margin){
      lost+=w;
    }
  }

  return clamp(lost/Math.max(.0001,total)*100,0,100);
}

function calibratedPreservation(sims,calibration){
  let sum=0,total=0;

  for(const i of calibration.stableIndices){
    const base=Math.max(.10,calibration.baseline[i]);
    const w=calibration.weights[i]/Math.max(.0001,calibration.meanEnergy);

    sum+=clamp(Number(sims[i]||0)/base,0,1)*w;
    total+=w;
  }

  return clamp(sum/Math.max(.0001,total)*100,0,100);
}

function calibratedColorDifference(userVector,normalComparisons){
  if(!userVector)return 0;

  const values=[];

  for(const c of normalComparisons){
    if(!c.colorVector)continue;

    const d=Math.sqrt(
      (userVector[0]-c.colorVector[0])**2+
      (userVector[1]-c.colorVector[1])**2+
      (userVector[2]-c.colorVector[2])**2
    );

    values.push(clamp(d*175,0,100));
  }

  return values.length?Math.min(...values):0;
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

  // Keep the user selection as a search area but normalize its aspect.
  let width=px.width;
  let height=width/referenceAspect;

  if(height>px.height*1.15){
    height=px.height;
    width=height*referenceAspect;
  }

  width=Math.min(photoW,width*1.06);
  height=Math.min(photoH,height*1.06);

  return{
    x:clamp((cx-width/2)/photoW,0,1-width/photoW),
    y:clamp((cy-height/2)/photoH,0,1-height/photoH),
    width:width/photoW,
    height:height/photoH
  };
}

function selectionSearchVariants(base){
  const out=[];

  const scales=[.90,1,1.10];
  const offsets=[
    [0,0],
    [-.04,0],
    [.04,0],
    [0,-.035],
    [0,.035]
  ];

  for(const scale of scales){
    out.push(scaleBox(base,scale,0,0));
  }

  for(const [dx,dy] of offsets.slice(1)){
    out.push(scaleBox(base,1,dx,dy));
  }

  return uniqueBoxes(out);
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
    const key=[b.x,b.y,b.width,b.height].map(v=>v.toFixed(5)).join("|");

    if(seen.has(key))continue;
    seen.add(key);
    out.push(b);
  }

  return out;
}

function cropImageElement(img,s,maxSide){
  return cropBoxCanvas(img,s,maxSide);
}

function fitImageCanvas(img,W,H){
  const c=document.createElement("canvas");
  c.width=W;
  c.height=H;

  const ctx=c.getContext("2d",{willReadFrequently:true});
  ctx.clearRect(0,0,W,H);

  // Neutral background for transparent master PNGs.
  ctx.fillStyle="#808080";
  ctx.fillRect(0,0,W,H);
  ctx.drawImage(img,0,0,W,H);

  return c;
}

function fitCanvasToSize(source,W,H){
  const c=document.createElement("canvas");
  c.width=W;
  c.height=H;

  const ctx=c.getContext("2d",{willReadFrequently:true});
  ctx.fillStyle="#808080";
  ctx.fillRect(0,0,W,H);
  ctx.drawImage(source,0,0,W,H);

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
    ? sorted[Math.floor(sorted.length*.55)]
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

function hogSimilarity(A,B,informative){
  const sims=new Float32Array(A.histograms.length);
  let weighted=0,totalWeight=0;

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

function dominantChromaticVector(canvas){
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;

  let sr=0,sg=0,sb=0,count=0;

  for(let i=0;i<rgba.length;i+=4){
    const r=rgba[i],g=rgba[i+1],b=rgba[i+2];
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

  return[sr/count,sg/count,sb/count];
}

function median(values){
  const a=values.filter(Number.isFinite).slice().sort((x,y)=>x-y);

  if(!a.length)return 0;

  const m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}


async function getCachedAnalysis(){
  if(!S.photoHash||!S.sticker)return null;

  try{
    const q=new URLSearchParams({
      sticker_id:String(S.sticker.id),
      algorithm_version:"v5-master-calibrated",
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
      algorithm_version:"v5-master-calibrated",
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
  $("confidenceValue").textContent=`${a.metrics.confidence??0}%`;
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
