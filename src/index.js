const encoder = new TextEncoder();
let schemaPromise = null;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/api/")) {
        await ensureSchema(env);
        return await api(request, env, url);
      }

      if (url.pathname === "/") {
        return Response.redirect(new URL("/check/", url.origin), 302);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return j({ok:false,error:"서버 처리 중 오류가 발생했습니다."},500);
    }
  }
};

function ensureSchema(env) {
  if (!schemaPromise) {
    schemaPromise = env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS st_stickers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_key TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        name TEXT NOT NULL,
        side_hint TEXT NOT NULL DEFAULT 'both',
        guide_text TEXT NOT NULL DEFAULT '',
        object_key TEXT NOT NULL UNIQUE,
        content_type TEXT NOT NULL DEFAULT 'image/jpeg',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`),

      env.DB.prepare(`CREATE TABLE IF NOT EXISTS st_rules (
        id INTEGER PRIMARY KEY CHECK (id=1),
        damage_normal_max REAL NOT NULL DEFAULT 10,
        damage_replace_min REAL NOT NULL DEFAULT 30,
        shape_similarity_min REAL NOT NULL DEFAULT 70,
        color_difference_max REAL NOT NULL DEFAULT 35,
        use_damage INTEGER NOT NULL DEFAULT 1,
        use_shape INTEGER NOT NULL DEFAULT 1,
        use_color INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`),

      env.DB.prepare(`INSERT OR IGNORE INTO st_rules (
        id,damage_normal_max,damage_replace_min,shape_similarity_min,color_difference_max,
        use_damage,use_shape,use_color
      ) VALUES (1,10,30,70,35,1,1,1)`),

      env.DB.prepare(`CREATE TABLE IF NOT EXISTS st_inspections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_name TEXT NOT NULL,
        employee_id TEXT NOT NULL DEFAULT '',
        department TEXT NOT NULL DEFAULT '',
        vehicle_no TEXT NOT NULL,
        sticker_id INTEGER NOT NULL,
        photo_object_key TEXT NOT NULL,
        crop_x REAL NOT NULL DEFAULT 0,
        crop_y REAL NOT NULL DEFAULT 0,
        crop_width REAL NOT NULL DEFAULT 1,
        crop_height REAL NOT NULL DEFAULT 1,
        sticker_missing INTEGER NOT NULL DEFAULT 0,
        score REAL NOT NULL,
        status TEXT NOT NULL,
        findings_json TEXT NOT NULL DEFAULT '[]',
        metrics_json TEXT NOT NULL DEFAULT '{}',
        admin_state TEXT NOT NULL DEFAULT '미확인',
        admin_note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`),

      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_st_stickers_active ON st_stickers(group_key,is_active)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_st_insp_status ON st_inspections(status,admin_state)")
    ]).catch(e => {
      schemaPromise = null;
      throw e;
    });
  }

  return schemaPromise;
}

async function api(request, env, url) {
  const p = url.pathname;

  // Public
  if (p === "/api/config" && request.method === "GET") return getConfig(env);
  if (p === "/api/inspection" && request.method === "POST") return saveInspection(request, env);

  const stickerImage = p.match(/^\/api\/sticker\/(\d+)\/image$/);
  if (stickerImage && request.method === "GET") {
    return getStickerImage(env, Number(stickerImage[1]));
  }

  // Auth
  if (p === "/api/admin/login" && request.method === "POST") return adminLogin(request, env);
  if (p === "/api/admin/logout" && request.method === "POST") return adminLogout();

  if (!(await verifyAdmin(request, env))) {
    return j({ok:false,error:"관리자 인증이 필요합니다."},401);
  }

  if (p === "/api/admin/me" && request.method === "GET") return j({ok:true});

  // Stickers
  if (p === "/api/admin/stickers" && request.method === "GET") return listStickers(env);
  if (p === "/api/admin/stickers" && request.method === "POST") return createSticker(request, env);

  const stickerEdit = p.match(/^\/api\/admin\/stickers\/(\d+)$/);
  if (stickerEdit && request.method === "PATCH") return updateSticker(request, env, Number(stickerEdit[1]));
  if (stickerEdit && request.method === "DELETE") return deleteSticker(env, Number(stickerEdit[1]));

  const stickerActivate = p.match(/^\/api\/admin\/stickers\/(\d+)\/activate$/);
  if (stickerActivate && request.method === "POST") return activateSticker(env, Number(stickerActivate[1]));

  // Rules
  if (p === "/api/admin/rules" && request.method === "GET") return j({ok:true,rules:await readRules(env)});
  if (p === "/api/admin/rules" && request.method === "POST") return saveRules(request, env);

  // Results
  if (p === "/api/admin/inspections" && request.method === "GET") return listInspections(env, url);
  if (p === "/api/admin/export.csv" && request.method === "GET") return exportCsv(env);

  const inspectionImage = p.match(/^\/api\/admin\/inspections\/(\d+)\/image$/);
  if (inspectionImage && request.method === "GET") return getInspectionImage(env, Number(inspectionImage[1]));

  const inspectionPatch = p.match(/^\/api\/admin\/inspections\/(\d+)$/);
  if (inspectionPatch && request.method === "PATCH") return updateInspection(request, env, Number(inspectionPatch[1]));

  return j({ok:false,error:"API 경로를 찾을 수 없습니다."},404);
}

async function adminLogin(request, env) {
  if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET) {
    return j({ok:false,error:"Cloudflare Secret 설정이 필요합니다."},500);
  }

  const body = await request.json().catch(()=>({}));
  const password = String(body.password || "");

  if (!safeEqual(password, String(env.ADMIN_PASSWORD))) {
    return j({ok:false,error:"비밀번호가 올바르지 않습니다."},401);
  }

  const expires = Date.now() + 8*60*60*1000;
  const payload = `admin:${expires}`;
  const sig = await sign(payload, env.ADMIN_SESSION_SECRET);
  const token = b64(`${payload}:${sig}`);

  return new Response(JSON.stringify({ok:true}), {
    headers:{
      "content-type":"application/json; charset=utf-8",
      "set-cookie":`st_admin=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`
    }
  });
}

function adminLogout() {
  return new Response(JSON.stringify({ok:true}), {
    headers:{
      "content-type":"application/json; charset=utf-8",
      "set-cookie":"st_admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"
    }
  });
}

async function verifyAdmin(request, env) {
  if (!env.ADMIN_SESSION_SECRET) return false;

  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)st_admin=([^;]+)/);
  if (!m) return false;

  try {
    const parts = unb64(m[1]).split(":");
    if (parts.length < 3) return false;

    const role = parts[0];
    const expires = Number(parts[1]);
    const sig = parts.slice(2).join(":");

    if (role !== "admin" || !Number.isFinite(expires) || Date.now() > expires) {
      return false;
    }

    return safeEqual(sig, await sign(`${role}:${expires}`, env.ADMIN_SESSION_SECRET));
  } catch {
    return false;
  }
}

async function readRules(env) {
  return await env.DB.prepare(`
    SELECT damage_normal_max,damage_replace_min,shape_similarity_min,color_difference_max,
           use_damage,use_shape,use_color,updated_at
    FROM st_rules WHERE id=1
  `).first();
}

async function getConfig(env) {
  const rows = await env.DB.prepare(`
    SELECT id,group_key,version,name,side_hint,guide_text,created_at
    FROM st_stickers
    WHERE is_active=1
    ORDER BY name ASC, id DESC
  `).all();

  const stickers = (rows.results || []).map(r => ({
    ...r,
    image_url:`/api/sticker/${r.id}/image`
  }));

  return j({ok:true,stickers,rules:await readRules(env)});
}

async function createSticker(request, env) {
  const form = await request.formData();
  const file = form.get("file");
  const name = txt(form.get("name"),100);
  const sideHint = txt(form.get("side_hint"),30) || "both";
  const guideText = txt(form.get("guide_text"),1000);

  if (!file || typeof file === "string") return j({ok:false,error:"기준 스티커 이미지를 선택해 주세요."},400);
  if (!name) return j({ok:false,error:"스티커명을 입력해 주세요."},400);
  if (!file.type.startsWith("image/")) return j({ok:false,error:"이미지 파일만 등록할 수 있습니다."},400);
  if (file.size > 8*1024*1024) return j({ok:false,error:"이미지는 8MB 이하로 등록해 주세요."},400);

  const groupKey = crypto.randomUUID();
  const key = `sticker-compare/reference/${Date.now()}-${crypto.randomUUID()}.${ext(file.type)}`;

  await env.STORAGE.put(key,file.stream(),{
    httpMetadata:{contentType:file.type,cacheControl:"private,max-age=0"}
  });

  try {
    const inserted = await env.DB.prepare(`
      INSERT INTO st_stickers(
        group_key,version,name,side_hint,guide_text,object_key,content_type,is_active
      ) VALUES(?,1,?,?,?,?,?,1)
      RETURNING id
    `).bind(groupKey,name,sideHint,guideText,key,file.type).first();

    return j({ok:true,id:inserted?.id});
  } catch (e) {
    await env.STORAGE.delete(key);
    throw e;
  }
}

async function listStickers(env) {
  const rows = await env.DB.prepare(`
    SELECT s.id,s.group_key,s.version,s.name,s.side_hint,s.guide_text,s.is_active,s.created_at,
           (SELECT COUNT(*) FROM st_inspections i WHERE i.sticker_id=s.id) usage_count,
           (SELECT COUNT(*) FROM st_stickers h WHERE h.group_key=s.group_key) version_count
    FROM st_stickers s
    ORDER BY s.group_key,s.version DESC
  `).all();

  return j({ok:true,items:rows.results || []});
}

async function updateSticker(request, env, id) {
  const current = await env.DB.prepare(`
    SELECT id,group_key,version,name,side_hint,guide_text,object_key,content_type,is_active
    FROM st_stickers WHERE id=?
  `).bind(id).first();

  if (!current) return j({ok:false,error:"스티커를 찾을 수 없습니다."},404);

  const form = await request.formData();
  const name = txt(form.get("name"),100);
  const sideHint = txt(form.get("side_hint"),30) || "both";
  const guideText = txt(form.get("guide_text"),1000);
  const file = form.get("file");

  if (!name) return j({ok:false,error:"스티커명을 입력해 주세요."},400);

  const hasFile = file && typeof file !== "string" && Number(file.size||0) > 0;

  if (hasFile) {
    if (!file.type.startsWith("image/")) return j({ok:false,error:"이미지 파일만 등록할 수 있습니다."},400);
    if (file.size > 8*1024*1024) return j({ok:false,error:"이미지는 8MB 이하로 등록해 주세요."},400);
  }

  const used = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM st_inspections WHERE sticker_id=?"
  ).bind(id).first();

  const usage = Number(used?.c || 0);

  // 이미 점검에 사용된 기준스티커의 이미지 변경 -> 신규 버전
  if (hasFile && usage > 0) {
    const nextVersion = Number(current.version) + 1;
    const key = `sticker-compare/reference/${Date.now()}-${crypto.randomUUID()}.${ext(file.type)}`;

    await env.STORAGE.put(key,file.stream(),{
      httpMetadata:{contentType:file.type,cacheControl:"private,max-age=0"}
    });

    try {
      await env.DB.prepare("UPDATE st_stickers SET is_active=0 WHERE group_key=?")
        .bind(current.group_key).run();

      const inserted = await env.DB.prepare(`
        INSERT INTO st_stickers(
          group_key,version,name,side_hint,guide_text,object_key,content_type,is_active
        ) VALUES(?,?,?,?,?,?,?,1)
        RETURNING id
      `).bind(
        current.group_key,nextVersion,name,sideHint,guideText,key,file.type
      ).first();

      return j({
        ok:true,
        id:inserted?.id,
        versioned:true,
        message:"기존 점검 이력을 보존하기 위해 새 버전으로 등록했습니다."
      });
    } catch (e) {
      await env.STORAGE.delete(key);
      throw e;
    }
  }

  let newKey = current.object_key;
  let newType = current.content_type;
  let oldKey = null;

  if (hasFile) {
    newKey = `sticker-compare/reference/${Date.now()}-${crypto.randomUUID()}.${ext(file.type)}`;
    newType = file.type;

    await env.STORAGE.put(newKey,file.stream(),{
      httpMetadata:{contentType:file.type,cacheControl:"private,max-age=0"}
    });

    oldKey = current.object_key;
  }

  try {
    await env.DB.prepare(`
      UPDATE st_stickers
      SET name=?,side_hint=?,guide_text=?,object_key=?,content_type=?
      WHERE id=?
    `).bind(name,sideHint,guideText,newKey,newType,id).run();

    if (oldKey && oldKey !== newKey) {
      await env.STORAGE.delete(oldKey);
    }

    return j({ok:true,id,versioned:false,message:"스티커 정보를 수정했습니다."});
  } catch (e) {
    if (hasFile && newKey !== current.object_key) {
      await env.STORAGE.delete(newKey);
    }
    throw e;
  }
}

async function activateSticker(env, id) {
  const row = await env.DB.prepare("SELECT id,group_key FROM st_stickers WHERE id=?")
    .bind(id).first();

  if (!row) return j({ok:false,error:"스티커를 찾을 수 없습니다."},404);

  await env.DB.batch([
    env.DB.prepare("UPDATE st_stickers SET is_active=0 WHERE group_key=?").bind(row.group_key),
    env.DB.prepare("UPDATE st_stickers SET is_active=1 WHERE id=?").bind(id)
  ]);

  return j({ok:true});
}

async function deleteSticker(env, id) {
  const row = await env.DB.prepare(`
    SELECT id,object_key FROM st_stickers WHERE id=?
  `).bind(id).first();

  if (!row) return j({ok:false,error:"스티커를 찾을 수 없습니다."},404);

  const used = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM st_inspections WHERE sticker_id=?"
  ).bind(id).first();

  if (Number(used?.c || 0) > 0) {
    return j({
      ok:false,
      error:"점검결과와 연결된 기준 스티커는 데이터 보존을 위해 삭제할 수 없습니다."
    },409);
  }

  await env.STORAGE.delete(row.object_key);
  await env.DB.prepare("DELETE FROM st_stickers WHERE id=?").bind(id).run();

  return j({ok:true});
}

async function getStickerImage(env, id) {
  const row = await env.DB.prepare(`
    SELECT object_key,content_type FROM st_stickers WHERE id=?
  `).bind(id).first();

  if (!row) return new Response("Not Found",{status:404});

  const object = await env.STORAGE.get(row.object_key);
  if (!object) return new Response("Not Found",{status:404});

  const h = new Headers();
  object.writeHttpMetadata(h);
  h.set("content-type",row.content_type || "image/jpeg");
  h.set("cache-control","private,max-age=180");

  return new Response(object.body,{headers:h});
}

async function saveRules(request, env) {
  const body = await request.json().catch(()=>({}));

  const damageNormal = Number(body.damage_normal_max);
  const damageReplace = Number(body.damage_replace_min);
  const shapeMin = Number(body.shape_similarity_min);
  const colorMax = Number(body.color_difference_max);

  if (![damageNormal,damageReplace,shapeMin,colorMax].every(Number.isFinite)) {
    return j({ok:false,error:"판정기준 값이 올바르지 않습니다."},400);
  }

  if (
    damageNormal < 0 || damageNormal > 100 ||
    damageReplace < 0 || damageReplace > 100 ||
    shapeMin < 0 || shapeMin > 100 ||
    colorMax < 0 || colorMax > 255
  ) {
    return j({ok:false,error:"판정기준 값의 허용범위를 확인해 주세요."},400);
  }

  if (damageReplace <= damageNormal) {
    return j({ok:false,error:"교체권고 손상률은 정상 허용 손상률보다 커야 합니다."},400);
  }

  await env.DB.prepare(`
    INSERT INTO st_rules(
      id,damage_normal_max,damage_replace_min,shape_similarity_min,color_difference_max,
      use_damage,use_shape,use_color,updated_at
    ) VALUES(1,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      damage_normal_max=excluded.damage_normal_max,
      damage_replace_min=excluded.damage_replace_min,
      shape_similarity_min=excluded.shape_similarity_min,
      color_difference_max=excluded.color_difference_max,
      use_damage=excluded.use_damage,
      use_shape=excluded.use_shape,
      use_color=excluded.use_color,
      updated_at=datetime('now')
  `).bind(
    damageNormal,damageReplace,shapeMin,colorMax,
    body.use_damage ? 1 : 0,
    body.use_shape ? 1 : 0,
    body.use_color ? 1 : 0
  ).run();

  return j({ok:true,rules:await readRules(env)});
}

async function saveInspection(request, env) {
  const form = await request.formData();
  const file = form.get("file");

  let meta;
  try {
    meta = JSON.parse(String(form.get("meta") || ""));
  } catch {
    return j({ok:false,error:"점검 데이터 형식이 올바르지 않습니다."},400);
  }

  if (!file || typeof file === "string") {
    return j({ok:false,error:"점검사진이 없습니다."},400);
  }

  if (file.size > 8*1024*1024) {
    return j({ok:false,error:"점검사진은 8MB 이하로 제출해 주세요."},400);
  }

  const stickerId = Number(meta.sticker_id);
  const sticker = await env.DB.prepare(
    "SELECT id FROM st_stickers WHERE id=?"
  ).bind(stickerId).first();

  if (!sticker) return j({ok:false,error:"기준 스티커를 찾을 수 없습니다."},400);

  const name = txt(meta.employee_name,60);
  const vehicle = txt(meta.vehicle_no,40);

  if (!name || !vehicle) {
    return j({ok:false,error:"성명과 차량번호를 입력해 주세요."},400);
  }

  const key = `sticker-compare/inspection/${Date.now()}-${crypto.randomUUID()}.jpg`;

  await env.STORAGE.put(key,file.stream(),{
    httpMetadata:{contentType:file.type || "image/jpeg"}
  });

  try {
    const inserted = await env.DB.prepare(`
      INSERT INTO st_inspections(
        employee_name,employee_id,department,vehicle_no,sticker_id,photo_object_key,
        crop_x,crop_y,crop_width,crop_height,sticker_missing,
        score,status,findings_json,metrics_json
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      RETURNING id
    `).bind(
      name,
      txt(meta.employee_id,40),
      txt(meta.department,80),
      vehicle,
      stickerId,
      key,
      Number(meta.crop_x)||0,
      Number(meta.crop_y)||0,
      Number(meta.crop_width)||1,
      Number(meta.crop_height)||1,
      meta.sticker_missing ? 1 : 0,
      Math.max(0,Math.min(100,Number(meta.score)||0)),
      meta.status==="정상" ? "정상" : "확인필요",
      JSON.stringify(Array.isArray(meta.findings) ? meta.findings.slice(0,30) : []),
      JSON.stringify(meta.metrics && typeof meta.metrics==="object" ? meta.metrics : {})
    ).first();

    return j({ok:true,id:inserted?.id});
  } catch (e) {
    await env.STORAGE.delete(key);
    throw e;
  }
}

async function listInspections(env, url) {
  const q = txt(url.searchParams.get("q"),100);
  const status = txt(url.searchParams.get("status"),20);
  const state = txt(url.searchParams.get("admin_state"),20);

  const where = [];
  const bind = [];

  if (status) {
    where.push("i.status=?");
    bind.push(status);
  }

  if (state) {
    where.push("i.admin_state=?");
    bind.push(state);
  }

  if (q) {
    where.push("(i.employee_name LIKE ? OR i.vehicle_no LIKE ? OR i.department LIKE ? OR s.name LIKE ?)");
    const value = `%${q}%`;
    bind.push(value,value,value,value);
  }

  const sql = `
    SELECT i.id,i.employee_name,i.employee_id,i.department,i.vehicle_no,i.sticker_id,
           i.crop_x,i.crop_y,i.crop_width,i.crop_height,i.sticker_missing,
           i.score,i.status,i.findings_json,i.metrics_json,
           i.admin_state,i.admin_note,i.created_at,
           s.name sticker_name,s.version sticker_version
    FROM st_inspections i
    LEFT JOIN st_stickers s ON s.id=i.sticker_id
    ${where.length ? "WHERE "+where.join(" AND ") : ""}
    ORDER BY i.id DESC
    LIMIT 500
  `;

  const r = await env.DB.prepare(sql).bind(...bind).all();

  return j({ok:true,items:r.results || []});
}

async function getInspectionImage(env, id) {
  const row = await env.DB.prepare(
    "SELECT photo_object_key FROM st_inspections WHERE id=?"
  ).bind(id).first();

  if (!row) return new Response("Not Found",{status:404});

  const object = await env.STORAGE.get(row.photo_object_key);
  if (!object) return new Response("Not Found",{status:404});

  const h = new Headers();
  object.writeHttpMetadata(h);
  h.set("cache-control","private,max-age=60");

  return new Response(object.body,{headers:h});
}

async function updateInspection(request, env, id) {
  const body = await request.json().catch(()=>({}));
  const allowed = ["미확인","확인완료","개선요청","조치완료"];
  const state = allowed.includes(body.admin_state) ? body.admin_state : "미확인";

  await env.DB.prepare(`
    UPDATE st_inspections
    SET admin_state=?,admin_note=?
    WHERE id=?
  `).bind(state,txt(body.admin_note,500),id).run();

  return j({ok:true});
}

async function exportCsv(env) {
  const r = await env.DB.prepare(`
    SELECT i.id,i.created_at,i.employee_name,i.employee_id,i.department,i.vehicle_no,
           s.name sticker_name,s.version sticker_version,
           i.sticker_missing,i.score,i.status,i.findings_json,i.admin_state,i.admin_note
    FROM st_inspections i
    LEFT JOIN st_stickers s ON s.id=i.sticker_id
    ORDER BY i.id DESC
  `).all();

  const rows = [[
    "ID","점검일시","성명","사번","부서","차량번호",
    "스티커종류","버전","스티커미확인","점수","자동판정","검증항목","관리상태","관리자메모"
  ]];

  for (const x of r.results || []) {
    let findings = [];
    try { findings = JSON.parse(x.findings_json || "[]"); } catch {}

    rows.push([
      x.id,x.created_at,x.employee_name,x.employee_id,x.department,x.vehicle_no,
      x.sticker_name || "",x.sticker_version || "",
      Number(x.sticker_missing)===1 ? "Y" : "N",
      Number(x.score).toFixed(1),x.status,findings.join(" / "),
      x.admin_state,x.admin_note
    ]);
  }

  const body = "\uFEFF" + rows.map(row =>
    row.map(v => `"${String(v??"").replace(/"/g,'""')}"`).join(",")
  ).join("\r\n");

  return new Response(body,{
    headers:{
      "content-type":"text/csv; charset=utf-8",
      "content-disposition":'attachment; filename="sticker-inspections.csv"'
    }
  });
}

function txt(v,n){return String(v??"").trim().slice(0,n)}
function ext(type){if(type.includes("png"))return"png";if(type.includes("webp"))return"webp";return"jpg"}
function j(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
function safeEqual(a,b){const x=String(a),y=String(b);if(x.length!==y.length)return false;let d=0;for(let i=0;i<x.length;i++)d|=x.charCodeAt(i)^y.charCodeAt(i);return d===0}
async function sign(payload,secret){const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const sig=await crypto.subtle.sign("HMAC",key,encoder.encode(payload));return Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,"0")).join("")}
function b64(t){return btoa(t).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
function unb64(t){const n=t.replace(/-/g,"+").replace(/_/g,"/");return atob(n+"=".repeat((4-n.length%4)%4))}
