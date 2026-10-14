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
      updateSubmitState();
    }catch(e){
      setMessage(e.message,"error");
    }
  }

  function bindVehicleTabs(){
    document.querySelectorAll("#vehicleTabs .vehicle-tab").forEach(btn=>{
      btn.addEventListener("click",()=>{
        const next=String(btn.dataset.vehicle||"");
        if(!next)return;

        if(G.vehicleType && G.vehicleType!==next && hasAnyPhoto()){
          if(!confirm("차종을 변경하면 현재 촬영한 3면 사진이 초기화됩니다. 변경하시겠습니까?")){
            return;
          }
          resetAllSides();
        }

        G.vehicleType=next;
        updateSubmitState();
      });
    });
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

        <label class="btn primary full group-photo-button">
          ${s.label} 사진 촬영 / 선택
          <input id="groupFile-${s.key}" type="file" accept="image/*" hidden ${i===0?"":"disabled"}>
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
      $(`groupFile-${next}`).disabled=false;
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
        input.disabled=i!==0;
      }
      $(`groupSelection-${s.key}`)?.classList.add("hidden");
      $(`groupPlate-${s.key}`)?.classList.add("hidden");
      $(`groupCard-${s.key}`)?.classList.toggle("locked",i!==0);
      setSideState(s.key,"대기","review");
    });
    G.activeIndex=0;
    updateSubmitState();
  }

  async function submitGroup(){
    if(G.submitting)return;

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

      const compressed={};
      for(const s of SIDES){
        $("groupSubmitBtn").textContent=`${s.label} 사진 준비 중...`;
        compressed[s.key]=await compressFile(G.sides[s.key].file,1800,.86);
      }

      const meta={
        ...profile,
        vehicle_type:G.vehicleType,
        sides:{}
      };

      for(const s of SIDES){
        meta.sides[s.key]={
          sticker_id:Number(sideStickers[s.key].id),
          plate:G.sides[s.key].plate
        };
      }

      const fd=new FormData();
      fd.append("meta",JSON.stringify(meta));
      for(const s of SIDES){
        fd.append(`${s.key}_file`,compressed[s.key],`${s.key}.jpg`);
      }

      $("groupSubmitBtn").textContent="3면 사진 저장 중...";

      const r=await fetch("/api/vehicle-inspection",{method:"POST",body:fd});
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||"통합 점검 제출에 실패했습니다.");

      const snapshots=SIDES.map(s=>({
        side:s.key,
        sticker:sideStickers[s.key],
        examples:sideStickers[s.key].examples||[],
        token:String(d.sides?.[s.key]?.analysis_token||""),
        snapshot:{
          sticker:sideStickers[s.key],
          vehicleType:G.vehicleType,
          rules:G.config?.rules||{},
          photoImage:G.sides[s.key].image,
          selection:null,
          plateSelection:{...G.sides[s.key].plate},
          missing:false
        }
      }));

      setMessage(
        `제출 완료 · 접수번호 ${d.receipt_no}. 운전석·조수석·후면이 하나의 차량 점검결과로 저장되었습니다.`,
        "success"
      );

      $("groupSubmitBtn").textContent="제출 완료";

      // 원본 저장이 완료된 뒤 관리자용 자동분석을 순차 수행합니다.
      setTimeout(()=>runBackgroundAnalysis(Number(d.id),snapshots),50);

      setTimeout(()=>{
        resetAllSides();
        $("groupSubmitBtn").textContent="차량 점검 1건으로 제출";
      },1200);

    }catch(e){
      setMessage(e.message||"통합 점검 제출에 실패했습니다.","error");
      $("groupSubmitBtn").textContent="차량 점검 1건으로 제출";
    }finally{
      G.submitting=false;
      updateSubmitState();
    }
  }

  async function runBackgroundAnalysis(id,snapshots){
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
    const ready=Boolean(G.vehicleType&&done&&!G.submitting);

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
