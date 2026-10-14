(() => {
  "use strict";

  const SIDES=[
    {key:"driver",label:"운전석"},
    {key:"passenger",label:"조수석"},
    {key:"rear",label:"후면"}
  ];

  const G={
    config:null,
    vehicleType:"",
    activeIndex:0,
    submitting:false,
    analysisRunning:false,
    sides:{
      driver:{file:null,image:null,url:null,plate:null},
      passenger:{file:null,image:null,url:null,plate:null},
      rear:{file:null,image:null,url:null,plate:null}
    }
  };

  const $=id=>document.getElementById(id);

  document.addEventListener("DOMContentLoaded",init);

  async function init(){
    document.body.classList.add("group-v42-active");

    document.querySelectorAll(".legacy-single-inspection").forEach(el=>{
      el.classList.add("hidden");
    });

    const stickerSelect=document.querySelector(".sticker-select-block");
    const reference=document.querySelector(".reference-layout");
    if(stickerSelect)stickerSelect.classList.add("hidden");
    if(reference)reference.classList.add("hidden");

    renderSteps();
    bindVehicleTabs();

    try{
      const r=await fetch("/api/config",{cache:"no-store"});
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||"점검 기준정보를 불러오지 못했습니다.");
      G.config=d;
      refreshGuideCards();
      updateSubmitState();
    }catch(e){
      setMessage(e.message,"error");
    }
  }

  function bindVehicleTabs(){
    document.querySelectorAll("#vehicleTabs .vehicle-tab").forEach(btn=>{
      btn.addEventListener("click",event=>{
        if(window.__vehicleRegistryVerified!==true){
          event.preventDefault();
          event.stopImmediatePropagation();
          alert("먼저 성명·사번·부서·차량번호 확인을 완료해 주세요.");
          window.scrollTo({top:0,behavior:"smooth"});
          return;
        }

        const next=String(btn.dataset.vehicle||"");
        if(!next)return;

        if(G.vehicleType && G.vehicleType!==next && hasAnyPhoto()){
          if(!confirm("차종을 변경하면 현재 촬영한 3면 사진이 초기화됩니다. 변경하시겠습니까?")){
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
          }
          resetAllSides();
        }

        G.vehicleType=next;
        G.activeIndex=0;
        refreshGuideCards();
        syncRegistryGate();
        updateSubmitState();
      },true);
    });

    ["employeeName","employeeId","department","vehicleNo"].forEach(id=>{
      const el=$(id);
      if(!el)return;
      el.addEventListener(el.tagName==="SELECT"?"change":"input",()=>{
        setTimeout(syncRegistryGate,50);
        setTimeout(syncRegistryGate,750);
      });
    });

    syncRegistryGate();
    setInterval(syncRegistryGate,500);
  }

  function syncRegistryGate(){
    const verified=window.__vehicleRegistryVerified===true;

    document.querySelectorAll("#vehicleTabs .vehicle-tab").forEach(btn=>{
      btn.disabled=!verified;
    });

    SIDES.forEach((s,i)=>{
      const input=$(`groupFile-${s.key}`);
      if(!input)return;

      input.disabled=
        !verified ||
        !G.vehicleType ||
        i>G.activeIndex;
    });

    if($("groupFlowStatus")){
      $("groupFlowStatus").textContent=!verified
        ?"기본정보 확인 필요"
        :(G.vehicleType?"3면 촬영":"차종 선택");
    }
  }

  function renderSteps(){
    const host=$("groupSideSteps");
    host.innerHTML=SIDES.map((s,i)=>`
      <section class="group-side-card ${i===0?"active":"locked"}" id="groupCard-${s.key}">
        <div class="group-side-head">
          <div>
            <span class="step">${i+1} STEP</span>
            <h3>${s.label} 촬영</h3>
          </div>
          <span id="groupState-${s.key}" class="pill review">대기</span>
        </div>

        <div class="message info">
          ${s.label}의 차량번호판과 홍보스티커가 한 장에 함께 보이도록 촬영해 주세요.
        </div>

        <div id="groupGuide-${s.key}" class="group-guide-card">
          <div class="group-guide-head">
            <div>
              <span class="step">NORMAL PHOTO GUIDE</span>
              <strong>${s.label} 정상 촬영 예시</strong>
            </div>
            <span id="groupGuideVehicle-${s.key}" class="pill pending">차종 선택 전</span>
          </div>
          <div id="groupGuideBody-${s.key}" class="group-guide-body">
            <div class="group-guide-placeholder">
              차종을 선택하면 해당 차종의 ${s.label} 정상 예시사진이 표시됩니다.
            </div>
          </div>
          <div id="groupGuideText-${s.key}" class="message info group-guide-text">
            예시사진과 비슷하게 차량번호판과 홍보스티커가 함께 보이도록 촬영해 주세요.
          </div>
        </div>

        <label class="btn primary full group-photo-button">
          ${s.label} 사진 촬영 / 선택
          <input id="groupFile-${s.key}" type="file" accept="image/*" hidden disabled>
        </label>

        <div id="groupSelection-${s.key}" class="group-selection hidden">
          <div class="message info">
            사진에서 <b>번호판만 드래그</b>하여 지정해 주세요.
          </div>
          <div class="group-selection-stage" id="groupStage-${s.key}">
            <img id="groupImage-${s.key}" alt="${s.label} 점검사진">
            <div id="groupPlate-${s.key}" class="selection-box plate-selection-box hidden"></div>
            <div id="groupDraft-${s.key}" class="selection-box draft-selection-box hidden"></div>
          </div>
          <div class="selection-actions">
            <button id="groupReset-${s.key}" class="btn" type="button">번호판 다시 지정</button>
            <button id="groupNext-${s.key}" class="btn primary" type="button" disabled>
              ${i===SIDES.length-1?"3면 촬영 완료":"다음 단계"}
            </button>
          </div>
        </div>
      </section>
    `).join("");

    SIDES.forEach((s,i)=>{
      $(`groupFile-${s.key}`).addEventListener("change",e=>onFile(s.key,e.target.files?.[0]));
      $(`groupReset-${s.key}`).addEventListener("click",()=>resetPlate(s.key));
      $(`groupNext-${s.key}`).addEventListener("click",()=>completeStep(i));
      bindPlateDrawing(s.key);
    });

    $("groupSubmitBtn").addEventListener("click",submitGroup);
  }

  async function onFile(side,file){
    if(!file)return;
    if(!String(file.type||"").startsWith("image/")){
      setMessage("이미지 파일만 선택해 주세요.","error");
      return;
    }

    const state=G.sides[side];

    if(state.url)URL.revokeObjectURL(state.url);
    state.file=file;
    state.url=URL.createObjectURL(file);
    state.plate=null;

    const img=$(`groupImage-${side}`);
    img.src=state.url;
    await img.decode().catch(()=>{});
    state.image=img;

    $(`groupSelection-${side}`).classList.remove("hidden");
    $(`groupPlate-${side}`).classList.add("hidden");
    $(`groupNext-${side}`).disabled=true;
    setSideState(side,"번호판 지정","review");
    updateSubmitState();
  }

  function bindPlateDrawing(side){
    const stage=$(`groupStage-${side}`);
    const draft=$(`groupDraft-${side}`);
    let start=null;

    stage.addEventListener("pointerdown",e=>{
      const state=G.sides[side];
      if(!state.file)return;

      const rect=stage.getBoundingClientRect();
      start={
        x:clamp((e.clientX-rect.left)/rect.width,0,1),
        y:clamp((e.clientY-rect.top)/rect.height,0,1)
      };

      draft.classList.remove("hidden");
      stage.setPointerCapture?.(e.pointerId);
      drawBox(draft,{x:start.x,y:start.y,width:.001,height:.001});
    });

    stage.addEventListener("pointermove",e=>{
      if(!start)return;
      const rect=stage.getBoundingClientRect();
      const x=clamp((e.clientX-rect.left)/rect.width,0,1);
      const y=clamp((e.clientY-rect.top)/rect.height,0,1);
      drawBox(draft,normalizeBox(start.x,start.y,x,y));
    });

    const finish=e=>{
      if(!start)return;
      const rect=stage.getBoundingClientRect();
      const x=clamp((e.clientX-rect.left)/rect.width,0,1);
      const y=clamp((e.clientY-rect.top)/rect.height,0,1);
      const box=normalizeBox(start.x,start.y,x,y);
      start=null;
      draft.classList.add("hidden");

      if(box.width<.05||box.height<.025){
        setMessage("번호판 영역을 조금 더 크게 지정해 주세요.","error");
        return;
      }

      G.sides[side].plate=box;
      drawBox($(`groupPlate-${side}`),box);
      $(`groupPlate-${side}`).classList.remove("hidden");
      $(`groupNext-${side}`).disabled=false;
      setSideState(side,"촬영완료","normal");
      updateSubmitState();
    };

    stage.addEventListener("pointerup",finish);
    stage.addEventListener("pointercancel",()=>{start=null;draft.classList.add("hidden")});
  }

  function completeStep(index){
    const side=SIDES[index].key;
    if(!G.sides[side].file||!G.sides[side].plate)return;

    if(index<SIDES.length-1){
      const next=SIDES[index+1].key;
      G.activeIndex=index+1;
      $(`groupCard-${next}`).classList.remove("locked");
      $(`groupCard-${next}`).classList.add("active");
      syncRegistryGate();
      $(`groupCard-${next}`).scrollIntoView({behavior:"smooth",block:"start"});
    }else{
      $("groupSubmitBtn").scrollIntoView({behavior:"smooth",block:"center"});
    }

    updateSubmitState();
  }

  function resetPlate(side){
    G.sides[side].plate=null;
    $(`groupPlate-${side}`).classList.add("hidden");
    $(`groupNext-${side}`).disabled=true;
    setSideState(side,"번호판 지정","review");
    updateSubmitState();
  }

  function resetAllSides(){
    SIDES.forEach((s,i)=>{
      const st=G.sides[s.key];
      if(st.url)URL.revokeObjectURL(st.url);
      G.sides[s.key]={file:null,image:null,url:null,plate:null};
      const input=$(`groupFile-${s.key}`);
      if(input){
        input.value="";
        input.disabled=true;
      }
      $(`groupSelection-${s.key}`)?.classList.add("hidden");
      $(`groupPlate-${s.key}`)?.classList.add("hidden");
      $(`groupCard-${s.key}`)?.classList.toggle("locked",i!==0);
      setSideState(s.key,"대기","review");
    });
    G.activeIndex=0;
    syncRegistryGate();
    updateSubmitState();
  }

  async function submitGroup(){
    if(G.submitting||G.analysisRunning)return;

    let uploadSession=null;

    try{
      G.submitting=true;
      $("groupSubmitBtn").disabled=true;
      $("groupSubmitBtn").textContent="제출 준비 중...";

      const profile=getProfile();
      await verifyProfile(profile);

      if(!G.vehicleType)throw new Error("차종을 선택해 주세요.");

      for(const s of SIDES){
        const st=G.sides[s.key];
        if(!st.file||!st.plate){
          throw new Error(`${s.label} 사진과 번호판 영역을 완료해 주세요.`);
        }
      }

      const sideStickers={};

      for(const s of SIDES){
        sideStickers[s.key]=findStickerForSide(s.key,G.vehicleType);

        if(!sideStickers[s.key]){
          throw new Error(`${s.label} 기준 스티커/정상예시가 설정되어 있지 않습니다.`);
        }
      }

      // 분석은 제출 시점 사진을 별도 캔버스로 고정해 둡니다.
      const frozenPhotos={};

      for(const s of SIDES){
        frozenPhotos[s.key]=freezePhotoForAnalysis(
          G.sides[s.key].image,
          2200
        );
      }

      const compressed={};

      for(const s of SIDES){
        $("groupSubmitBtn").textContent=`${s.label} 사진 준비 중...`;
        compressed[s.key]=await compressFile(
          G.sides[s.key].file,
          1800,
          .84
        );
      }

      // ① 작은 JSON 요청으로 차량 접수 1건을 먼저 만듭니다.
      $("groupSubmitBtn").textContent="접수번호 생성 중...";

      const startData=await fetchJsonWithTimeout(
        "/api/vehicle-inspection/start",
        {
          method:"POST",
          headers:{"content-type":"application/json"},
          body:JSON.stringify({
            ...profile,
            vehicle_type:G.vehicleType
          })
        },
        30000
      );

      uploadSession={
        id:Number(startData.id),
        receipt_no:String(startData.receipt_no||""),
        token:String(startData.upload_token||"")
      };

      if(!uploadSession.id||!uploadSession.token){
        throw new Error("통합 점검 접수정보를 받지 못했습니다.");
      }

      // ② 사진은 1장씩 독립 요청으로 순차 저장합니다.
      for(let i=0;i<SIDES.length;i++){
        const s=SIDES[i];

        $("groupSubmitBtn").textContent=
          `${i+1}/3 ${s.label} 사진 저장 중...`;

        await uploadSideWithRetry(
          uploadSession,
          s,
          compressed[s.key],
          sideStickers[s.key],
          G.sides[s.key].plate
        );
      }

      // ③ 서버에서 R2 3개 파일 + D1 3면 레코드를 재확인합니다.
      $("groupSubmitBtn").textContent="3개 사진 저장 확인 중...";

      const finalized=await fetchJsonWithTimeout(
        `/api/vehicle-inspection/${uploadSession.id}/finalize`,
        {
          method:"POST",
          headers:{
            "x-upload-token":uploadSession.token
          }
        },
        30000
      );

      const snapshots=SIDES.map(s=>({
        side:s.key,
        sticker:sideStickers[s.key],
        examples:sideStickers[s.key].examples||[],
        token:String(finalized.sides?.[s.key]?.analysis_token||""),
        snapshot:{
          sticker:sideStickers[s.key],
          vehicleType:G.vehicleType,
          rules:G.config?.rules||{},
          photoImage:frozenPhotos[s.key],
          selection:null,
          plateSelection:{...G.sides[s.key].plate},
          missing:false
        }
      }));

      setMessage(
        `제출 완료 · 접수번호 ${finalized.receipt_no||uploadSession.receipt_no}. 운전석·조수석·후면 사진 3장이 모두 저장되었습니다.`,
        "success"
      );

      $("groupSubmitBtn").textContent="제출 완료";

      G.analysisRunning=true;
      updateSubmitState();

      setTimeout(
        ()=>runBackgroundAnalysis(uploadSession.id,snapshots),
        50
      );

      setTimeout(()=>{
        resetAllSides();
        $("groupSubmitBtn").textContent="차량 점검 1건으로 제출";
      },1200);

      // finalize 이후에는 abort하면 안 됩니다.
      uploadSession=null;

    }catch(e){
      // finalize 전 실패한 접수는 가능한 범위에서 즉시 정리합니다.
      if(uploadSession?.id&&uploadSession?.token){
        try{
          await fetchJsonWithTimeout(
            `/api/vehicle-inspection/${uploadSession.id}/abort`,
            {
              method:"POST",
              headers:{
                "x-upload-token":uploadSession.token
              }
            },
            15000
          );
        }catch(abortError){
          console.error("partial vehicle inspection cleanup failed",abortError);
        }
      }

      setMessage(
        humanizeSubmitError(e),
        "error"
      );
      $("groupSubmitBtn").textContent="차량 점검 1건으로 제출";

    }finally{
      G.submitting=false;
      updateSubmitState();
    }
  }

  async function uploadSideWithRetry(session,side,file,sticker,plate){
    let lastError=null;

    for(let attempt=1;attempt<=2;attempt++){
      try{
        const fd=new FormData();
        fd.append("file",file,`${side.key}.jpg`);
        fd.append("sticker_id",String(Number(sticker.id)));
        fd.append("plate",JSON.stringify(plate));

        return await fetchJsonWithTimeout(
          `/api/vehicle-inspection/${session.id}/upload/${side.key}`,
          {
            method:"POST",
            headers:{
              "x-upload-token":session.token
            },
            body:fd
          },
          60000
        );
      }catch(error){
        lastError=error;

        if(attempt<2){
          $("groupSubmitBtn").textContent=
            `${side.label} 저장 재시도 중...`;
          await new Promise(resolve=>setTimeout(resolve,700));
        }
      }
    }

    throw new Error(
      `${side.label} 사진 저장에 실패했습니다. ${lastError?.message||""}`.trim()
    );
  }

  async function fetchJsonWithTimeout(url,options={},timeoutMs=30000){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);

    try{
      const response=await fetch(url,{
        ...options,
        signal:controller.signal
      });

      const text=await response.text();
      let data={};

      try{
        data=text?JSON.parse(text):{};
      }catch{
        data={};
      }

      if(!response.ok){
        throw new Error(
          data.error ||
          `서버 오류 (${response.status})`
        );
      }

      return data;
    }catch(error){
      if(error?.name==="AbortError"){
        throw new Error("서버 응답시간이 초과되었습니다.");
      }

      if(String(error?.message||"")==="Failed to fetch"){
        throw new Error("서버와 통신이 끊겼습니다.");
      }

      throw error;
    }finally{
      clearTimeout(timer);
    }
  }

  function humanizeSubmitError(error){
    const message=String(error?.message||"").trim();

    if(!message){
      return "통합 점검 제출에 실패했습니다. 잠시 후 다시 시도해 주세요.";
    }

    return message;
  }


  async function runBackgroundAnalysis(id,snapshots){
    try{
      for(const item of snapshots){
        try{
        let result;

        if(typeof window.analyzeSnapshotAgainstMasterAndExamples==="function"){
          result=await window.analyzeSnapshotAgainstMasterAndExamples(
            item.snapshot,
            item.examples
          );
        }

        const analysis=result?.analysis||{
          score:0,
          status:"판정불가",
          findings:["자동분석을 수행하지 못했습니다."],
          metrics:{analysisError:true}
        };

        await fetch(
          `/api/vehicle-inspection/${id}/side/${item.side}/analysis`,
          {
            method:"PATCH",
            headers:{
              "content-type":"application/json",
              "x-analysis-token":item.token
            },
            body:JSON.stringify(analysis)
          }
        );
      }catch(error){
        console.error("group side analysis failed",item.side,error);

        try{
          await fetch(
            `/api/vehicle-inspection/${id}/side/${item.side}/analysis`,
            {
              method:"PATCH",
              headers:{
                "content-type":"application/json",
                "x-analysis-token":item.token
              },
              body:JSON.stringify({
                score:0,
                status:"판정불가",
                findings:["자동분석 중 오류가 발생했습니다."],
                metrics:{analysisError:true}
              })
            }
          );
        }catch{}
      }

        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }finally{
      for(const item of snapshots){
        const photo=item?.snapshot?.photoImage;
        if(photo && String(photo.tagName||"").toUpperCase()==="CANVAS"){
          photo.width=1;
          photo.height=1;
        }
      }

      G.analysisRunning=false;
      updateSubmitState();
    }
  }

  function freezePhotoForAnalysis(image,maxSide=2200){
    const iw=Number(image?.naturalWidth||image?.width||0);
    const ih=Number(image?.naturalHeight||image?.height||0);

    if(!iw||!ih){
      throw new Error("분석용 사진을 준비하지 못했습니다.");
    }

    const scale=Math.min(1,maxSide/Math.max(iw,ih));
    const canvas=document.createElement("canvas");
    canvas.width=Math.max(1,Math.round(iw*scale));
    canvas.height=Math.max(1,Math.round(ih*scale));
    canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);
    return canvas;
  }

  function refreshGuideCards(){
    for(const s of SIDES){
      renderGuideCard(s.key,s.label);
    }
  }

  function renderGuideCard(side,label){
    const body=$(`groupGuideBody-${side}`);
    const pill=$(`groupGuideVehicle-${side}`);
    const text=$(`groupGuideText-${side}`);

    if(!body||!pill||!text)return;

    if(!G.vehicleType){
      pill.textContent="차종 선택 전";
      pill.className="pill pending";
      body.innerHTML=`
        <div class="group-guide-placeholder">
          차종을 선택하면 해당 차종의 ${label} 정상 예시사진이 표시됩니다.
        </div>
      `;
      text.textContent=
        "예시사진과 비슷하게 차량번호판과 홍보스티커가 함께 보이도록 촬영해 주세요.";
      return;
    }

    const guide=findGuideForSide(side,G.vehicleType);

    pill.textContent=vehicleLabel(G.vehicleType);
    pill.className="pill normal";

    if(!guide?.example?.image_url){
      body.innerHTML=`
        <div class="group-guide-placeholder warn">
          ${vehicleLabel(G.vehicleType)} ${label} 정상 예시사진이 등록되어 있지 않습니다.
        </div>
      `;
      text.textContent=
        `${vehicleLabel(G.vehicleType)} ${label} 가이드가 없어 촬영은 가능하지만, 관리자에게 정상 예시 등록을 요청해 주세요.`;
      return;
    }

    body.innerHTML=`
      <img
        src="${escapeAttr(guide.example.image_url)}"
        alt="${vehicleLabel(G.vehicleType)} ${label} 정상 촬영 예시"
        loading="lazy"
      >
    `;

    const guideText=String(guide.sticker?.guide_text||"").trim();

    text.innerHTML=guideText
      ? `<b>촬영 기준:</b> ${escapeHtml(guideText)}`
      : `<b>촬영 기준:</b> 위 예시처럼 번호판과 홍보스티커가 한 장에 충분히 크게 보이도록 촬영해 주세요.`;
  }

  function findGuideForSide(side,vehicleType){
    const sticker=findStickerForSide(side,vehicleType);
    if(!sticker)return null;

    const exact=(Array.isArray(sticker.examples)?sticker.examples:[])
      .filter(e=>String(e.vehicle_type||"")===vehicleType);

    if(!exact.length)return{sticker,example:null};

    const example=
      exact.find(e=>Number(e.is_guide)===1 && e.calibrated) ||
      exact.find(e=>e.calibrated) ||
      exact.find(e=>Number(e.is_guide)===1) ||
      exact[0];

    return{sticker,example};
  }

  function vehicleLabel(value){
    return value==="k3"
      ?"K3"
      :(value==="avante"
        ?"아반떼"
        :(value==="ev3"?"EV3":String(value||"")));
  }

  function escapeHtml(value){
    return String(value??"").replace(/[&<>"']/g,c=>({
      "&":"&amp;",
      "<":"&lt;",
      ">":"&gt;",
      '"':"&quot;",
      "'":"&#039;"
    }[c]));
  }

  function escapeAttr(value){
    return escapeHtml(value);
  }


  function findStickerForSide(side,vehicleType){
    const stickers=Array.isArray(G.config?.stickers)?G.config.stickers:[];
    const exact=stickers.filter(s=>String(s.side_hint||"")===side);

    return exact.find(s=>
      (s.examples||[]).some(e=>
        e.calibrated && String(e.vehicle_type||"")===vehicleType
      )
    )||exact[0]||null;
  }

  async function verifyProfile(profile){
    if(!profile.employee_name||!profile.employee_id||!profile.department||!profile.vehicle_no){
      throw new Error("성명·사번·부서·차량번호를 모두 입력해 주세요.");
    }

    const r=await fetch("/api/vehicle-registry/verify",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify(profile)
    });
    const d=await r.json();

    if(!r.ok||!d.matched){
      throw new Error(d.error||"입력한 차량정보가 관리자 등록데이터와 일치하지 않습니다.");
    }
  }

  function getProfile(){
    return{
      employee_name:String($("employeeName")?.value||"").trim(),
      employee_id:String($("employeeId")?.value||"").trim(),
      department:String($("department")?.value||"").trim(),
      vehicle_no:String($("vehicleNo")?.value||"").trim()
    };
  }

  function updateSubmitState(){
    const done=SIDES.every(s=>G.sides[s.key].file&&G.sides[s.key].plate);
    const ready=Boolean(
      window.__vehicleRegistryVerified===true &&
      G.vehicleType &&
      done &&
      !G.submitting &&
      !G.analysisRunning
    );

    if($("groupSubmitBtn"))$("groupSubmitBtn").disabled=!ready;

    SIDES.forEach(s=>{
      const st=G.sides[s.key];
      const pill=$(`groupProgress-${capitalize(s.key)}`);
      if(!pill)return;
      pill.className=`pill ${st.file&&st.plate?"normal":"review"}`;
    });
  }

  function setSideState(side,text,kind){
    const el=$(`groupState-${side}`);
    if(!el)return;
    el.textContent=text;
    el.className=`pill ${kind}`;
  }

  function setMessage(text,type="info"){
    const el=$("groupSubmitMessage");
    if(!el)return;
    el.textContent=text;
    el.className=`message ${type}`;
  }

  function hasAnyPhoto(){
    return SIDES.some(s=>Boolean(G.sides[s.key].file));
  }

  function drawBox(el,b){
    el.style.left=`${b.x*100}%`;
    el.style.top=`${b.y*100}%`;
    el.style.width=`${b.width*100}%`;
    el.style.height=`${b.height*100}%`;
  }

  function normalizeBox(x1,y1,x2,y2){
    return{
      x:Math.min(x1,x2),
      y:Math.min(y1,y2),
      width:Math.abs(x2-x1),
      height:Math.abs(y2-y1)
    };
  }

  async function compressFile(file,maxSide,quality){
    const url=URL.createObjectURL(file);
    try{
      const img=new Image();
      img.src=url;
      await img.decode();

      const scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));
      const c=document.createElement("canvas");
      c.width=Math.max(1,Math.round(img.naturalWidth*scale));
      c.height=Math.max(1,Math.round(img.naturalHeight*scale));
      c.getContext("2d").drawImage(img,0,0,c.width,c.height);

      return await new Promise((resolve,reject)=>{
        c.toBlob(
          blob=>blob?resolve(blob):reject(new Error("사진 압축에 실패했습니다.")),
          "image/jpeg",
          quality
        );
      });
    }finally{
      URL.revokeObjectURL(url);
    }
  }

  function capitalize(s){
    return s.charAt(0).toUpperCase()+s.slice(1);
  }

  function clamp(v,a,b){
    return Math.max(a,Math.min(b,v));
  }
})();
