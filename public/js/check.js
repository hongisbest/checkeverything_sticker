const $=id=>document.getElementById(id);

const S={
  stickers:[],
  sticker:null,
  vehicleType:null,
  rules:null,
  referenceCache:{},
  stream:null,
  photoBlob:null,
  photoImage:null,
  photoUrl:null,
  selection:null,
  drawing:false,
  start:null,
  analysis:null,
  photoHash:null,
  analyzedSelection:null,
  plateSelection:null,
  selectionMode:"sticker",
  draftSelection:null,
  plateVisibility:null,
  plateMatchConfirmed:false,
  plateOcrResult:null,
  submitting:false
};

window.addEventListener("error",e=>{
  const message=e?.error?.message||e?.message||"알 수 없는 화면 오류";
  showRuntimeError(message);
});

window.addEventListener("unhandledrejection",e=>{
  const reason=e?.reason;
  const message=reason?.message||String(reason||"알 수 없는 처리 오류");
  showRuntimeError(message);
});

function showRuntimeError(message){
  const box=$("runtimeErrorBanner");
  if(!box)return;
  box.textContent=`화면 처리 중 오류가 발생했습니다: ${message}`;
  box.classList.remove("hidden");
}

document.addEventListener("DOMContentLoaded",()=>{
  bind();
  restoreProfile();
  loadConfig();
});

function bind(){
  document.querySelectorAll(".vehicle-tab").forEach(btn=>{
    btn.onclick=()=>selectVehicleType(btn.dataset.vehicle);
  });

  $("startCameraBtn").onclick=startCamera;
  $("captureBtn").onclick=captureVideo;
  $("photoInput").onchange=pickFile;

  $("selectionStage").addEventListener("pointerdown",startSelect);
  $("selectionStage").addEventListener("pointermove",moveSelect);
  window.addEventListener("pointerup",endSelect);

  $("stickerModeBtn").onclick=()=>setSelectionMode("sticker");
  $("plateModeBtn").onclick=()=>setSelectionMode("plate");
  $("resetStickerBtn").onclick=resetStickerSelection;
  $("resetPlateBtn").onclick=resetPlateSelection;
  $("stickerMissingCheck").onchange=toggleMissing;
  $("analyzeBtn").onclick=openSubmissionReview;
  $("backToSelectionBtn").onclick=backToSelection;
  $("plateMatchConfirm").onchange=()=>{
    S.plateMatchConfirmed=$("plateMatchConfirm").checked;
  };
  $("submitBtn").addEventListener("click",submitInspection);

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
      renderVehicleGuide();
    }else{
      $("referenceBox").innerHTML='<div class="empty">관리자가 기준 스티커를 등록해야 합니다.</div>';
    }
  }catch(e){
    $("configStatus").textContent="오류";
    $("referenceBox").innerHTML=`<div class="message error">${esc(e.message)}</div>`;
  }
}

function selectVehicleType(type){
  if(!["k3","avante","ev3"].includes(type))return;

  S.vehicleType=type;

  document.querySelectorAll(".vehicle-tab").forEach(btn=>{
    btn.classList.toggle("active",btn.dataset.vehicle===type);
  });

  renderVehicleGuide();
  resetAllAfterPhoto();
}

function selectSticker(id){
  S.sticker=S.stickers.find(x=>Number(x.id)===Number(id));
  if(!S.sticker)return;

  document.querySelectorAll(".sticker-tab").forEach(b=>{
    b.classList.toggle("active",Number(b.dataset.id)===Number(id));
  });

  renderVehicleGuide();
  resetAllAfterPhoto();
}

function getVehicleExample(sticker=S.sticker,vehicleType=S.vehicleType){
  if(!sticker||!vehicleType)return null;

  return (sticker.examples||[]).find(x=>
    x.vehicle_type===vehicleType && x.calibrated
  ) || (sticker.examples||[]).find(x=>
    x.vehicle_type===vehicleType
  ) || null;
}

function renderVehicleGuide(){
  const box=$("referenceBox");

  if(!S.vehicleType){
    if(box._guideResizeObserver){
      box._guideResizeObserver.disconnect();
      box._guideResizeObserver=null;
    }

    box.innerHTML='<div class="empty">먼저 K3 / 아반떼 / EV3 중 차량 종류를 선택해 주세요.</div>';
    $("stickerTitle").textContent=S.sticker ? S.sticker.name : "촬영가이드";
    $("sideHintText").textContent=S.sticker
      ? `권장 위치: ${sideLabel(S.sticker.side_hint)}`
      : "부착 위치";
    $("guideText").textContent="선택한 차종의 정상 예시사진만 비교기준으로 사용됩니다.";
    return;
  }

  if(!S.sticker){
    box.innerHTML='<div class="empty">점검할 스티커를 선택해 주세요.</div>';
    return;
  }

  const guide=getVehicleExample();

  if(guide){
    renderGuideExample(guide);
  }else{
    if(box._guideResizeObserver){
      box._guideResizeObserver.disconnect();
      box._guideResizeObserver=null;
    }

    box.innerHTML=`<div class="message error">${vehicleLabel(S.vehicleType)} 정상 예시사진이 아직 연결되지 않았습니다. 관리자에게 문의해 주세요.</div>`;
  }

  $("stickerTitle").textContent=`${vehicleLabel(S.vehicleType)} · ${S.sticker.name}`;
  $("sideHintText").textContent=`권장 위치: ${sideLabel(S.sticker.side_hint)}`;
  $("guideText").textContent=S.sticker.guide_text ||
    "촬영 방향은 자유입니다. 번호판과 스티커가 한 사진에 함께 선명하게 보이도록 촬영해 주세요.";
}

function renderGuideExample(guide){
  const box=$("referenceBox");

  if(box._guideResizeObserver){
    box._guideResizeObserver.disconnect();
    box._guideResizeObserver=null;
  }

  box.innerHTML=`
    <div class="guide-media-frame">
      <img src="${guide.image_url}?v=${Date.now()}" alt="정상부착 예시사진 1번">
    </div>
  `;

  const frame=box.querySelector(".guide-media-frame");
  const img=frame.querySelector("img");

  if(guide.calibrated){
    const roi=document.createElement("div");
    roi.className="guide-roi";
    roi.style.cssText=`left:${Number(guide.crop_x)*100}%;top:${Number(guide.crop_y)*100}%;width:${Number(guide.crop_width)*100}%;height:${Number(guide.crop_height)*100}%`;
    roi.innerHTML="<span>스티커 위치</span>";
    frame.appendChild(roi);
  }

  if(guide.plate_calibrated){
    const plate=document.createElement("div");
    plate.className="guide-plate-roi";
    plate.style.cssText=`left:${Number(guide.plate_x)*100}%;top:${Number(guide.plate_y)*100}%;width:${Number(guide.plate_width)*100}%;height:${Number(guide.plate_height)*100}%`;
    plate.innerHTML="<span>번호판 위치</span>";
    frame.appendChild(plate);
  }

  const syncFrameToImage=()=>{
    if(!img.naturalWidth||!img.naturalHeight)return;

    const boxWidth=box.clientWidth;
    const boxHeight=box.clientHeight;
    if(!boxWidth||!boxHeight)return;

    const scale=Math.min(
      boxWidth/img.naturalWidth,
      boxHeight/img.naturalHeight
    );

    frame.style.width=`${Math.max(1,Math.round(img.naturalWidth*scale))}px`;
    frame.style.height=`${Math.max(1,Math.round(img.naturalHeight*scale))}px`;
    frame.style.visibility="visible";
  };

  img.addEventListener("load",syncFrameToImage,{once:true});
  if(img.complete)syncFrameToImage();

  if("ResizeObserver" in window){
    box._guideResizeObserver=new ResizeObserver(syncFrameToImage);
    box._guideResizeObserver.observe(box);
  }
}

