(() => {
  "use strict";

  let registryVerified=false;
  let lastVerifiedSignature="";
  let departmentsLoaded=false;

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
        "관리자 등록 차량데이터와 성명·사번·부서·차량번호 4개 항목을 대조합니다.";
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

  async function verifyRegistry({showSuccess=true}={}){
    const v=values();
    const box=field("vehicleRegistryMessage");

    if(!allRequired(v)){
      resetMatchState();

      if(box){
        box.className="message warn";
        box.textContent="성명, 사번, 부서, 차량번호를 모두 입력해 주세요.";
      }

      return false;
    }

    const sig=signature(v);

    if(registryVerified && sig===lastVerifiedSignature){
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

      registryVerified=d.matched===true;
      lastVerifiedSignature=registryVerified ? sig : "";
      window.__vehicleRegistryVerified=registryVerified;

      if(field("plateMatchConfirm")){
        field("plateMatchConfirm").checked=registryVerified;
      }

      if(window.S){
        S.plateMatchConfirmed=registryVerified;
        S.plateOcrResult={
          supported:true,
          matched:registryVerified,
          text:registryVerified ? "등록데이터 일치" : "등록데이터 불일치",
          source:"vehicle-registry"
        };
      }

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

    if(field("plateMatchConfirm")){
      field("plateMatchConfirm").checked=ok;
    }

    if(window.S){
      S.plateMatchConfirmed=ok;
      S.plateOcrResult={
        supported:true,
        matched:ok,
        text:ok ? "등록데이터 일치" : "등록데이터 불일치",
        source:"vehicle-registry"
      };
    }
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
      });
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