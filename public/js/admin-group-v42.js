(() => {
  "use strict";

  const selected=new Set();
  let items=[];

  const $=id=>document.getElementById(id);
  const esc=s=>String(s??"")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");

  window.loadVehicleGroupInspections=loadGroups;

  document.addEventListener("DOMContentLoaded",()=>{
    $("groupSelectAll")?.addEventListener("change",toggleAll);
    $("groupCompleteSelectedBtn")?.addEventListener("click",bulkComplete);
    $("groupDeleteSelectedBtn")?.addEventListener("click",bulkDelete);

    const list=$("vehicleInspectionList");

    list?.addEventListener("change",event=>{
      const checkbox=event.target.closest(".vehicle-group-checkbox");
      if(!checkbox)return;
      toggleVehicleGroupSelection(Number(checkbox.value),checkbox.checked);
    });

    list?.addEventListener("click",event=>{
      const saveBtn=event.target.closest("[data-group-save-id]");
      if(!saveBtn)return;
      saveVehicleGroupInspection(Number(saveBtn.dataset.groupSaveId));
    });
  });

  async function loadGroups(){
    const host=$("vehicleInspectionList");
    if(!host)return;

    host.innerHTML='<div class="empty">통합 점검결과를 불러오는 중...</div>';
    selected.clear();
    updateSelectionUi();

    const q=new URLSearchParams();
    if($("resultSearch")?.value.trim())q.set("q",$("resultSearch").value.trim());
    if($("statusFilter")?.value)q.set("status",$("statusFilter").value);
    if($("stateFilter")?.value)q.set("admin_state",$("stateFilter").value);

    try{
      const r=await fetch(`/api/admin/vehicle-inspections?${q}`,{cache:"no-store"});
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||"통합 점검결과 조회 실패");

      items=d.items||[];

      if($("countAll"))$("countAll").textContent=d.counts?.all??items.length;
      if($("countNormal"))$("countNormal").textContent=d.counts?.normal??0;
      if($("countReview"))$("countReview").textContent=d.counts?.review??0;
      if($("countInvalid"))$("countInvalid").textContent=d.counts?.invalid??0;
      if($("countAction"))$("countAction").textContent=d.counts?.action??0;

      host.innerHTML=items.length
        ?items.map(renderCard).join("")
        :'<div class="empty">통합 점검결과가 없습니다.</div>';

      updateSelectionUi();
    }catch(e){
      items=[];
      host.innerHTML=`<div class="message error">${esc(e.message)}</div>`;
    }
  }

  function renderCard(x){
    return`
      <article class="vehicle-inspection-card">
        <div class="vehicle-inspection-card-head">
          <label class="bulk-select-label">
            <input
              class="vehicle-group-checkbox"
              type="checkbox"
              value="${x.id}"
            >
          </label>

          <div class="vehicle-group-meta">
            <span class="step">접수번호 ${esc(x.receipt_no)}</span>
            <h3>${esc(x.vehicle_no)} · ${vehicleLabel(x.vehicle_type)}</h3>
            <span>${esc(x.employee_name)} · ${esc(x.employee_id)} · ${esc(x.department)}</span>
            <span class="muted">${formatDate(x.created_at)}</span>
          </div>

          <span class="pill ${statusClass(x.overall_status)}">
            종합 ${esc(x.overall_status)}
          </span>
        </div>

        <div class="vehicle-side-results">
          ${renderSide(x,"driver","운전석")}
          ${renderSide(x,"passenger","조수석")}
          ${renderSide(x,"rear","후면")}
        </div>

        <div class="vehicle-admin-panel">
          <select id="groupState-${x.id}">
            ${["미확인","확인완료","개선요청","조치완료"].map(v=>`
              <option ${x.admin_state===v?"selected":""}>${v}</option>
            `).join("")}
          </select>
          <textarea id="groupNote-${x.id}" placeholder="관리자 메모">${esc(x.admin_note||"")}</textarea>
          <button class="btn primary small" type="button" data-group-save-id="${x.id}">저장</button>
        </div>
      </article>
    `;
  }

  function renderSide(x,side,label){
    const status=x[`${side}_status`]||"분석대기";
    const findings=parseJson(x[`${side}_findings`],[]);
    const metrics=parseJson(x[`${side}_metrics`],{});

    return`
      <div class="vehicle-side-result ${statusClass(status)}">
        <div class="vehicle-side-title">
          <strong>${label}</strong>
          <span class="pill ${statusClass(status)}">${esc(status)}</span>
        </div>
        <img
          src="/api/admin/vehicle-inspections/${x.id}/side/${side}/image"
          alt="${label} 사진"
          onclick="openImage('/api/admin/vehicle-inspections/${x.id}/side/${side}/image')"
        >
        <div class="vehicle-side-detail">
          <span>${status==="분석대기"
            ?"자동분석 대기 중"
            :(metrics.stickerDetected===true?"스티커 검출":"스티커 미검출")}</span>
          ${findings.length?`<span>${esc(findings.join(" / "))}</span>`:""}
        </div>
        <a
          class="btn secondary small"
          href="/api/admin/vehicle-inspections/${x.id}/side/${side}/image?download=1"
        >사진 다운로드</a>
      </div>
    `;
  }

  window.saveVehicleGroupInspection=async function(id){
    const state=$(`groupState-${id}`)?.value||"미확인";
    const note=$(`groupNote-${id}`)?.value||"";

    try{
      const r=await fetch(`/api/admin/vehicle-inspections/${id}`,{
        method:"PATCH",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({admin_state:state,admin_note:note})
      });
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||"저장 실패");
      alert("관리상태와 메모를 저장했습니다.");
      await loadGroups();
    }catch(e){
      alert(e.message);
    }
  };

  window.toggleVehicleGroupSelection=function(id,checked){
    if(checked)selected.add(Number(id));
    else selected.delete(Number(id));
    updateSelectionUi();
  };

  function toggleAll(){
    const checked=$("groupSelectAll").checked;
    selected.clear();
    if(checked)items.forEach(x=>selected.add(Number(x.id)));

    document.querySelectorAll(".vehicle-group-checkbox").forEach(cb=>{
      cb.checked=checked;
    });
    updateSelectionUi();
  }

  async function bulkComplete(){
    const ids=[...selected];
    if(!ids.length){
      alert("확인완료 처리할 차량 점검결과를 선택해 주세요.");
      return;
    }

    if(!confirm(
      `선택한 ${ids.length}대의 차량 점검을 자동판정 결과와 관계없이 '확인완료'로 변경합니다.\\n\\n`+
      `관리자가 3개 촬영면을 직접 확인했는지 확인해 주세요.`
    ))return;

    const btn=$("groupCompleteSelectedBtn");
    if(btn){
      btn.disabled=true;
      btn.textContent="처리 중...";
    }

    try{
      const r=await fetch("/api/admin/vehicle-inspections/bulk-state",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({ids})
      });
      const d=await r.json();

      if(!r.ok)throw new Error(d.error||"확인완료 처리 실패");

      alert(`${Number(d.updated||0)}건을 확인완료로 변경했습니다.`);
      await loadGroups();
    }catch(e){
      alert(`확인완료 처리에 실패했습니다.\n${e.message}`);
      updateSelectionUi();
    }
  }

  async function bulkDelete(){
    const ids=[...selected];
    if(!ids.length){
      alert("삭제할 차량 점검결과를 선택해 주세요.");
      return;
    }

    if(!confirm(
      `선택한 ${ids.length}대의 통합 점검결과와 운전석·조수석·후면 사진 3장이 모두 삭제됩니다.\\n복구할 수 없습니다.`
    ))return;

    const btn=$("groupDeleteSelectedBtn");
    if(btn){
      btn.disabled=true;
      btn.textContent="삭제 중...";
    }

    try{
      const r=await fetch("/api/admin/vehicle-inspections/bulk-delete",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({ids})
      });
      const d=await r.json();

      if(!r.ok)throw new Error(d.error||"삭제 실패");

      let message=`${Number(d.deleted||0)}건을 삭제했습니다.`;
      if(Number(d.image_delete_failed||0)>0){
        message+=`\n사진 ${Number(d.image_delete_failed)}건의 저장소 정리에 실패했습니다.`;
      }

      alert(message);
      await loadGroups();
    }catch(e){
      alert(`삭제에 실패했습니다.\n${e.message}`);
      updateSelectionUi();
    }
  }

  function updateSelectionUi(){
    const count=selected.size;
    if($("groupSelectedCountText"))$("groupSelectedCountText").textContent=`선택 ${count}건`;
    if($("groupCompleteSelectedBtn")){
      $("groupCompleteSelectedBtn").textContent=`선택 확인완료 (${count})`;
      $("groupCompleteSelectedBtn").disabled=count===0;
    }
    if($("groupDeleteSelectedBtn")){
      $("groupDeleteSelectedBtn").textContent=`선택 삭제 (${count})`;
      $("groupDeleteSelectedBtn").disabled=count===0;
    }

    const all=$("groupSelectAll");
    if(all){
      all.disabled=items.length===0;
      all.checked=items.length>0&&count===items.length;
      all.indeterminate=count>0&&count<items.length;
    }
  }

  function parseJson(v,fallback){
    try{return JSON.parse(v||"")}catch{return fallback}
  }

  function statusClass(v){
    if(v==="정상")return"normal";
    if(v==="확인필요")return"review";
    if(v==="판정불가")return"invalid";
    return"pending";
  }

  function vehicleLabel(v){
    return v==="k3"?"K3":(v==="avante"?"아반떼":(v==="ev3"?"EV3":esc(v||"-")));
  }

  function formatDate(v){
    if(window.formatKstDateTime)return window.formatKstDateTime(v);
    return esc(v||"-");
  }
})();