async function startCamera(){
  stopCamera();

  try{
    S.stream=await navigator.mediaDevices.getUserMedia({
      audio:false,
      video:{
        facingMode:{ideal:"environment"}
      }
    });

    $("cameraVideo").srcObject=S.stream;
    await $("cameraVideo").play();

    $("cameraVideo").style.display="block";
    $("cameraPlaceholder").style.display="none";
    $("captureBtn").disabled=false;
    $("cameraStatus").textContent="카메라 준비";
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
  if(!S.vehicleType){
    alert("먼저 차량 종류(K3 / 아반떼 / EV3)를 선택해 주세요.");
    return;
  }

  if(!S.sticker){
    alert("먼저 점검할 스티커를 선택해 주세요.");
    return;
  }

  const vehicleExample=getVehicleExample();
  if(!vehicleExample||!vehicleExample.calibrated){
    alert(`${vehicleLabel(S.vehicleType)} 정상 예시사진의 스티커 영역이 아직 설정되지 않았습니다. 관리자에게 문의해 주세요.`);
    return;
  }

  if(S.photoUrl)URL.revokeObjectURL(S.photoUrl);

  S.photoBlob=blob;
  S.photoImage=await blobImage(blob);
  S.photoHash=visualHash64(S.photoImage);
  S.analyzedSelection=null;
  S.photoUrl=URL.createObjectURL(blob);

  $("selectionImage").src=S.photoUrl;

  $("selectionSection").classList.remove("hidden");
  $("submissionSection").classList.add("hidden");

  S.selection=null;
  S.plateSelection=null;
  S.plateVisibility=null;
  S.plateMatchConfirmed=false;
  S.plateOcrResult=null;
  S.draftSelection=null;
  S.analyzedSelection=null;

  $("stickerMissingCheck").checked=false;
  $("stickerSelectionBox").classList.add("hidden");
  $("plateSelectionBox").classList.add("hidden");
  $("draftSelectionBox").classList.add("hidden");

  $("stickerSelectionState").textContent="스티커 미지정";
  $("stickerSelectionState").className="pill review";
  $("plateSelectionState").textContent="번호판 미지정";
  $("plateSelectionState").className="pill review";

  setSelectionMode("sticker");
  updateRequiredAreaState();

  $("selectionSection").scrollIntoView({behavior:"smooth"});
}

function point(e){
  const r=$("selectionStage").getBoundingClientRect();
  return{
    x:clamp((e.clientX-r.left)/r.width,0,1),
    y:clamp((e.clientY-r.top)/r.height,0,1)
  };
}

function setSelectionMode(mode){
  if(!["sticker","plate"].includes(mode))return;

  if(mode==="sticker"&&$("stickerMissingCheck").checked){
    mode="plate";
  }

  S.selectionMode=mode;
  S.draftSelection=null;
  $("draftSelectionBox").classList.add("hidden");

  $("stickerModeBtn").classList.toggle("primary",mode==="sticker");
  $("plateModeBtn").classList.toggle("primary",mode==="plate");

  $("selectionStatus").textContent=mode==="sticker"
    ? "스티커 선택"
    : "번호판 선택";
}

function startSelect(e){
  if(!S.photoImage)return;
  if(S.selectionMode==="sticker"&&$("stickerMissingCheck").checked)return;

  e.preventDefault();

  S.drawing=true;
  S.start=point(e);
  S.draftSelection={x:S.start.x,y:S.start.y,width:0,height:0};

  $("draftSelectionBox").classList.remove("hidden");
  renderBox($("draftSelectionBox"),S.draftSelection);
}

function moveSelect(e){
  if(!S.drawing||!S.start)return;

  const p=point(e);

  S.draftSelection={
    x:Math.min(S.start.x,p.x),
    y:Math.min(S.start.y,p.y),
    width:Math.abs(p.x-S.start.x),
    height:Math.abs(p.y-S.start.y)
  };

  renderBox($("draftSelectionBox"),S.draftSelection);
}

function endSelect(){
  if(!S.drawing)return;

  S.drawing=false;

  if(!S.draftSelection||
     S.draftSelection.width<.015||
     S.draftSelection.height<.015){
    S.draftSelection=null;
    $("draftSelectionBox").classList.add("hidden");
    return;
  }

  if(S.selectionMode==="sticker"){
    S.selection={...S.draftSelection};
    renderBox($("stickerSelectionBox"),S.selection);
    $("stickerSelectionBox").classList.remove("hidden");
    $("stickerSelectionState").textContent="스티커 지정완료";
    $("stickerSelectionState").className="pill normal";

    setSelectionMode("plate");
  }else{
    S.plateSelection={...S.draftSelection};
    S.plateVisibility=analyzePlateVisibility(S.photoImage,S.plateSelection);
    S.plateMatchConfirmed=false;
    S.plateOcrResult=null;
    if($("plateMatchConfirm"))$("plateMatchConfirm").checked=false;

    renderBox($("plateSelectionBox"),S.plateSelection);
    $("plateSelectionBox").classList.remove("hidden");

    $("plateSelectionState").textContent=S.plateVisibility.score>=22
      ? "번호판 확인완료"
      : "번호판 재확인 권장";

    $("plateSelectionState").className=S.plateVisibility.score>=22
      ? "pill normal"
      : "pill review";
  }

  S.draftSelection=null;
  $("draftSelectionBox").classList.add("hidden");
  updateRequiredAreaState();
}

function renderBox(el,s){
  if(!el||!s)return;

  Object.assign(el.style,{
    left:`${s.x*100}%`,
    top:`${s.y*100}%`,
    width:`${s.width*100}%`,
    height:`${s.height*100}%`
  });
}

function resetStickerSelection(){
  S.selection=null;
  S.analyzedSelection=null;

  $("stickerSelectionBox").classList.add("hidden");
  $("stickerSelectionState").textContent=$("stickerMissingCheck").checked
    ? "스티커 없음"
    : "스티커 미지정";
  $("stickerSelectionState").className=$("stickerMissingCheck").checked
    ? "pill normal"
    : "pill review";

  if(!$("stickerMissingCheck").checked){
    setSelectionMode("sticker");
  }

  updateRequiredAreaState();
}

function resetPlateSelection(){
  S.plateSelection=null;
  S.plateVisibility=null;
  S.plateMatchConfirmed=false;
  S.plateOcrResult=null;

  if($("plateMatchConfirm"))$("plateMatchConfirm").checked=false;
  $("plateSelectionBox").classList.add("hidden");
  $("plateSelectionState").textContent="번호판 미지정";
  $("plateSelectionState").className="pill review";

  setSelectionMode("plate");
  updateRequiredAreaState();
}

function toggleMissing(){
  if($("stickerMissingCheck").checked){
    S.selection=null;
    S.analyzedSelection=null;

    $("stickerSelectionBox").classList.add("hidden");
    $("stickerSelectionState").textContent="스티커 없음";
    $("stickerSelectionState").className="pill normal";

    setSelectionMode("plate");
  }else{
    $("stickerSelectionState").textContent=S.selection
      ? "스티커 지정완료"
      : "스티커 미지정";
    $("stickerSelectionState").className=S.selection
      ? "pill normal"
      : "pill review";

    if(!S.selection)setSelectionMode("sticker");
  }

  updateRequiredAreaState();
}

function updateRequiredAreaState(){
  const stickerOk=$("stickerMissingCheck").checked||!!S.selection;
  const plateOk=!!S.plateSelection;

  $("analyzeBtn").disabled=!(stickerOk&&plateOk);

  if(stickerOk&&plateOk){
    const weakPlate=S.plateVisibility&&S.plateVisibility.score<22;

    $("selectionStatus").textContent="필수영역 확인완료";
    $("requiredAreaMessage").className=`message ${weakPlate?"warn":"success"}`;
    $("requiredAreaMessage").textContent=weakPlate
      ? "두 영역은 지정됐지만 번호판 영역이 작거나 흐릴 수 있습니다. 번호판이 실제로 읽을 수 있을 정도로 보이는지 확인한 뒤 분석하세요."
      : "스티커와 번호판이 모두 확인되었습니다. 스티커 부착상태를 분석할 수 있습니다.";
  }else{
    const missing=[];

    if(!stickerOk)missing.push("스티커");
    if(!plateOk)missing.push("번호판");

    $("selectionStatus").textContent=`${missing.join(" · ")} 확인 필요`;
    $("requiredAreaMessage").className="message warn";
    $("requiredAreaMessage").textContent=`${missing.join("와 ")} 영역을 지정해 주세요.`;
  }
}

function normalizeVehicleNo(value){
  return String(value||"")
    .toUpperCase()
    .replace(/[\s\-·.]/g,"")
    .replace(/[^0-9가-힣A-Z]/g,"");
}

function isPlausibleKoreanVehicleNo(value){
  const v=normalizeVehicleNo(value);

  // Common Korean plate forms such as 12가3456 / 123가4567.
  // Region-name legacy plates are not rejected solely for being longer.
  return (
    /^[0-9]{2,3}[가-힣][0-9]{4}$/.test(v) ||
    /^[가-힣]{1,4}[0-9]{1,2}[가-힣][0-9]{4}$/.test(v)
  );
}

async function tryNativePlateOcr(enteredVehicleNo){
  const target=normalizeVehicleNo(enteredVehicleNo);

  if(!S.photoImage||!S.plateSelection){
    showManualPlateFallback();
    return;
  }

  if(typeof window.TextDetector!=="function"){
    S.plateOcrResult={
      supported:false,
      text:"",
      matched:false
    };
    showManualPlateFallback();
    return;
  }

  const source=cropBoxCanvas(S.photoImage,S.plateSelection,1200);
  const prepared=preparePlateForOcr(source);

  try{
    const detector=new window.TextDetector();
    const results=await detector.detect(prepared);

    const raw=(results||[])
      .map(x=>x.rawValue||x.text||"")
      .filter(Boolean)
      .join(" ");

    const normalized=normalizeVehicleNo(raw);
    const matched=Boolean(target && normalized && (
      normalized===target ||
      normalized.includes(target) ||
      target.includes(normalized)
    ));

    S.plateOcrResult={
      supported:true,
      text:normalized||raw.trim(),
      matched
    };

    $("plateOcrPreview").textContent=normalized||raw.trim()||"문자 인식 실패";

    if(matched){
      $("plateOcrMessage").className="message success";
      $("plateOcrMessage").textContent="자동판독 결과가 입력한 차량번호와 일치합니다. 번호판을 한 번 눈으로 확인해 주세요.";
      $("plateMatchConfirm").checked=true;
      S.plateMatchConfirmed=true;
    }else{
      $("plateOcrMessage").className="message warn";
      $("plateOcrMessage").textContent=normalized
        ? `자동판독 후보 '${normalized}'와 입력값 '${target}'이 일치하지 않습니다. OCR 오인식 가능성이 있으므로 확대사진을 직접 확인해 주세요.`
        : "자동판독에 실패했습니다. 확대된 번호판을 직접 확인해 주세요.";
    }
  }catch(e){
    S.plateOcrResult={
      supported:true,
      text:"",
      matched:false,
      error:true
    };
    showManualPlateFallback();
  }
}

function showManualPlateFallback(){
  $("plateOcrPreview").textContent="자동판독 미지원/실패";
  $("plateOcrMessage").className="message info";
  $("plateOcrMessage").textContent="이 브라우저에서는 한국 번호판 자동판독을 안정적으로 사용할 수 없습니다. 확대된 번호판과 입력 차량번호를 직접 대조해 주세요.";
}

function preparePlateForOcr(source){
  const scale=2;
  const c=document.createElement("canvas");
  c.width=Math.max(1,source.width*scale);
  c.height=Math.max(1,source.height*scale);

  const ctx=c.getContext("2d",{willReadFrequently:true});
  ctx.imageSmoothingEnabled=true;
  ctx.drawImage(source,0,0,c.width,c.height);

  const image=ctx.getImageData(0,0,c.width,c.height);
  const d=image.data;

  let sum=0;
  for(let i=0;i<d.length;i+=4){
    const g=.299*d[i]+.587*d[i+1]+.114*d[i+2];
    sum+=g;
  }
  const mean=sum/(d.length/4);
  const threshold=Math.max(80,Math.min(190,mean*.92));

  for(let i=0;i<d.length;i+=4){
    const g=.299*d[i]+.587*d[i+1]+.114*d[i+2];
    const v=g>threshold?255:0;
    d[i]=d[i+1]=d[i+2]=v;
    d[i+3]=255;
  }

  ctx.putImageData(image,0,0);
  return c;
}

function analyzePlateVisibility(img,s){
  const canvas=document.createElement("canvas");
  canvas.width=180;
  canvas.height=72;

  const ctx=canvas.getContext("2d",{willReadFrequently:true});

  const sx=s.x*img.naturalWidth;
  const sy=s.y*img.naturalHeight;
  const sw=s.width*img.naturalWidth;
  const sh=s.height*img.naturalHeight;

  ctx.drawImage(img,sx,sy,sw,sh,0,0,canvas.width,canvas.height);

  const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const gray=new Float32Array(canvas.width*canvas.height);

  let sum=0;
  let sumSq=0;

  for(let i=0,p=0;i<data.length;i+=4,p++){
    const g=.299*data[i]+.587*data[i+1]+.114*data[i+2];
    gray[p]=g;
    sum+=g;
    sumSq+=g*g;
  }

  const n=gray.length;
  const mean=sum/n;
  const variance=Math.max(0,sumSq/n-mean*mean);
  const sd=Math.sqrt(variance);

  let edges=0;
  let edgeTotal=0;

  for(let y=1;y<canvas.height-1;y++){
    for(let x=1;x<canvas.width-1;x++){
      const p=y*canvas.width+x;
      const gx=Math.abs(gray[p+1]-gray[p-1]);
      const gy=Math.abs(gray[p+canvas.width]-gray[p-canvas.width]);

      if(gx+gy>36)edges++;
      edgeTotal++;
    }
  }

  const edgeDensity=edges/Math.max(1,edgeTotal);
  const contrastScore=clamp(sd/55*100,0,100);
  const edgeScore=clamp(edgeDensity/.18*100,0,100);

  return{
    score:r1(contrastScore*.45+edgeScore*.55),
    contrast:r1(contrastScore),
    edgeDensity:r1(edgeDensity*100)
  };
}

function openSubmissionReview(){
  try{
    if(!S.photoBlob||!S.sticker){
      throw new Error("점검사진을 먼저 촬영하거나 업로드해 주세요.");
    }

    const missing=$("stickerMissingCheck").checked;

    if(!S.plateSelection){
      throw new Error("번호판 영역을 먼저 지정해 주세요.");
    }

    if(!missing&&!S.selection){
      throw new Error("스티커 영역을 먼저 지정해 주세요.");
    }

    renderSubmissionReview();

    $("submissionSection").classList.remove("hidden");
    $("submissionSection").scrollIntoView({behavior:"smooth"});
  }catch(e){
    console.error("submission review failed",e);
    showRuntimeError(e?.message||"제출 전 확인화면을 열지 못했습니다.");
    alert(e?.message||"제출 전 확인화면을 열지 못했습니다.");
  }
}

function backToSelection(){
  $("submissionSection").classList.add("hidden");
  $("selectionSection").scrollIntoView({behavior:"smooth"});
}

function renderSubmissionReview(){
  const missing=$("stickerMissingCheck").checked;

  if(missing){
    $("reviewStickerCrop").innerHTML=`
      <div class="capture-review-empty">
        <strong>홍보스티커 없음</strong>
        <span>사용자가 ‘스티커 없음’을 선택했습니다.</span>
      </div>
    `;
    $("reviewStickerState").textContent="스티커 없음";
    $("reviewStickerState").className="pill review";
    $("reviewStickerQuality").className="message warn";
    $("reviewStickerQuality").textContent="실제 차량에 홍보스티커가 없는 경우에만 이 상태로 제출해 주세요.";
  }else{
    const stickerQuality=analyzeRegionVisibility(S.photoImage,S.selection,"sticker");
    renderReviewCrop("reviewStickerCrop",S.selection,"홍보스티커");
    $("reviewStickerState").textContent="영역 확인완료";
    $("reviewStickerState").className="pill normal";
    renderQualityMessage("reviewStickerQuality",stickerQuality,"스티커");
  }

  const plateQuality=analyzeRegionVisibility(S.photoImage,S.plateSelection,"plate");
  renderReviewCrop("reviewPlateCrop",S.plateSelection,"차량번호판");
  $("reviewPlateState").textContent="영역 확인완료";
  $("reviewPlateState").className="pill normal";
  renderQualityMessage("reviewPlateQuality",plateQuality,"번호판");

  const entered=$("vehicleNo").value.trim();
  $("enteredVehicleNoPreview").textContent=entered||"-";

  S.plateMatchConfirmed=false;
  S.plateOcrResult=null;
  $("plateMatchConfirm").checked=false;
  $("plateOcrPreview").textContent="판독 중...";
  $("plateOcrMessage").className="message info";
  $("plateOcrMessage").textContent="번호판 자동판독 가능 여부를 확인하고 있습니다.";

  tryNativePlateOcr(entered).catch(e=>{
    console.warn("plate OCR attempt failed",e);
    showManualPlateFallback();
  });
}

function renderReviewCrop(targetId,selection,label){
  const canvas=cropBoxCanvas(S.photoImage,selection,900);
  const url=canvas.toDataURL("image/jpeg",.92);

  $(targetId).innerHTML=`
    <img src="${url}" alt="${label} 확인영역">
  `;
}

function analyzeRegionVisibility(img,s,type){
  if(!img||!s){
    return{score:0,width:0,height:0,tooSmall:true,lowDetail:true};
  }

  const actualWidth=Math.max(1,Math.round(s.width*img.naturalWidth));
  const actualHeight=Math.max(1,Math.round(s.height*img.naturalHeight));

  const canvas=document.createElement("canvas");
  canvas.width=180;
  canvas.height=96;

  const ctx=canvas.getContext("2d",{willReadFrequently:true});

  ctx.drawImage(
    img,
    s.x*img.naturalWidth,
    s.y*img.naturalHeight,
    s.width*img.naturalWidth,
    s.height*img.naturalHeight,
    0,0,canvas.width,canvas.height
  );

  const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const gray=new Float32Array(canvas.width*canvas.height);

  let sum=0,sumSq=0;

  for(let i=0,p=0;i<data.length;i+=4,p++){
    const g=.299*data[i]+.587*data[i+1]+.114*data[i+2];
    gray[p]=g;
    sum+=g;
    sumSq+=g*g;
  }

  const n=gray.length;
  const mean=sum/n;
  const variance=Math.max(0,sumSq/n-mean*mean);
  const sd=Math.sqrt(variance);

  let edges=0,total=0;

  for(let y=1;y<canvas.height-1;y++){
    for(let x=1;x<canvas.width-1;x++){
      const p=y*canvas.width+x;
      const gx=Math.abs(gray[p+1]-gray[p-1]);
      const gy=Math.abs(gray[p+canvas.width]-gray[p-canvas.width]);

      if(gx+gy>36)edges++;
      total++;
    }
  }

  const edgeDensity=edges/Math.max(1,total);
  const contrastScore=clamp(sd/55*100,0,100);
  const edgeScore=clamp(edgeDensity/.18*100,0,100);

  const minWidth=type==="plate"?90:100;
  const minHeight=type==="plate"?28:35;
  const tooSmall=actualWidth<minWidth||actualHeight<minHeight;
  const score=r1(contrastScore*.45+edgeScore*.55);

  return{
    score,
    width:actualWidth,
    height:actualHeight,
    tooSmall,
    lowDetail:score<22
  };
}

function renderQualityMessage(targetId,q,label){
  const el=$(targetId);

  if(q.tooSmall){
    el.className="message warn";
    el.textContent=`${label} 영역이 ${q.width}×${q.height}px로 작습니다. 실제 대상이 더 크게 보이도록 촬영하거나 영역을 다시 지정하는 것을 권장합니다.`;
    return;
  }

  if(q.lowDetail){
    el.className="message warn";
    el.textContent=`${label} 영역이 어둡거나 흐릴 수 있습니다. 확대사진에서 실제 내용을 알아볼 수 있는지 확인해 주세요.`;
    return;
  }

  el.className="message success";
  el.textContent=`${label} 영역이 충분한 크기와 선명도로 선택되었습니다.`;
}

async function buildAdminOnlyAnalysis(){
  const missing=$("stickerMissingCheck").checked;

  if(missing){
    S.analysis=analyzeMissing();
    S.analyzedSelection={x:0,y:0,width:1,height:1};
    return;
  }

  const calibrated=(S.sticker.examples||[]).filter(x=>x.calibrated);

  if(!calibrated.length){
    S.analysis={
      score:0,
      status:"판정불가",
      recommendation:"",
      findings:[`${vehicleLabel(snapshot.vehicleType)} 정상 예시사진 또는 스티커 영역 설정이 없어 자동판정을 수행하지 못했습니다.`],
      metrics:{damage:0,shape:0,color:0,confidence:0,missing:false}
    };
    S.analyzedSelection=S.selection;
    return;
  }

  try{
    // V12 intentionally bypasses the old same-photo result cache.
    // A corrected sticker selection must always be re-analysed.
    const result=await analyzeAgainstMasterAndExamples(calibrated);
    S.analysis=result.analysis;
    S.analyzedSelection=result.crop;
  }catch(e){
    console.error("admin-only analysis failed",e);

    S.analysis={
      score:0,
      status:"판정불가",
      recommendation:"",
      findings:["자동 분석 중 오류가 발생했습니다. 관리자가 원본 사진과 선택영역을 직접 확인해 주세요."],
      metrics:{damage:0,shape:0,color:0,confidence:0,missing:false,analysisError:true}
    };
    S.analyzedSelection=S.selection;
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
              colorVector:dominantChromaticVector(transformed),
              hogHistograms:hog.histograms.map(h=>Array.from(h)),
              edgeSignature:edgeProjectionSignature(transformed)
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
  return uniqueBoxes([
    scaleBox(base,.94,0,0),
    scaleBox(base,1,0,0),
    scaleBox(base,1.06,0,0),
    scaleBox(base,1,-.035,0),
    scaleBox(base,1,.035,0)
  ]);
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

function cropBoxCanvas(img,s,maxSide){
  if(!img||!s)throw new Error("선택영역 정보가 없습니다.");

  const iw=Number(img.naturalWidth||img.width||0);
  const ih=Number(img.naturalHeight||img.height||0);

  if(!iw||!ih)throw new Error("점검사진 크기를 확인할 수 없습니다.");

  const x=Math.max(0,Math.min(1,Number(s.x)||0));
  const y=Math.max(0,Math.min(1,Number(s.y)||0));
  const width=Math.max(.001,Math.min(1-x,Number(s.width)||0));
  const height=Math.max(.001,Math.min(1-y,Number(s.height)||0));

  const sx=x*iw;
  const sy=y*ih;
  const sw=width*iw;
  const sh=height*ih;

  const scale=Math.min(1,Number(maxSide||1200)/Math.max(sw,sh));

  const c=document.createElement("canvas");
  c.width=Math.max(1,Math.round(sw*scale));
  c.height=Math.max(1,Math.round(sh*scale));

  const ctx=c.getContext("2d");
  if(!ctx)throw new Error("이미지 처리 기능을 사용할 수 없습니다.");

  ctx.drawImage(img,sx,sy,sw,sh,0,0,c.width,c.height);
  return c;
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
  // V12: employee UI must never display automatic judgment values.
  // Results are saved for the administrator only.
  return a;
}

async function submitInspection(event){
  if(event){
    event.preventDefault();
    event.stopPropagation();
  }

  // Never fail silently.
  if(S.submitting){
    showSubmitLive(
      "이미 제출 중입니다.",
      "현재 저장 요청이 진행 중입니다. 잠시만 기다려 주세요.",
      "info"
    );
    return;
  }

  S.submitting=true;

  const submitBtn=$("submitBtn");
  const backBtn=$("backToSelectionBtn");

  submitBtn.disabled=true;
  backBtn.disabled=true;
  submitBtn.textContent="제출 확인 중...";

  showSubmitLive(
    "제출 내용을 확인하고 있습니다.",
    "스티커와 번호판 영역을 확인합니다.",
    "info"
  );

  try{
    if(!S.photoBlob||!S.photoImage||!S.sticker){
      throw new UserSubmitError("점검사진을 먼저 촬영하거나 업로드해 주세요.","selection");
    }

    const name=$("employeeName").value.trim();
    const vehicle=$("vehicleNo").value.trim();
    const missing=$("stickerMissingCheck").checked;

    if(!name||!vehicle){
      throw new UserSubmitError("성명과 차량번호를 입력해 주세요.","profile");
    }

    if(!isPlausibleKoreanVehicleNo(vehicle)){
      throw new UserSubmitError(
        "입력한 차량번호 형식을 다시 확인해 주세요. 예: 222하1701",
        "profile"
      );
    }

    if(!S.plateSelection){
      throw new UserSubmitError(
        "번호판 영역이 지정되지 않았습니다. STEP 04에서 번호판을 다시 지정해 주세요.",
        "selection"
      );
    }

    if(!missing&&!S.selection){
      throw new UserSubmitError(
        "스티커 영역이 지정되지 않았습니다. STEP 04에서 홍보스티커를 다시 지정해 주세요.",
        "selection"
      );
    }

    // All canvas/image validation is now inside the try/catch.
    const plateQuality=analyzeRegionVisibility(
      S.photoImage,
      S.plateSelection,
      "plate"
    );

    if(plateQuality.tooSmall||plateQuality.score<10){
      throw new UserSubmitError(
        "번호판 영역이 너무 작거나 흐려 확인하기 어렵습니다. 번호판이 더 크게 보이도록 영역을 다시 지정하거나 사진을 다시 촬영해 주세요.",
        "selection"
      );
    }

    if(!S.plateMatchConfirmed||!$("plateMatchConfirm").checked){
      throw new UserSubmitError(
        "촬영된 번호판과 입력한 차량번호가 같은지 확인한 뒤 '일치함을 확인했습니다'에 체크해 주세요.",
        "review"
      );
    }

    let stickerQuality={
      score:100,
      width:0,
      height:0,
      tooSmall:false,
      lowDetail:false
    };

    if(!missing){
      stickerQuality=analyzeRegionVisibility(
        S.photoImage,
        S.selection,
        "sticker"
      );

      if(stickerQuality.tooSmall||stickerQuality.score<10){
        throw new UserSubmitError(
          "스티커 영역이 제대로 지정되지 않았거나 너무 작게 촬영되었습니다. 홍보스티커 전체가 보이도록 영역을 다시 지정해 주세요.",
          "selection"
        );
      }
    }

    // Snapshot for admin-only analysis after the raw data has been stored.
    const analysisSnapshot={
      sticker:S.sticker,
      vehicleType:S.vehicleType,
      rules:S.rules||defaultRules(),
      photoImage:S.photoImage,
      selection:S.selection ? {...S.selection} : null,
      plateSelection:{...S.plateSelection},
      missing,
      stickerQuality,
      plateQuality
    };

    showSubmitLive(
      "사진을 서버에 저장하고 있습니다.",
      "업로드 준비 중 · 페이지를 닫지 마세요.",
      "info"
    );
    submitBtn.textContent="사진 준비 중...";

    // Normalize the upload image once more so camera photos cannot become
    // unexpectedly huge on iPhone/high-resolution devices.
    const uploadBlob=await compressBlobImage(
      S.photoBlob,
      1800,
      .86
    );

    const pendingMetrics={
      userAnalysisHidden:true,
      analysisPending:true,
      vehicleType:S.vehicleType,
      stickerCaptureQuality:stickerQuality,
      plateConfirmed:true,
      plateManualMatch:true,
      enteredVehicleNoNormalized:normalizeVehicleNo(vehicle),
      plateOcrSupported:Boolean(S.plateOcrResult?.supported),
      plateOcrText:S.plateOcrResult?.text||"",
      plateOcrMatched:S.plateOcrResult?.matched===true,
      plateVisibilityScore:Number(plateQuality.score||0),
      plateCaptureQuality:plateQuality,
      plateCrop:S.plateSelection,
      userStickerCrop:S.selection
    };

    const selected=S.selection||{
      x:0,
      y:0,
      width:1,
      height:1
    };

    const meta={
      employee_name:name,
      employee_id:$("employeeId").value.trim(),
      department:$("department").value.trim(),
      vehicle_no:vehicle,
      sticker_id:S.sticker.id,
      crop_x:selected.x,
      crop_y:selected.y,
      crop_width:selected.width,
      crop_height:selected.height,
      sticker_missing:missing,
      score:0,
      status:"분석대기",
      findings:["점검사진 접수 완료 · 관리자용 자동분석 대기"],
      metrics:pendingMetrics
    };

    const fd=new FormData();
    fd.append("meta",JSON.stringify(meta));
    fd.append("file",uploadBlob,"inspection.jpg");

    submitBtn.textContent="업로드 중...";

    const d=await uploadInspectionWithProgress(fd,(percent)=>{
      submitBtn.textContent=`업로드 ${percent}%`;
      showSubmitLive(
        "사진을 서버에 저장하고 있습니다.",
        `업로드 ${percent}% · 완료될 때까지 잠시만 기다려 주세요.`,
        "info"
      );
    });

    if(!d?.ok||!Number(d.id)){
      throw new Error(d?.error||"서버에서 접수번호를 받지 못했습니다.");
    }

    const inspectionId=Number(d.id);
    const analysisToken=String(d.analysis_token||"");

    // This is the important completion point:
    // raw DB/R2 data is already stored before any auto analysis starts.
    submitBtn.textContent="제출 완료";

    showSubmitLive(
      "제출이 완료되었습니다.",
      `접수번호 #${inspectionId} · 관리자가 점검결과를 확인합니다.`,
      "success"
    );

    setSubmitMessage(
      `제출이 완료되었습니다. 접수번호 #${inspectionId} · 관리자가 점검결과를 확인합니다.`,
      "success"
    );

    // Keep the success message on screen briefly; no blocking alert needed.
    await waitMs(900);

    resetAfterSuccessfulSubmit();

    // Analysis is best-effort only. It can never undo the raw submission.
    scheduleBackgroundAnalysis(
      inspectionId,
      analysisToken,
      analysisSnapshot
    );

  }catch(e){
    console.error("inspection submit failed",e);

    const message=e instanceof UserSubmitError
      ? e.message
      : `제출에 실패했습니다. ${humanSubmitError(e)}`;

    showSubmitLive(
      "제출하지 못했습니다.",
      message,
      "error"
    );

    setSubmitMessage(message,"error");

    // Visible feedback without relying only on alert().
    submitBtn.textContent="다시 제출";
    submitBtn.disabled=false;
    backBtn.disabled=false;

    if(e instanceof UserSubmitError){
      if(e.target==="selection"){
        $("submissionSection").classList.add("hidden");
        $("selectionSection").classList.remove("hidden");
        $("selectionSection").scrollIntoView({
          behavior:"smooth",
          block:"start"
        });
      }else if(e.target==="profile"){
        window.scrollTo({top:0,behavior:"smooth"});
      }else if(e.target==="review"){
        $("submissionSection").classList.remove("hidden");
        $("submissionSection").scrollIntoView({
          behavior:"smooth",
          block:"start"
        });
      }
    }
  }finally{
    S.submitting=false;

    if(submitBtn.textContent!=="제출 완료"&&submitBtn.disabled){
      submitBtn.disabled=false;
    }

    if(backBtn.disabled){
      backBtn.disabled=false;
    }
  }
}

class UserSubmitError extends Error{
  constructor(message,target=""){
    super(message);
    this.name="UserSubmitError";
    this.target=target;
  }
}

function showSubmitLive(title,detail,type="info"){
  const box=$("submitLiveStatus");

  if(!box)return;

  box.classList.remove("hidden","success","error","info");
  box.classList.add(type);

  $("submitLiveTitle").textContent=title;
  $("submitLiveDetail").textContent=detail;
}

function hideSubmitLive(){
  const box=$("submitLiveStatus");
  if(box)box.classList.add("hidden");
}

function humanSubmitError(error){
  if(!error)return "네트워크 상태를 확인한 뒤 다시 시도해 주세요.";

  if(error.name==="AbortError"){
    return "서버 응답시간을 초과했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.";
  }

  const message=String(error.message||"").trim();

  if(!message){
    return "네트워크 상태를 확인한 뒤 다시 시도해 주세요.";
  }

  return message;
}

function waitMs(ms){
  return new Promise(resolve=>setTimeout(resolve,ms));
}

async function compressBlobImage(blob,maxSide,quality){
  const img=await blobImage(blob);
  const scale=Math.min(
    1,
    maxSide/Math.max(img.naturalWidth,img.naturalHeight)
  );

  const c=document.createElement("canvas");
  c.width=Math.max(1,Math.round(img.naturalWidth*scale));
  c.height=Math.max(1,Math.round(img.naturalHeight*scale));

  c.getContext("2d").drawImage(
    img,
    0,0,
    c.width,c.height
  );

  return canvasBlob(c,quality);
}

function uploadInspectionWithProgress(formData,onProgress){
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();

    xhr.open("POST","/api/inspection",true);
    xhr.timeout=45000;

    xhr.upload.onprogress=e=>{
      if(!e.lengthComputable)return;

      const percent=Math.max(
        1,
        Math.min(99,Math.round(e.loaded/e.total*100))
      );

      if(onProgress)onProgress(percent);
    };

    xhr.onload=()=>{
      let data=null;

      try{
        data=JSON.parse(xhr.responseText||"{}");
      }catch{}

      if(xhr.status>=200&&xhr.status<300){
        if(onProgress)onProgress(100);
        resolve(data||{ok:true});
        return;
      }

      reject(
        new Error(
          data?.error||
          `서버 저장 실패 (${xhr.status})`
        )
      );
    };

    xhr.onerror=()=>{
      reject(
        new Error(
          "서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요."
        )
      );
    };

    xhr.ontimeout=()=>{
      reject(
        new Error(
          "사진 업로드 시간이 초과되었습니다. 네트워크를 확인한 뒤 다시 시도해 주세요."
        )
      );
    };

    xhr.onabort=()=>{
      reject(new Error("사진 업로드가 중단되었습니다."));
    };

    xhr.send(formData);
  });
}

function showSubmitError(message){
  setSubmitMessage(message,"error");
  alert(message);
}

function resetAfterSuccessfulSubmit(){
  stopCamera();

  if(S.photoUrl){
    URL.revokeObjectURL(S.photoUrl);
  }

  S.photoUrl=null;
  S.photoBlob=null;
  S.photoImage=null;
  S.selection=null;
  S.plateSelection=null;
  S.plateVisibility=null;
  S.plateMatchConfirmed=false;
  S.plateOcrResult=null;
  S.draftSelection=null;
  S.analyzedSelection=null;
  S.analysis=null;
  S.photoHash=null;
  S.selectionMode="sticker";

  $("selectionSection").classList.add("hidden");
  $("submissionSection").classList.add("hidden");
  $("photoInput").value="";
  $("selectionImage").removeAttribute("src");

  $("stickerMissingCheck").checked=false;
  $("stickerSelectionBox").classList.add("hidden");
  $("plateSelectionBox").classList.add("hidden");
  $("draftSelectionBox").classList.add("hidden");

  $("stickerSelectionState").textContent="스티커 미지정";
  $("stickerSelectionState").className="pill review";
  $("plateSelectionState").textContent="번호판 미지정";
  $("plateSelectionState").className="pill review";

  $("submitBtn").disabled=false;
  $("backToSelectionBtn").disabled=false;
  $("submitBtn").textContent="점검사진 제출";

  $("cameraStatus").textContent="대기";
  $("cameraVideo").style.display="none";
  $("cameraPlaceholder").style.display="flex";

  const target=$("stickerGuideSection");
  if(target){
    target.scrollIntoView({behavior:"smooth",block:"start"});
  }

  setTimeout(()=>{
    hideSubmitLive();
    setSubmitMessage(
      "새 점검을 진행할 수 있습니다.",
      "info"
    );
  },1200);
}

function scheduleBackgroundAnalysis(id,token,snapshot){
  if(!id||!token||!snapshot)return;

  const runner=()=>runBackgroundAdminAnalysis(id,token,snapshot)
    .catch(e=>console.warn("background admin analysis failed",e));

  if("requestIdleCallback" in window){
    requestIdleCallback(runner,{timeout:3500});
  }else{
    setTimeout(runner,1200);
  }
}

async function runBackgroundAdminAnalysis(id,token,snapshot){
  // Yield before doing CPU work so the employee success UI/reset finishes first.
  await yieldToBrowser();

  const analysis=await buildSnapshotAnalysis(snapshot);

  const metrics={
    ...analysis.metrics,
    userAnalysisHidden:true,
    analysisPending:false,
    vehicleType:snapshot.vehicleType,
    stickerCaptureQuality:snapshot.stickerQuality,
    plateConfirmed:true,
    plateManualMatch:true,
    enteredVehicleNoNormalized:normalizeVehicleNo($("vehicleNo").value),
    plateOcrSupported:Boolean(S.plateOcrResult?.supported),
    plateOcrText:S.plateOcrResult?.text||"",
    plateOcrMatched:S.plateOcrResult?.matched===true,
    plateVisibilityScore:Number(snapshot.plateQuality?.score||0),
    plateCaptureQuality:snapshot.plateQuality,
    plateCrop:snapshot.plateSelection,
    userStickerCrop:snapshot.selection
  };

  const r=await fetchTimeout(`/api/inspection/${id}/analysis`,{
    method:"PATCH",
    headers:{
      "content-type":"application/json",
      "x-analysis-token":token
    },
    body:JSON.stringify({
      score:analysis.score,
      status:analysis.status,
      findings:analysis.findings,
      metrics
    })
  },30000);

  if(!r.ok){
    const d=await safeJson(r);
    throw new Error(d?.error||`분석결과 저장 실패 (${r.status})`);
  }
}

async function buildSnapshotAnalysis(snapshot){
  if(snapshot.missing){
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

  const calibrated=(snapshot.sticker.examples||[]).filter(x=>
    x.calibrated && x.vehicle_type===snapshot.vehicleType
  );

  if(!calibrated.length){
    return{
      score:0,
      status:"판정불가",
      recommendation:"",
      findings:[
        "정상부착 예시사진의 스티커 영역 캘리브레이션이 없어 자동판정을 수행하지 못했습니다."
      ],
      metrics:{
        damage:0,
        shape:0,
        color:0,
        confidence:0,
        missing:false,
        analysisError:false
      }
    };
  }

  try{
    const result=await analyzeSnapshotAgainstMasterAndExamples(snapshot,calibrated);
    return result.analysis;
  }catch(e){
    console.error("snapshot analysis error",e);

    return{
      score:0,
      status:"판정불가",
      recommendation:"",
      findings:[
        "자동 분석 중 오류가 발생했습니다. 관리자가 원본 사진과 선택영역을 직접 확인해 주세요."
      ],
      metrics:{
        damage:0,
        shape:0,
        color:0,
        confidence:0,
        missing:false,
        analysisError:true
      }
    };
  }
}

async function analyzeSnapshotAgainstMasterAndExamples(snapshot,examples){
  const reference=await getVehicleReferenceBundle(snapshot,examples[0]);
  const masterDescriptor=reference.masterDescriptor;
  const normalRecords=[reference.normalRecord];
  const calibration=reference.calibration;

  const base=stabilizeSelection(
    snapshot.selection,
    snapshot.photoImage.naturalWidth,
    snapshot.photoImage.naturalHeight,
    masterDescriptor.W/masterDescriptor.H
  );

  const candidates=selectionSearchVariants(base);
  let best=null;

  for(let i=0;i<candidates.length;i++){
    const box=candidates[i];
    const canvas=cropBoxCanvas(snapshot.photoImage,box,1000);
    const cmp=await compareNormalizedStructureResponsive(masterDescriptor,canvas);
    const nearest=findNearestNormalExample(cmp,normalRecords,masterDescriptor,calibration);

    if(!best||nearest.matchScore>best.nearest.matchScore){
      best={box,cmp,nearest};
    }

    await yieldToBrowser();
  }

  if(!best||!best.nearest){
    throw new Error("스티커 비교영역을 계산하지 못했습니다.");
  }

  const nearestRecord=best.nearest.record;
  const residual=buildAngleAdjustedResidual(
    best.cmp,
    nearestRecord.cmp,
    calibration,
    masterDescriptor
  );

  const damage=angleAdjustedDamageIndex(residual);
  const preservation=nearestAdjustedPreservation(
    best.cmp,
    nearestRecord.cmp,
    calibration
  );
  const designSimilarity=designFidelityScore(
    best.cmp,
    nearestRecord.cmp,
    residual,
    calibration,
    masterDescriptor
  );

  const confidence=r1(clamp(best.nearest.matchScore*100,0,100));
  const placement=placementSimilarityScore(snapshot,normalRecords);
  const rearGeometry=snapshot.sticker.side_hint==="rear"
    ? rearGeometryComparison(snapshot,normalRecords)
    : null;

  const designCalibration=calibrateNormalDesignRange(
    normalRecords,
    calibration,
    masterDescriptor,
    snapshot.rules||defaultRules(),
    confidence
  );

  const metrics={
    damage:r1(damage),
    shape:r1(preservation),
    designSimilarity:r1(designSimilarity),
    designThreshold:r1(designCalibration.threshold),
    designNormalMedian:r1(designCalibration.median),
    designNormalQ25:r1(designCalibration.q25),
    designNormalMin:r1(designCalibration.minimum),
    designCalibrationCount:designCalibration.count,
    designCalibrationMode:designCalibration.mode,
    placementSimilarity:Number.isFinite(placement?.score)?r1(placement.score):null,
    rearGeometrySimilarity:Number.isFinite(rearGeometry?.score)?r1(rearGeometry.score):null,
    rearSizeDifference:Number.isFinite(rearGeometry?.sizeDifferencePct)?r1(rearGeometry.sizeDifferencePct):null,
    rearWidthDifference:Number.isFinite(rearGeometry?.widthDifferencePct)?r1(rearGeometry.widthDifferencePct):null,
    rearHeightDifference:Number.isFinite(rearGeometry?.heightDifferencePct)?r1(rearGeometry.heightDifferencePct):null,
    rearOffsetDifference:Number.isFinite(rearGeometry?.offsetDifference)?r1(rearGeometry.offsetDifference):null,
    rearHorizontalDifference:Number.isFinite(rearGeometry?.horizontalDifference)?r1(rearGeometry.horizontalDifference):null,
    rearVerticalDifference:Number.isFinite(rearGeometry?.verticalDifference)?r1(rearGeometry.verticalDifference):null,
    rearSideMismatch:rearGeometry?.sideMismatch===true,
    rearUserSide:rearGeometry?.userSide||null,
    rearNormalSide:rearGeometry?.normalSide||null,
    color:null,
    confidence,
    vehicleType:snapshot.vehicleType,
    sideHint:snapshot.sticker.side_hint,
    rawStructureDifference:r1((1-best.cmp.global)*100),
    nearestExampleId:Number(nearestRecord.ex.id),
    nearestExampleSimilarity:r1(best.nearest.matchScore*100),
    largestDamageCluster:r1(residual.largestClusterPct),
    distributedDifference:r1(residual.distributedPct),
    stableCells:calibration.stableIndices.length,
    normalExamples:1,
    placementExamples:nearestRecord.ex.plate_calibrated?1:0,
    missing:false
  };

  const rules=snapshot.rules||defaultRules();
  let status="정상";
  let recommendation="";
  const findings=[];

  const isRear=snapshot.sticker.side_hint==="rear";

  if(confidence<58||calibration.stableIndices.length<12){
    if(!isRear){
      status="판정불가";
      findings.push(
        "스티커 구조 검출신뢰도가 낮아 자동판정을 확정하지 않았습니다. 관리자가 원본 사진과 선택영역을 직접 확인해 주세요."
      );
    }
  }

  if(isRear){
    // 후면은 손상률/HOG 구조보존을 판정조건에서 제외한다.
    // 정상 샘플에서 야간조명·후미등 반사·촬영각도만으로 오탐이 발생했기 때문이다.
    // 후면 주판정: 존재여부(상위 단계) + 좌우 + 번호판 대비 규격 + 상대위치.
    if(!Number.isFinite(metrics.rearGeometrySimilarity)){
      status="판정불가";
      findings.push(
        "후면 정상 예시의 번호판 기준영역이 없어 크기·부착위치 판정을 수행하지 못했습니다."
      );
    }else{
      if(Number(rules.use_rear_geometry ?? 1)===1){
        if(metrics.rearSideMismatch===true){
          status="확인필요";
          findings.push(
            `후면 좌우 부착위치 불일치 → 정상 ${rearSideLabel(metrics.rearNormalSide)} / 촬영 ${rearSideLabel(metrics.rearUserSide)}`
          );
        }

        if(metrics.rearSizeDifference>Number(rules.rear_size_difference_max ?? 18)){
          status="확인필요";
          findings.push(
            `후면 스티커 규격 차이 ${metrics.rearSizeDifference}% → 정상 예시 대비 크기가 달라 임의제작·규격상이 여부 확인필요`
          );
        }

        if(Number.isFinite(metrics.rearHorizontalDifference) &&
           metrics.rearHorizontalDifference>42){
          status="확인필요";
          findings.push(
            `후면 수평 위치차이 ${metrics.rearHorizontalDifference}% → 번호판 대비 좌우 위치 확인필요`
          );
        }

        if(Number.isFinite(metrics.rearVerticalDifference) &&
           metrics.rearVerticalDifference>65){
          status="확인필요";
          findings.push(
            `후면 수직 위치차이 ${metrics.rearVerticalDifference}% → 번호판 대비 상하 위치 확인필요`
          );
        }

        if(metrics.rearGeometrySimilarity<Number(rules.rear_geometry_min ?? 62)){
          status="확인필요";
          findings.push(
            `후면 기준 유사도 ${metrics.rearGeometrySimilarity}% → 같은 차종 정상 예시 대비 크기·상대위치 확인필요`
          );
        }
      }

      // 정상 샘플은 야간/각도 차이로 디자인 점수가 60%대까지 내려갈 수 있어
      // 후면에서는 매우 큰 형상 불일치만 보조적으로 임의제작 의심 처리한다.
      const rearDesignFloor=50;
      if(Number(rules.use_design ?? 1)===1 &&
         metrics.designSimilarity<rearDesignFloor){
        status="확인필요";
        findings.push(
          `후면 디자인 동일성 ${metrics.designSimilarity}% → 정상 원본과 형상이 크게 달라 임의제작 여부 확인필요`
        );
      }
    }

    if(status==="정상"&&!findings.length){
      findings.push(
        `${vehicleLabel(snapshot.vehicleType)} 후면 정상 예시 대비 스티커 존재·좌우·규격·상대위치가 정상 범위입니다.`
      );
    }
  }else if(status!=="판정불가"){
    // 측면은 기존 판정 로직 유지
    if(Number(rules.use_damage)===1){
      if(metrics.damage>=Number(rules.damage_replace_min)){
        status="확인필요";
        recommendation="교체 권고";
        findings.push(`보정 구조손상 ${metrics.damage}% → 교체 권고`);
      }else if(metrics.damage>Number(rules.damage_normal_max)){
        status="확인필요";
        findings.push(`보정 구조손상 ${metrics.damage}% → 손상 여부 확인필요`);
      }
    }

    if(Number(rules.use_design ?? 1)===1 &&
       metrics.designSimilarity<metrics.designThreshold){
      status="확인필요";
      findings.push(
        `디자인 동일성 ${metrics.designSimilarity}% < 차종별 기준 ${metrics.designThreshold}% → 기준 스티커와 폰트·로고·자간·그래픽 형상이 다를 가능성`
      );
    }

    if(Number(rules.use_placement ?? 1)===1 &&
       Number.isFinite(metrics.placementSimilarity) &&
       metrics.placementSimilarity<Number(rules.placement_similarity_min ?? 55)){
      status="확인필요";
      findings.push(
        `부착위치 유사도 ${metrics.placementSimilarity}% → ${vehicleLabel(snapshot.vehicleType)} 정상 예시 대비 위치·방향 확인필요`
      );
    }

    if(Number(rules.use_shape)===1&&metrics.shape<Number(rules.shape_similarity_min)){
      status="확인필요";
      findings.push(`구조 보존율 ${metrics.shape}% → 로고·문구·그래픽 구조 확인필요`);
    }

    if(!findings.length){
      findings.push(
        `${vehicleLabel(snapshot.vehicleType)} 정상 예시사진과 비교한 결과 손상·디자인·부착위치에서 뚜렷한 이상징후가 없습니다.`
      );
    }
  }

  const placementForScore=isRear
    ? (Number.isFinite(metrics.rearGeometrySimilarity) ? metrics.rearGeometrySimilarity : 0)
    : (Number.isFinite(metrics.placementSimilarity) ? metrics.placementSimilarity : 100);

  const designForScore=isRear
    ? Math.max(metrics.designSimilarity,70)
    : metrics.designSimilarity;

  const rearComplianceScore=isRear
    ? clamp(
        placementForScore*.62+
        designForScore*.18+
        Math.max(confidence,65)*.20,
        0,100
      )
    : null;

  const score=status==="판정불가"
    ? r1(isRear ? rearComplianceScore*.5 : confidence*.5)
    : r1(isRear
        ? rearComplianceScore
        : clamp(
            (100-metrics.damage)*.38+
            designForScore*.30+
            metrics.shape*.18+
            placementForScore*.08+
            confidence*.06,
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

async function getVehicleReferenceBundle(snapshot,example){
  const key=`v18:${snapshot.sticker.id}:${example.id}`;

  if(S.referenceCache[key]){
    return S.referenceCache[key];
  }

  const master=await loadImage(snapshot.sticker.image_url);
  const masterDescriptor=buildMasterDescriptor(master);
  const img=await loadImage(example.image_url);

  const crop=cropImageElement(img,{
    x:Number(example.crop_x),
    y:Number(example.crop_y),
    width:Number(example.crop_width),
    height:Number(example.crop_height)
  },1000);

  const cmp=await compareNormalizedStructureResponsive(masterDescriptor,crop);
  const normalRecord={ex:example,cmp};
  const calibration=buildCalibration(masterDescriptor,[cmp]);

  const bundle={masterDescriptor,normalRecord,calibration};
  S.referenceCache[key]=bundle;
  return bundle;
}

function calibrateNormalDesignRange(normalRecords,calibration,masterDescriptor,rules,confidence=80){
  const fallback=clamp(Number(rules?.design_similarity_min ?? 82),0,100);

  if(normalRecords.length===1){
    const qualityAdaptive=clamp(confidence-7,66,74);
    return{
      mode:"vehicle-specific",
      threshold:Math.min(fallback,qualityAdaptive),
      median:100,
      q25:100,
      minimum:100,
      count:1,
      scores:[100]
    };
  }

  return{
    mode:"fallback",
    threshold:fallback,
    median:fallback,
    q25:fallback,
    minimum:fallback,
    count:normalRecords?.length||0,
    scores:[]
  };
}

function percentileValue(sorted,p){
  if(!sorted?.length)return 0;
  if(sorted.length===1)return Number(sorted[0]);

  const index=(sorted.length-1)*clamp(p,0,1);
  const lo=Math.floor(index);
  const hi=Math.ceil(index);
  const t=index-lo;

  if(lo===hi)return Number(sorted[lo]);
  return Number(sorted[lo])*(1-t)+Number(sorted[hi])*t;
}

function findNearestNormalExample(userCmp,normalRecords,masterDescriptor,calibration){
  let best=null;

  for(const record of normalRecords){
    let residual=0,total=0;

    for(const i of calibration.stableIndices){
      const w=calibration.weights[i]/Math.max(.0001,calibration.meanEnergy);
      residual+=Math.abs(Number(userCmp.sims[i]||0)-Number(record.cmp.sims[i]||0))*w;
      total+=w;
    }

    const residualSimilarity=clamp(1-residual/Math.max(.0001,total),0,1);
    const direct=directHogSimilarity(
      userCmp.hogHistograms,
      record.cmp.hogHistograms,
      calibration.stableIndices,
      calibration
    );
    const projection=vectorSimilarity(userCmp.edgeSignature,record.cmp.edgeSignature);

    const matchScore=clamp(
      residualSimilarity*.50+
      direct*.35+
      projection*.15,
      0,1
    );

    if(!best||matchScore>best.matchScore){
      best={record,matchScore,residualSimilarity,direct,projection};
    }
  }

  return best;
}

function buildAngleAdjustedResidual(userCmp,normalCmp,calibration,masterDescriptor){
  const bad=new Set();
  const severity=new Map();
  let totalWeight=0;
  let badWeight=0;

  for(const i of calibration.stableIndices){
    const normal=Number(normalCmp.sims[i]||0);
    const current=Number(userCmp.sims[i]||0);
    const variation=Number(calibration.variability[i]||0);
    const tolerance=Math.max(.08,variation*2.4);
    const deficit=Math.max(0,normal-current-tolerance);
    const w=calibration.weights[i]/Math.max(.0001,calibration.meanEnergy);

    totalWeight+=w;

    const ratio=current/Math.max(.12,normal);
    const sev=clamp(deficit/.32,0,1);

    if(deficit>.07&&ratio<.86){
      bad.add(i);
      severity.set(i,sev);
      badWeight+=w*sev;
    }
  }

  const rows=masterDescriptor.hog.rows;
  const cols=masterDescriptor.hog.cols;
  const visited=new Set();
  let largestCluster=new Set();
  let largestWeight=0;

  for(const start of bad){
    if(visited.has(start))continue;

    const queue=[start];
    const cluster=new Set();
    let weight=0;

    visited.add(start);

    while(queue.length){
      const i=queue.pop();
      cluster.add(i);

      const w=calibration.weights[i]/Math.max(.0001,calibration.meanEnergy);
      weight+=w*Number(severity.get(i)||0);

      const r=Math.floor(i/cols);
      const c=i%cols;
      const neighbours=[
        [r-1,c],[r+1,c],[r,c-1],[r,c+1],
        [r-1,c-1],[r-1,c+1],[r+1,c-1],[r+1,c+1]
      ];

      for(const [nr,nc] of neighbours){
        if(nr<0||nr>=rows||nc<0||nc>=cols)continue;
        const ni=nr*cols+nc;

        if(bad.has(ni)&&!visited.has(ni)){
          visited.add(ni);
          queue.push(ni);
        }
      }
    }

    if(weight>largestWeight){
      largestWeight=weight;
      largestCluster=cluster;
    }
  }

  const totalBadPct=badWeight/Math.max(.0001,totalWeight)*100;
  const largestClusterPct=largestWeight/Math.max(.0001,totalWeight)*100;
  const distributedPct=Math.max(0,totalBadPct-largestClusterPct);

  return{
    bad,
    severity,
    largestCluster,
    totalBadPct,
    largestClusterPct,
    distributedPct
  };
}

function angleAdjustedDamageIndex(residual){
  // True peeling/missing regions normally create one coherent cluster.
  // Scattered differences caused by perspective/font/noise receive much less damage weight.
  return clamp(
    residual.largestClusterPct*.82+
    residual.distributedPct*.18,
    0,100
  );
}

function nearestAdjustedPreservation(userCmp,normalCmp,calibration){
  let sum=0,total=0;

  for(const i of calibration.stableIndices){
    const normal=Math.max(.12,Number(normalCmp.sims[i]||0));
    const current=Number(userCmp.sims[i]||0);
    const w=calibration.weights[i]/Math.max(.0001,calibration.meanEnergy);

    sum+=clamp(current/normal,0,1)*w;
    total+=w;
  }

  return clamp(sum/Math.max(.0001,total)*100,0,100);
}

function designFidelityScore(userCmp,normalCmp,residual,calibration,masterDescriptor){
  const indices=calibration.stableIndices.filter(i=>!residual.largestCluster.has(i));
  const direct=directHogSimilarity(
    userCmp.hogHistograms,
    normalCmp.hogHistograms,
    indices.length?indices:calibration.stableIndices,
    calibration
  );

  let cellConsistency=0,total=0;

  for(const i of (indices.length?indices:calibration.stableIndices)){
    const w=calibration.weights[i]/Math.max(.0001,calibration.meanEnergy);
    const d=Math.abs(Number(userCmp.sims[i]||0)-Number(normalCmp.sims[i]||0));

    cellConsistency+=clamp(1-d/.38,0,1)*w;
    total+=w;
  }

  cellConsistency/=Math.max(.0001,total);

  const projection=vectorSimilarity(userCmp.edgeSignature,normalCmp.edgeSignature);
  const masterRatio=clamp(
    userCmp.global/Math.max(.10,normalCmp.global),
    0,1
  );

  return clamp(
    (
      direct*.46+
      projection*.24+
      cellConsistency*.22+
      masterRatio*.08
    )*100,
    0,100
  );
}

function directHogSimilarity(a,b,indices,calibration){
  if(!a||!b||!indices?.length)return 0;

  let sum=0,total=0;

  for(const i of indices){
    const av=a[i],bv=b[i];
    if(!av||!bv)continue;

    let dot=0,na=0,nb=0;

    for(let k=0;k<Math.min(av.length,bv.length);k++){
      dot+=av[k]*bv[k];
      na+=av[k]*av[k];
      nb+=bv[k]*bv[k];
    }

    const sim=(na>0&&nb>0)
      ? clamp(dot/Math.sqrt(na*nb),0,1)
      : 0;

    const w=calibration.weights[i]/Math.max(.0001,calibration.meanEnergy);
    sum+=sim*w;
    total+=w;
  }

  return sum/Math.max(.0001,total);
}

function edgeProjectionSignature(canvas){
  const W=canvas.width,H=canvas.height;
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  const rgba=ctx.getImageData(0,0,W,H).data;
  const gray=new Float32Array(W*H);

  for(let p=0,i=0;p<W*H;p++,i+=4){
    gray[p]=.299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2];
  }

  const xBins=24,yBins=12;
  const xp=new Float32Array(xBins);
  const yp=new Float32Array(yBins);

  for(let y=1;y<H-1;y++){
    for(let x=1;x<W-1;x++){
      const p=y*W+x;
      const gx=Math.abs(gray[p+1]-gray[p-1]);
      const gy=Math.abs(gray[p+W]-gray[p-W]);
      const m=Math.min(255,gx+gy);

      xp[Math.min(xBins-1,Math.floor(x/W*xBins))]+=m;
      yp[Math.min(yBins-1,Math.floor(y/H*yBins))]+=m;
    }
  }

  const normalize=v=>{
    let n=0;
    for(const x of v)n+=x*x;
    n=Math.sqrt(n)||1;
    return Array.from(v,x=>x/n);
  };

  return[
    ...normalize(xp),
    ...normalize(yp)
  ];
}

function vectorSimilarity(a,b){
  if(!a||!b||!a.length||!b.length)return 0;

  let dot=0,na=0,nb=0;
  const n=Math.min(a.length,b.length);

  for(let i=0;i<n;i++){
    dot+=Number(a[i]||0)*Number(b[i]||0);
    na+=Number(a[i]||0)**2;
    nb+=Number(b[i]||0)**2;
  }

  if(na<=0||nb<=0)return 0;
  return clamp(dot/Math.sqrt(na*nb),0,1);
}

function rearGeometryComparison(snapshot,normalRecords){
  if(!snapshot.plateSelection||!snapshot.selection)return null;

  const user=rearGeometrySignature(snapshot.selection,snapshot.plateSelection);
  if(!user)return null;

  let best=null;

  for(const record of normalRecords){
    const ex=record.ex;
    if(!ex.plate_calibrated)continue;

    const normal=rearGeometrySignature(
      {
        x:Number(ex.crop_x),
        y:Number(ex.crop_y),
        width:Number(ex.crop_width),
        height:Number(ex.crop_height)
      },
      {
        x:Number(ex.plate_x),
        y:Number(ex.plate_y),
        width:Number(ex.plate_width),
        height:Number(ex.plate_height)
      }
    );

    if(!normal)continue;

    const widthDifferencePct=symmetricScaleDifferencePct(
      user.widthRatio/Math.max(.0001,normal.widthRatio)
    );
    const heightDifferencePct=symmetricScaleDifferencePct(
      user.heightRatio/Math.max(.0001,normal.heightRatio)
    );

    // 비스듬한 후면사진에서는 높이보다 번호판 대비 폭 비율이 더 안정적이다.
    const sizeDifferencePct=
      widthDifferencePct*.85+
      heightDifferencePct*.15;

    const dxDiff=Math.abs(user.offsetX-normal.offsetX);
    const dyDiff=Math.abs(user.offsetY-normal.offsetY);
    const horizontalDifference=dxDiff*100;
    const verticalDifference=dyDiff*100;

    const offsetDifference=Math.sqrt(
      (dxDiff/.34)**2*.62+
      (dyDiff/.52)**2*.38
    );

    const sideMismatch=rearSideMismatch(user,normal);

    const sizePenalty=
      (Math.min(100,sizeDifferencePct)/24)**2;

    const positionPenalty=
      offsetDifference**2;

    let score=clamp(
      Math.exp(-(sizePenalty*.58 + positionPenalty*.42))*100,
      0,100
    );

    // A rear sticker on the opposite side of the number plate is never
    // considered the same placement, even if size/height are otherwise similar.
    if(sideMismatch){
      score=Math.min(score,12);
    }

    const result={
      score,
      sizeDifferencePct,
      widthDifferencePct,
      heightDifferencePct,
      offsetDifference,
      horizontalDifference,
      verticalDifference,
      sideMismatch,
      userSide:user.side,
      normalSide:normal.side,
      userOffsetX:user.offsetX,
      normalOffsetX:normal.offsetX,
      exampleId:Number(ex.id)
    };

    if(!best||score>best.score)best=result;
  }

  return best;
}

function rearGeometrySignature(sticker,plate){
  if(!sticker||!plate||
     plate.width<=.005||plate.height<=.005||
     sticker.width<=.005||sticker.height<=.005){
    return null;
  }

  const pcx=plate.x+plate.width/2;
  const pcy=plate.y+plate.height/2;
  const scx=sticker.x+sticker.width/2;
  const scy=sticker.y+sticker.height/2;

  const offsetX=(scx-pcx)/plate.width;
  const offsetY=(scy-pcy)/plate.height;

  return{
    widthRatio:sticker.width/plate.width,
    heightRatio:sticker.height/plate.height,
    offsetX,
    offsetY,
    side:rearSideFromOffset(offsetX)
  };
}

function rearSideFromOffset(offsetX){
  // Dead zone protects near-centred stickers from tiny ROI drawing errors.
  if(offsetX<=-.12)return "left";
  if(offsetX>=.12)return "right";
  return "center";
}

function rearSideMismatch(user,normal){
  if(!user||!normal)return false;

  if(user.side===normal.side)return false;

  // Clear left ↔ right reversal: always mismatch.
  if(
    (user.side==="left"&&normal.side==="right")||
    (user.side==="right"&&normal.side==="left")
  ){
    return true;
  }

  // Centre ↔ side is also treated as a mismatch when the actual horizontal
  // displacement differs enough to be meaningful (28% of plate width).
  return Math.abs(user.offsetX-normal.offsetX)>=.28;
}

function rearSideLabel(side){
  return({
    left:"왼쪽",
    right:"오른쪽",
    center:"중앙"
  })[side]||"미확인";
}

function symmetricScaleDifferencePct(ratio){
  if(!Number.isFinite(ratio)||ratio<=0)return 100;
  return clamp(
    (Math.exp(Math.abs(Math.log(ratio)))-1)*100,
    0,100
  );
}

function placementSimilarityScore(snapshot,normalRecords){
  if(!snapshot.plateSelection||!snapshot.selection)return null;

  const user=geometrySignature(snapshot.selection,snapshot.plateSelection);
  if(!user)return null;

  let best=null;

  for(const record of normalRecords){
    const ex=record.ex;
    if(!ex.plate_calibrated)continue;

    const normal=geometrySignature(
      {
        x:Number(ex.crop_x),
        y:Number(ex.crop_y),
        width:Number(ex.crop_width),
        height:Number(ex.crop_height)
      },
      {
        x:Number(ex.plate_x),
        y:Number(ex.plate_y),
        width:Number(ex.plate_width),
        height:Number(ex.plate_height)
      }
    );

    if(!normal)continue;

    const angleDiff=circularAngleDifference(user.angle,normal.angle);
    const distDiff=Math.abs(Math.log((user.distance+.15)/(normal.distance+.15)));
    const sizeDiff=Math.abs(Math.log((user.sizeRatio+.08)/(normal.sizeRatio+.08)));

    const penalty=
      (angleDiff/(Math.PI/3.2))**2*.45+
      (distDiff/.72)**2*.35+
      (sizeDiff/.72)**2*.20;

    const score=clamp(Math.exp(-penalty)*100,0,100);

    if(!best||score>best.score){
      best={score,exampleId:Number(ex.id)};
    }
  }

  return best;
}

function geometrySignature(sticker,plate){
  if(!sticker||!plate)return null;

  const pcx=plate.x+plate.width/2;
  const pcy=plate.y+plate.height/2;
  const scx=sticker.x+sticker.width/2;
  const scy=sticker.y+sticker.height/2;

  const plateScale=Math.sqrt(Math.max(.000001,plate.width*plate.height));
  const stickerScale=Math.sqrt(Math.max(.000001,sticker.width*sticker.height));

  const dx=(scx-pcx)/plateScale;
  const dy=(scy-pcy)/plateScale;

  return{
    angle:Math.atan2(dy,dx),
    distance:Math.hypot(dx,dy),
    sizeRatio:stickerScale/plateScale
  };
}

function circularAngleDifference(a,b){
  let d=Math.abs(a-b)%(Math.PI*2);
  if(d>Math.PI)d=Math.PI*2-d;
  return d;
}

async function compareNormalizedStructureResponsive(masterDescriptor,imageOrCanvas){
  const canvas=imageOrCanvas instanceof HTMLCanvasElement
    ? fitCanvasToSize(imageOrCanvas,masterDescriptor.W,masterDescriptor.H)
    : fitImageCanvas(imageOrCanvas,masterDescriptor.W,masterDescriptor.H);

  let best=null;
  let iteration=0;

  const scales=[.94,1,1.06];
  const xShifts=[-6,0,6];
  const yShifts=[-4,0,4];

  for(const scale of scales){
    for(const tx of xShifts){
      for(const ty of yShifts){
        const transformed=transformCanvas(
          canvas,
          masterDescriptor.W,
          masterDescriptor.H,
          scale,scale,tx,ty
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
            hogHistograms:hog.histograms.map(h=>Array.from(h)),
            edgeSignature:edgeProjectionSignature(transformed)
          };
        }

        iteration++;
        if(iteration%9===0){
          await yieldToBrowser();
        }
      }
    }
  }

  return best;
}

function yieldToBrowser(){
  return new Promise(resolve=>setTimeout(resolve,0));
}

async function safeJson(response){
  try{
    return await response.json();
  }catch{
    return null;
  }
}

function resetAllAfterPhoto(){
  $("selectionSection").classList.add("hidden");
  $("analysisSection").classList.add("hidden");
  if($("submissionSection"))$("submissionSection").classList.add("hidden");
  S.photoBlob=null;
  S.photoImage=null;
  S.selection=null;
  S.analysis=null;
  S.photoHash=null;
  S.analyzedSelection=null;
  S.plateSelection=null;
  S.plateVisibility=null;
  S.draftSelection=null;
  S.selectionMode="sticker";
  if($("submissionSection"))$("submissionSection").classList.add("hidden");
}

function defaultRules(){
  return{
    damage_normal_max:10,
    damage_replace_min:30,
    shape_similarity_min:72,
    design_similarity_min:82,
    placement_similarity_min:55,
    rear_geometry_min:62,
    rear_size_difference_max:18,
    color_difference_max:35,
    use_damage:1,
    use_shape:1,
    use_design:1,
    use_placement:1,
    use_rear_geometry:1,
    use_color:0
  };
}

function vehicleLabel(v){
  return({
    k3:"K3",
    avante:"아반떼",
    ev3:"EV3"
  })[v]||v||"";
}

function sideLabel(v){
  return({
    both:"좌·우 측면 공통",
    driver:"운전석",
    passenger:"조수석",
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
