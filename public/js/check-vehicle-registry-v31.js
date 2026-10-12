(() => {
  "use strict";

  let registryVerified=false;
  let lastVerifiedSignature="";
  let departmentsLoaded=false;
  let verifyTimer=null;
  let verifySequence=0;

  const originalOpenSubmissionReview=window.openSubmissionReview;
  const originalSubmitInspection=window.submitInspection;

  function field(id){
    return document.getElementById(id);
  }

  function values(){
    return{
      employee_name:String(field("employeeName")?.value||"").trim(),
      employee_id:String(field("employeeId")?.value||"").trim(),
      department:String(field("department")?.value||"").trim(),
      vehicle_no:String(field("vehicleNo")?.value||"").trim()
    };
  }

  function signature(v=values()){
    return[
      v.employee_name,
      v.employee_id,
      v.department,
      v.vehicle_no.replace(/[\s-]+/g,"").toUpperCase()
    ].join("|");
  }

  function allRequired(v=values()){
    return Boolean(
      v.employee_name &&
      v.employee_id &&
      v.department &&
      v.vehicle_no
    );
  }

  function resetMatchState(){
    registryVerified=false;
    lastVerifiedSignature="";
    window.__vehicleRegistryVerified=false;

    if(field("plateMatchConfirm")){
      field("plateMatchConfirm").checked=false;
    }

    if(window.S){
      S.plateMatchConfirmed=false;
      S.plateOcrResult=null;
    }

    const box=field("vehicleRegistryMessage");
    if(box){
      box.className="message info";
      box.textContent=
        "성명·사번·부서·차량번호를 모두 입력하면 등록 차량데이터와 자동으로 대조합니다.";
    }
  }

  async function loadDepartments(){
    const select=field("department");
    if(!select)return;

    const current=select.value;

    try{
      const r=await fetch("/api/vehicle-registry/departments",{cache:"no-store"});
      const d=await r.json();

      if(!r.ok)throw new Error(d.error||"부서정보 조회 실패");

      const departments=Array.isArray(d.departments)?d.departments:[];

      select.innerHTML=
        '<option value="">부서를 선택해 주세요</option>'+
        departments.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("");

      const saved=readSavedDepartment();

      if(current && departments.includes(current)){
        select.value=current;
      }else if(saved && departments.includes(saved)){
        select.value=saved;
      }

      departmentsLoaded=true;

      if(allRequired(values())){
        scheduleStep1Verification(150);
      }

      const box=field("vehicleRegistryMessage");
      if(!departments.length && box){
        box.className="message warn";
        box.textContent=
          "등록된 차량데이터가 없습니다. 관리자에게 차량데이터 등록을 요청해 주세요.";
      }
    }catch(error){
      departmentsLoaded=false;
      const box=field("vehicleRegistryMessage");
      if(box){
        box.className="message error";
        box.textContent=
          "부서목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
      }
    }
  }

  function readSavedDepartment(){
    try{
      const p=JSON.parse(localStorage.getItem("sticker_compare_profile")||"{}");
      return String(p.department||"").trim();
    }catch{
      return "";
    }
  }

  async function verifyRegistry({showSuccess=true,silentIncomplete=false}={}){
    const v=values();
    const box=field("vehicleRegistryMessage");
    const requestSequence=++verifySequence;

    if(!allRequired(v)){
      resetMatchState();

      if(box && !silentIncomplete){
        box.className="message warn";
        box.textContent="성명, 사번, 부서, 차량번호를 모두 입력해 주세요.";
      }

      return false;
    }

    const sig=signature(v);

    if(registryVerified && sig===lastVerifiedSignature){
      applyLegacySubmitCompatibility(true);
      return true;
    }

    if(box){
      box.className="message info";
      box.textContent="등록 차량데이터와 입력정보를 대조하고 있습니다...";
    }

    try{
      const r=await fetch("/api/vehicle-registry/verify",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify(v)
      });

      const d=await r.json().catch(()=>({}));

      if(!r.ok){
        throw new Error(d.error||"차량데이터 대조 실패");
      }

      if(requestSequence!==verifySequence){
        return false;
      }

      registryVerified=d.matched===true;
      lastVerifiedSignature=registryVerified ? sig : "";
      window.__vehicleRegistryVerified=registryVerified;

      applyLegacySubmitCompatibility(registryVerified);

      if(box){
        box.className=registryVerified ? "message success" : "message error";
        box.textContent=registryVerified
          ? "등록 차량데이터와 입력정보 4개 항목이 모두 일치합니다."
          : "입력한 성명·사번·부서·차량번호가 등록 차량데이터와 일치하지 않습니다.";
      }

      if(showSuccess && registryVerified){
        saveProfileSafe();
      }

      return registryVerified;

    }catch(error){
      resetMatchState();

      if(box){
        box.className="message error";
        box.textContent=error.message||"차량데이터 대조 중 오류가 발생했습니다.";
      }

      return false;
    }
  }

  function applyLegacySubmitCompatibility(matched){
    // V31에서는 STEP 01 등록데이터 완전일치가 기존 번호판 OCR 확인을 대체합니다.
    // 사용자에게 추가 체크를 요구하지 않고 기존 check.js가 요구하는 내부값만 맞춥니다.
    if(field("plateMatchConfirm")){
      field("plateMatchConfirm").checked=matched===true;
    }

    if(window.S){
      S.plateMatchConfirmed=matched===true;
      S.plateOcrResult={
        supported:true,
        matched:matched===true,
        text:matched ? "등록데이터 일치" : "등록데이터 불일치",
        source:"vehicle-registry"
      };
    }
  }

  function scheduleStep1Verification(delay=550){
    if(verifyTimer){
      clearTimeout(verifyTimer);
    }

    const v=values();

    if(!allRequired(v)){
      resetMatchState();
      return;
    }

    const box=field("vehicleRegistryMessage");
    if(box){
      box.className="message info";
      box.textContent="입력정보 확인 대기 중...";
    }

    verifyTimer=setTimeout(()=>{
      verifyRegistry({showSuccess:true,silentIncomplete:true});
    },delay);
  }

  window.openSubmissionReview=async function(){
    const ok=await verifyRegistry({showSuccess:true});

    if(!ok){
      alert("성명·사번·부서·차량번호가 관리자 등록 차량데이터와 일치해야 제출할 수 있습니다.");
      window.scrollTo({top:0,behavior:"smooth"});
      return;
    }

    return originalOpenSubmissionReview();
  };

  // Existing review function still calls tryNativePlateOcr().
  // Replace that action with DB registry verification.
  window.tryNativePlateOcr=async function(){
    const ok=await verifyRegistry({showSuccess:false});

    const v=values();

    if(field("enteredVehicleNoPreview")){
      field("enteredVehicleNoPreview").textContent=v.vehicle_no||"-";
    }

    if(field("plateOcrPreview")){
      field("plateOcrPreview").textContent=
        ok ? "4개 항목 일치 ✓" : "불일치";
    }

    if(field("plateOcrMessage")){
      field("plateOcrMessage").className=
        ok ? "message success" : "message error";

      field("plateOcrMessage").textContent=
        ok
          ? "성명·사번·부서·차량번호가 관리자 등록 차량데이터와 모두 일치합니다."
          : "등록 차량데이터와 입력정보가 일치하지 않습니다.";
    }

    applyLegacySubmitCompatibility(ok);
  };

  window.showManualPlateFallback=function(){
    // OCR is no longer used.
  };

  async function guardedSubmit(event){
    const ok=await verifyRegistry({showSuccess:false});

    if(!ok){
      event?.preventDefault?.();
      event?.stopPropagation?.();
      alert("등록 차량데이터와 입력정보가 일치하지 않아 제출할 수 없습니다.");
      window.scrollTo({top:0,behavior:"smooth"});
      return;
    }

    applyLegacySubmitCompatibility(true);
    return originalSubmitInspection(event);
  }

  function saveProfileSafe(){
    try{
      if(typeof window.saveProfile==="function"){
        window.saveProfile();
      }
    }catch{}
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

  document.addEventListener("DOMContentLoaded",()=>{
    loadDepartments();

    ["employeeName","employeeId","department","vehicleNo"].forEach(id=>{
      const el=field(id);
      if(!el)return;

      const eventName=el.tagName==="SELECT" ? "change" : "input";
      el.addEventListener(eventName,()=>{
        resetMatchState();
        saveProfileSafe();
        scheduleStep1Verification(
          el.tagName==="SELECT" ? 120 : 550
        );
      });

      if(el.tagName!=="SELECT"){
        el.addEventListener("blur",()=>{
          if(allRequired(values())){
            scheduleStep1Verification(80);
          }
        });
      }
    });

    // check.js already attached the original handlers before this listener runs.
    const analyze=field("analyzeBtn");
    if(analyze){
      analyze.onclick=window.openSubmissionReview;
    }

    const submit=field("submitBtn");
    if(submit){
      submit.removeEventListener("click",originalSubmitInspection);
      submit.addEventListener("click",guardedSubmit);
    }
  });

  window.addEventListener("focus",()=>{
    if(!departmentsLoaded)loadDepartments();
  });
})();