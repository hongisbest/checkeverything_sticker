(() => {
  "use strict";

  const state={
    page:1,
    totalPages:1,
    sort:"employee_name",
    dir:"asc",
    rows:[],
    importMatrix:null,
    importHeaders:[],
    importFileName:""
  };

  const baseSwitchView=window.switchView;

  function el(id){return document.getElementById(id)}

  function escapeHtml(v){
    return String(v??"").replace(/[&<>"']/g,c=>({
      "&":"&amp;",
      "<":"&lt;",
      ">":"&gt;",
      '"':"&quot;",
      "'":"&#039;"
    }[c]));
  }

  window.switchView=function(v){
    if(v!=="vehicles"){
      el("vehiclesView")?.classList.add("hidden");
      return baseSwitchView(v);
    }

    ["stickersView","rulesView","resultsView"].forEach(id=>{
      el(id)?.classList.add("hidden");
    });

    el("vehiclesView")?.classList.remove("hidden");

    document.querySelectorAll("[data-view]").forEach(b=>{
      b.classList.toggle("primary",b.dataset.view==="vehicles");
    });

    state.page=1;
    loadVehicleData();
  };

  function query(){
    const q=new URLSearchParams();
    q.set("page",String(state.page));
    q.set("sort",state.sort);
    q.set("dir",state.dir);

    const values={
      q:el("vehicleDataSearch")?.value.trim(),
      employee_name:el("filterVehicleName")?.value.trim(),
      employee_id:el("filterVehicleEmployeeId")?.value.trim(),
      department:el("filterVehicleDepartment")?.value.trim(),
      vehicle_no:el("filterVehicleNo")?.value.trim()
    };

    Object.entries(values).forEach(([k,v])=>{
      if(v)q.set(k,v);
    });

    return q.toString();
  }

  async function loadVehicleData(){
    const body=el("vehicleDataTableBody");
    if(body)body.innerHTML='<tr><td colspan="5">불러오는 중...</td></tr>';

    try{
      const r=await fetch(`/api/admin/vehicle-data?${query()}`,{cache:"no-store"});
      const d=await r.json();

      if(!r.ok)throw new Error(d.error||"차량데이터 조회 실패");

      state.rows=d.items||[];
      state.page=Number(d.page||1);
      state.totalPages=Number(d.total_pages||1);

      el("vehicleDataCountBadge").textContent=`${Number(d.total||0).toLocaleString()}건`;
      el("vehiclePageInfo").textContent=`${state.page} / ${state.totalPages}`;
      el("vehiclePrevPage").disabled=state.page<=1;
      el("vehicleNextPage").disabled=state.page>=state.totalPages;

      renderRows();
    }catch(error){
      if(body)body.innerHTML=`<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
    }
  }

  function renderRows(){
    const body=el("vehicleDataTableBody");
    if(!body)return;

    if(!state.rows.length){
      body.innerHTML='<tr><td colspan="5">조건에 맞는 차량데이터가 없습니다.</td></tr>';
      return;
    }

    body.innerHTML=state.rows.map(row=>`
      <tr data-id="${Number(row.id)}">
        <td><input data-field="employee_name" value="${escapeHtml(row.employee_name)}"></td>
        <td><input data-field="employee_id" value="${escapeHtml(row.employee_id)}"></td>
        <td><input data-field="department" value="${escapeHtml(row.department)}"></td>
        <td><input data-field="vehicle_no" value="${escapeHtml(row.vehicle_no)}"></td>
        <td style="white-space:nowrap">
          <button class="btn small primary" type="button" data-save-row="${Number(row.id)}">저장</button>
          <button class="btn small danger" type="button" data-delete-row="${Number(row.id)}">삭제</button>
        </td>
      </tr>
    `).join("");

    body.querySelectorAll("[data-save-row]").forEach(btn=>{
      btn.onclick=()=>saveRow(Number(btn.dataset.saveRow));
    });

    body.querySelectorAll("[data-delete-row]").forEach(btn=>{
      btn.onclick=()=>deleteRow(Number(btn.dataset.deleteRow));
    });
  }

  function rowPayload(id){
    const tr=el("vehicleDataTableBody")?.querySelector(`tr[data-id="${id}"]`);
    if(!tr)return null;

    const get=name=>tr.querySelector(`[data-field="${name}"]`)?.value.trim()||"";

    return{
      employee_name:get("employee_name"),
      employee_id:get("employee_id"),
      department:get("department"),
      vehicle_no:get("vehicle_no")
    };
  }

  async function saveRow(id){
    const payload=rowPayload(id);
    if(!payload)return;

    try{
      const r=await fetch(`/api/admin/vehicle-data/${id}`,{
        method:"PATCH",
        headers:{"content-type":"application/json"},
        body:JSON.stringify(payload)
      });
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||"수정 실패");

      setMessage("vehicleDataListMessage","수정 완료","success");
      await loadVehicleData();
    }catch(error){
      setMessage("vehicleDataListMessage",error.message,"error");
    }
  }

  async function deleteRow(id){
    if(!confirm("이 차량데이터를 삭제하시겠습니까?"))return;

    try{
      const r=await fetch(`/api/admin/vehicle-data/${id}`,{method:"DELETE"});
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||"삭제 실패");

      setMessage("vehicleDataListMessage","삭제 완료","success");
      await loadVehicleData();
    }catch(error){
      setMessage("vehicleDataListMessage",error.message,"error");
    }
  }

  async function addManual(){
    const payload={
      employee_name:el("manualEmployeeName").value.trim(),
      employee_id:el("manualEmployeeId").value.trim(),
      department:el("manualDepartment").value.trim(),
      vehicle_no:el("manualVehicleNo").value.trim()
    };

    if(Object.values(payload).some(v=>!v)){
      setMessage("manualVehicleMessage","4개 항목을 모두 입력해 주세요.","error");
      return;
    }

    try{
      const r=await fetch("/api/admin/vehicle-data",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify(payload)
      });
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||"등록 실패");

      ["manualEmployeeName","manualEmployeeId","manualDepartment","manualVehicleNo"]
        .forEach(id=>el(id).value="");

      setMessage("manualVehicleMessage","차량데이터 등록 완료","success");
      state.page=1;
      await loadVehicleData();
    }catch(error){
      setMessage("manualVehicleMessage",error.message,"error");
    }
  }

  async function readExcelFile(file){
    if(!file)return;

    if(!window.XLSX){
      setMessage(
        "vehicleImportFileInfo",
        "엑셀 처리 모듈을 불러오지 못했습니다. 네트워크 상태를 확인해 주세요.",
        "error"
      );
      return;
    }

    try{
      const data=await file.arrayBuffer();
      const wb=XLSX.read(data,{type:"array"});
      const first=wb.SheetNames[0];
      if(!first)throw new Error("엑셀 시트를 찾을 수 없습니다.");

      const matrix=XLSX.utils.sheet_to_json(
        wb.Sheets[first],
        {header:1,defval:"",raw:false}
      );

      if(matrix.length<2){
        throw new Error("헤더와 데이터가 있는 엑셀파일을 선택해 주세요.");
      }

      const headers=(matrix[0]||[]).map(x=>String(x??"").trim());

      if(!headers.some(Boolean)){
        throw new Error("첫 번째 행에서 열 제목을 찾을 수 없습니다.");
      }

      state.importMatrix=matrix;
      state.importHeaders=headers;
      state.importFileName=file.name;

      fillMappingSelects(headers);
      autoMapColumns(headers);

      el("vehicleImportMapping").classList.remove("hidden");

      setMessage(
        "vehicleImportFileInfo",
        `${file.name} · 데이터 ${Math.max(0,matrix.length-1).toLocaleString()}행 · 필요한 4개 열을 확인해 주세요.`,
        "success"
      );
    }catch(error){
      state.importMatrix=null;
      state.importHeaders=[];
      el("vehicleImportMapping").classList.add("hidden");
      setMessage("vehicleImportFileInfo",error.message,"error");
    }
  }

  function fillMappingSelects(headers){
    const ids=[
      "mapEmployeeName",
      "mapEmployeeId",
      "mapDepartment",
      "mapVehicleNo"
    ];

    const options=
      '<option value="">열 선택</option>'+
      headers.map((h,i)=>`<option value="${i}">${escapeHtml(h||`열 ${i+1}`)}</option>`).join("");

    ids.forEach(id=>{
      el(id).innerHTML=options;
    });
  }

  function normalizeHeader(v){
    return String(v||"")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\s_()（）\[\]·.-]/g,"");
  }

  function autoMapColumns(headers){
    const aliases={
      mapEmployeeName:["성명","이름","직원명","임직원명","name"],
      mapEmployeeId:["사번","직원번호","임직원번호","employeeid","empid"],
      mapDepartment:["부서","부서명","소속","조직","조직명","department"],
      mapVehicleNo:["차량번호","차량등록번호","차번","자동차번호","vehicleno","carnumber"]
    };

    Object.entries(aliases).forEach(([id,names])=>{
      const normalized=names.map(normalizeHeader);
      const index=headers.findIndex(h=>normalized.includes(normalizeHeader(h)));
      if(index>=0)el(id).value=String(index);
    });
  }

  async function applyImport(){
    const matrix=state.importMatrix;
    if(!matrix){
      setMessage("vehicleImportFileInfo","먼저 엑셀파일을 선택해 주세요.","error");
      return;
    }

    const mapping={
      employee_name:Number(el("mapEmployeeName").value),
      employee_id:Number(el("mapEmployeeId").value),
      department:Number(el("mapDepartment").value),
      vehicle_no:Number(el("mapVehicleNo").value)
    };

    if(Object.values(mapping).some(v=>!Number.isInteger(v)||v<0)){
      setMessage("vehicleImportFileInfo","성명·사번·부서·차량번호 열을 모두 선택해 주세요.","error");
      return;
    }

    if(new Set(Object.values(mapping)).size!==4){
      setMessage("vehicleImportFileInfo","서로 다른 4개 열을 선택해 주세요.","error");
      return;
    }

    const rows=[];
    const invalid=[];

    for(let i=1;i<matrix.length;i++){
      const line=matrix[i]||[];
      const row={
        employee_name:String(line[mapping.employee_name]??"").trim(),
        employee_id:String(line[mapping.employee_id]??"").trim(),
        department:String(line[mapping.department]??"").trim(),
        vehicle_no:String(line[mapping.vehicle_no]??"").trim()
      };

      if(Object.values(row).every(v=>!v))continue;

      if(Object.values(row).some(v=>!v)){
        invalid.push(i+1);
        continue;
      }

      rows.push(row);
    }

    if(invalid.length){
      setMessage(
        "vehicleImportFileInfo",
        `필수값이 비어 있는 행이 있습니다: ${invalid.slice(0,15).join(", ")}${invalid.length>15?" 외":""}`,
        "error"
      );
      return;
    }

    if(!rows.length){
      setMessage("vehicleImportFileInfo","등록할 데이터가 없습니다.","error");
      return;
    }

    const btn=el("applyVehicleImportBtn");
    btn.disabled=true;

    try{
      let processed=0;

      for(let i=0;i<rows.length;i+=1000){
        const chunk=rows.slice(i,i+1000);

        setMessage(
          "vehicleImportFileInfo",
          `등록 중... ${processed.toLocaleString()} / ${rows.length.toLocaleString()}건`,
          "info"
        );

        const r=await fetch("/api/admin/vehicle-data/import",{
          method:"POST",
          headers:{"content-type":"application/json"},
          body:JSON.stringify({rows:chunk})
        });

        const d=await r.json();
        if(!r.ok)throw new Error(d.error||"엑셀 데이터 등록 실패");

        processed+=Number(d.processed||chunk.length);
      }

      setMessage(
        "vehicleImportFileInfo",
        `${processed.toLocaleString()}건 등록/업데이트 완료`,
        "success"
      );

      el("vehicleImportMapping").classList.add("hidden");
      el("vehicleExcelFile").value="";
      state.importMatrix=null;

      state.page=1;
      await loadVehicleData();
    }catch(error){
      setMessage("vehicleImportFileInfo",error.message,"error");
    }finally{
      btn.disabled=false;
    }
  }

  async function downloadExcel(){
    if(!window.XLSX){
      setMessage("vehicleExportMessage","엑셀 처리 모듈을 불러오지 못했습니다.","error");
      return;
    }

    try{
      const r=await fetch("/api/admin/vehicle-data/export",{cache:"no-store"});
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||"다운로드 데이터 조회 실패");

      const rows=(d.items||[]).map(x=>({
        "성명":x.employee_name,
        "사번":x.employee_id,
        "부서":x.department,
        "차량번호":x.vehicle_no
      }));

      const ws=XLSX.utils.json_to_sheet(rows,{
        header:["성명","사번","부서","차량번호"]
      });

      const wb=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb,ws,"차량데이터");

      const now=new Date();
      const y=now.getFullYear();
      const m=String(now.getMonth()+1).padStart(2,"0");
      const d2=String(now.getDate()).padStart(2,"0");

      XLSX.writeFile(wb,`차량데이터_${y}${m}${d2}.xlsx`);

      setMessage("vehicleExportMessage",`${rows.length.toLocaleString()}건 엑셀 다운로드 완료`,"success");
    }catch(error){
      setMessage("vehicleExportMessage",error.message,"error");
    }
  }

  function sortBy(column){
    if(state.sort===column){
      state.dir=state.dir==="asc" ? "desc" : "asc";
    }else{
      state.sort=column;
      state.dir="asc";
    }

    state.page=1;
    loadVehicleData();
  }

  function resetFilters(){
    [
      "vehicleDataSearch",
      "filterVehicleName",
      "filterVehicleEmployeeId",
      "filterVehicleDepartment",
      "filterVehicleNo"
    ].forEach(id=>el(id).value="");

    state.page=1;
    state.sort="employee_name";
    state.dir="asc";
    loadVehicleData();
  }

  function setMessage(id,text,type="info"){
    const node=el(id);
    if(!node)return;
    node.className=`message ${type}`;
    node.textContent=text;
  }

  document.addEventListener("DOMContentLoaded",()=>{
    el("vehicleExcelFile").addEventListener("change",e=>{
      readExcelFile(e.target.files?.[0]);
    });

    el("applyVehicleImportBtn").onclick=applyImport;
    el("downloadVehicleDataBtn").onclick=downloadExcel;
    el("addVehicleDataBtn").onclick=addManual;

    el("vehicleDataSearchBtn").onclick=()=>{
      state.page=1;
      loadVehicleData();
    };

    el("vehicleDataResetBtn").onclick=resetFilters;

    el("vehicleDataSearch").addEventListener("keydown",e=>{
      if(e.key==="Enter"){
        state.page=1;
        loadVehicleData();
      }
    });

    [
      "filterVehicleName",
      "filterVehicleEmployeeId",
      "filterVehicleDepartment",
      "filterVehicleNo"
    ].forEach(id=>{
      el(id).addEventListener("keydown",e=>{
        if(e.key==="Enter"){
          state.page=1;
          loadVehicleData();
        }
      });
    });

    document.querySelectorAll(".vehicle-sort-btn").forEach(btn=>{
      btn.onclick=()=>sortBy(btn.dataset.sort);
    });

    el("vehiclePrevPage").onclick=()=>{
      if(state.page>1){
        state.page--;
        loadVehicleData();
      }
    };

    el("vehicleNextPage").onclick=()=>{
      if(state.page<state.totalPages){
        state.page++;
        loadVehicleData();
      }
    };
  });
})();