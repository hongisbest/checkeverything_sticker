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
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_st_insp_status ON st_inspections(status,admin_state)"),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS st_analysis_cache (
        sticker_id INTEGER NOT NULL,
        algorithm_version TEXT NOT NULL,
        image_hash TEXT NOT NULL,
        crop_x REAL NOT NULL,
        crop_y REAL NOT NULL,
        crop_width REAL NOT NULL,
        crop_height REAL NOT NULL,
        score REAL NOT NULL,
        status TEXT NOT NULL,
        recommendation TEXT NOT NULL DEFAULT '',
        findings_json TEXT NOT NULL DEFAULT '[]',
        metrics_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (sticker_id, algorithm_version, image_hash)
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS st_examples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sticker_id INTEGER NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 1,
        object_key TEXT NOT NULL,
        content_type TEXT NOT NULL DEFAULT 'image/jpeg',
        crop_x REAL,
        crop_y REAL,
        crop_width REAL,
        crop_height REAL,
        is_guide INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_st_examples_sticker ON st_examples(sticker_id, sort_order, id)"),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS st_rule_extensions (
        id INTEGER PRIMARY KEY CHECK (id=1),
        design_similarity_min REAL NOT NULL DEFAULT 82,
        placement_similarity_min REAL NOT NULL DEFAULT 55,
        use_design INTEGER NOT NULL DEFAULT 1,
        use_placement INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`),
      env.DB.prepare(`INSERT OR IGNORE INTO st_rule_extensions(
        id,design_similarity_min,placement_similarity_min,use_design,use_placement
      ) VALUES(1,82,55,1,1)`),
env.DB.prepare(`CREATE TABLE IF NOT EXISTS st_example_geometry (
  example_id INTEGER PRIMARY KEY,
  plate_x REAL,
  plate_y REAL,
  plate_width REAL,
  plate_height REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`),

env.DB.prepare(`CREATE TABLE IF NOT EXISTS st_example_vehicle (
  example_id INTEGER PRIMARY KEY,
  vehicle_type TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`),

env.DB.prepare(
  "CREATE INDEX IF NOT EXISTS idx_st_example_vehicle_type ON st_example_vehicle(vehicle_type)"
)
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
  if (p === "/api/analysis-cache" && request.method === "GET") return getAnalysisCache(env, url);
  if (p === "/api/analysis-cache" && request.method === "POST") return saveAnalysisCache(request, env);
  if (p === "/api/inspection" && request.method === "POST") return saveInspection(request, env);

  const inspectionAnalysis = p.match(/^\/api\/inspection\/(\d+)\/analysis$/);
  if (inspectionAnalysis && request.method === "PATCH") {
    return updateSubmittedInspectionAnalysis(request, env, Number(inspectionAnalysis[1]));
  }

  const stickerImage = p.match(/^\/api\/sticker\/(\d+)\/image$/);
  if (stickerImage && request.method === "GET") {
    return getStickerImage(env, Number(stickerImage[1]));
  }

  const exampleImage = p.match(/^\/api\/example\/(\d+)\/image$/);
  if (exampleImage && request.method === "GET") {
    return getExampleImage(env, Number(exampleImage[1]));
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

  const stickerExamples = p.match(/^\/api\/admin\/stickers\/(\d+)\/examples$/);
  if (stickerExamples && request.method === "GET") return listExamples(env, Number(stickerExamples[1]));
  if (stickerExamples && request.method === "POST") return addExamples(request, env, Number(stickerExamples[1]));

const exampleRoi = p.match(/^\/api\/admin\/examples\/(\d+)\/roi$/);
if (exampleRoi && request.method === "PATCH") {
  return updateExampleRoi(request, env, Number(exampleRoi[1]));
}

const exampleVehicle = p.match(/^\/api\/admin\/examples\/(\d+)\/vehicle$/);
if (exampleVehicle && request.method === "PATCH") {
  return updateExampleVehicle(
    request,
    env,
    Number(exampleVehicle[1])
  );
}

const exampleGuide = p.match(/^\/api\/admin\/examples\/(\d+)\/guide$/);
  if (exampleGuide && request.method === "POST") return setGuideExample(env, Number(exampleGuide[1]));

  const exampleDelete = p.match(/^\/api\/admin\/examples\/(\d+)$/);
  if (exampleDelete && request.method === "DELETE") return deleteExample(env, Number(exampleDelete[1]));

  // Rules
  if (p === "/api/admin/rules" && request.method === "GET") return j({ok:true,rules:await readRules(env)});
  if (p === "/api/admin/rules" && request.method === "POST") return saveRules(request, env);

  // Results
  if (p === "/api/admin/inspections" && request.method === "GET") return listInspections(env, url);
  if (p === "/api/admin/inspections/bulk-delete" && request.method === "POST") return bulkDeleteInspections(request, env);
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
  const base=await env.DB.prepare(`
    SELECT damage_normal_max,damage_replace_min,shape_similarity_min,color_difference_max,
           use_damage,use_shape,use_color,updated_at
    FROM st_rules WHERE id=1
  `).first();

  const extra=await env.DB.prepare(`
    SELECT design_similarity_min,placement_similarity_min,
           use_design,use_placement,updated_at
    FROM st_rule_extensions WHERE id=1
  `).first();

  return{
    ...(base||{}),
    design_similarity_min:Number(extra?.design_similarity_min ?? 82),
    placement_similarity_min:Number(extra?.placement_similarity_min ?? 55),
    use_design:Number(extra?.use_design ?? 1),
    use_placement:Number(extra?.use_placement ?? 1),
    updated_at:extra?.updated_at || base?.updated_at || null
  };
}

async function getConfig(env) {
  const rows = await env.DB.prepare(`
    SELECT id,group_key,version,name,side_hint,guide_text,created_at
    FROM st_stickers
    WHERE is_active=1
    ORDER BY name ASC, id DESC
  `).all();

  const stickers=[];

  for (const r of rows.results || []) {
    const examples = await env.DB.prepare(`
SELECT e.id,e.sort_order,e.crop_x,e.crop_y,e.crop_width,e.crop_height,
       e.is_guide,e.created_at,e.updated_at,
       g.plate_x,g.plate_y,g.plate_width,g.plate_height,
       v.vehicle_type
FROM st_examples e
LEFT JOIN st_example_geometry g ON g.example_id=e.id
LEFT JOIN st_example_vehicle v ON v.example_id=e.id
WHERE e.sticker_id=?
      ORDER BY e.is_guide DESC,e.sort_order ASC,e.id ASC
    `).bind(r.id).all();

    const ex=(examples.results || []).map(x=>({
      ...x,
      image_url:`/api/example/${x.id}/image`,
      calibrated:
        x.crop_x!==null && x.crop_y!==null &&
        x.crop_width!==null && x.crop_height!==null,
      plate_calibrated:
        x.plate_x!==null && x.plate_y!==null &&
        x.plate_width!==null && x.plate_height!==null
    }));

    const guide = ex.find(x=>Number(x.is_guide)===1) || ex[0] || null;

    stickers.push({
      ...r,
      image_url:`/api/sticker/${r.id}/image`,
      examples:ex,
      guide_example:guide,
      calibrated_example_count:ex.filter(x=>x.calibrated).length,
      placement_example_count:ex.filter(x=>x.calibrated&&x.plate_calibrated).length
    });
  }

  return j({ok:true,stickers,rules:await readRules(env)});
}

async function createSticker(request, env) {
  const form = await request.formData();
  const file = form.get("file");
  const examples = form.getAll("examples").filter(x=>x && typeof x!=="string" && Number(x.size||0)>0);
  const name = txt(form.get("name"),100);
  const sideHint = txt(form.get("side_hint"),30) || "both";
  const guideText = txt(form.get("guide_text"),1000);

  if (!file || typeof file === "string") return j({ok:false,error:"정상 스티커 원본을 선택해 주세요."},400);
  if (!name) return j({ok:false,error:"스티커명을 입력해 주세요."},400);
  if (!file.type.startsWith("image/")) return j({ok:false,error:"이미지 파일만 등록할 수 있습니다."},400);
  if (file.size > 8*1024*1024) return j({ok:false,error:"스티커 원본은 8MB 이하로 등록해 주세요."},400);
  if (!examples.length) return j({ok:false,error:"정상부착 예시사진을 1장 이상 등록해 주세요."},400);
  if (examples.length > 8) return j({ok:false,error:"정상부착 예시사진은 한 번에 최대 8장까지 등록할 수 있습니다."},400);

  for (const ex of examples) {
    if (!ex.type.startsWith("image/")) return j({ok:false,error:"예시사진은 이미지 파일만 등록할 수 있습니다."},400);
    if (ex.size > 8*1024*1024) return j({ok:false,error:"예시사진은 장당 8MB 이하로 등록해 주세요."},400);
  }

  const groupKey = crypto.randomUUID();
  const masterKey = `sticker-compare/reference/${Date.now()}-${crypto.randomUUID()}.${ext(file.type)}`;
  const createdKeys=[masterKey];

  await env.STORAGE.put(masterKey,file.stream(),{
    httpMetadata:{contentType:file.type,cacheControl:"private,max-age=0"}
  });

  try {
    const inserted = await env.DB.prepare(`
      INSERT INTO st_stickers(
        group_key,version,name,side_hint,guide_text,object_key,content_type,is_active
      ) VALUES(?,1,?,?,?,?,?,1)
      RETURNING id
    `).bind(groupKey,name,sideHint,guideText,masterKey,file.type).first();

    let order=1;
    for (const ex of examples) {
      const key=`sticker-compare/examples/${Date.now()}-${crypto.randomUUID()}.${ext(ex.type)}`;
      createdKeys.push(key);

      await env.STORAGE.put(key,ex.stream(),{
        httpMetadata:{contentType:ex.type,cacheControl:"private,max-age=0"}
      });

      await env.DB.prepare(`
        INSERT INTO st_examples(
          sticker_id,sort_order,object_key,content_type,is_guide
        ) VALUES(?,?,?,?,?)
      `).bind(inserted.id,order,key,ex.type,order===1?1:0).run();

      order++;
    }

    return j({
      ok:true,
      id:inserted?.id,
      message:"스티커 원본과 정상부착 예시사진을 등록했습니다. 예시사진의 스티커 영역을 지정해 주세요."
    });
  } catch (e) {
    for (const key of createdKeys) {
      try { await env.STORAGE.delete(key); } catch {}
    }
    throw e;
  }
}

async function listStickers(env) {
  const rows = await env.DB.prepare(`
    SELECT s.id,s.group_key,s.version,s.name,s.side_hint,s.guide_text,s.is_active,s.created_at,
           (SELECT COUNT(*) FROM st_inspections i WHERE i.sticker_id=s.id) usage_count,
           (SELECT COUNT(*) FROM st_stickers h WHERE h.group_key=s.group_key) version_count,
           (SELECT COUNT(*) FROM st_examples e WHERE e.sticker_id=s.id) example_count,
           (SELECT COUNT(*) FROM st_examples e
             WHERE e.sticker_id=s.id
               AND e.crop_x IS NOT NULL AND e.crop_y IS NOT NULL
               AND e.crop_width IS NOT NULL AND e.crop_height IS NOT NULL) calibrated_count
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

      await env.DB.prepare(`
        INSERT INTO st_examples(
          sticker_id,sort_order,object_key,content_type,
          crop_x,crop_y,crop_width,crop_height,is_guide
        )
        SELECT ?,sort_order,object_key,content_type,
               crop_x,crop_y,crop_width,crop_height,is_guide
        FROM st_examples
        WHERE sticker_id=?
      `).bind(inserted.id,id).run();

      await env.DB.prepare(`
        INSERT OR REPLACE INTO st_example_geometry(
          example_id,plate_x,plate_y,plate_width,plate_height,updated_at
        )
        SELECT ne.id,g.plate_x,g.plate_y,g.plate_width,g.plate_height,datetime('now')
        FROM st_examples ne
        JOIN st_examples oe
          ON oe.sticker_id=? AND oe.sort_order=ne.sort_order
        JOIN st_example_geometry g
          ON g.example_id=oe.id
        WHERE ne.sticker_id=?
      `).bind(id,inserted.id).run();

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

    if (hasFile) {
      await env.DB.prepare("DELETE FROM st_analysis_cache WHERE sticker_id=?").bind(id).run();
    }

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

  const examples = await env.DB.prepare(
    "SELECT id,object_key FROM st_examples WHERE sticker_id=?"
  ).bind(id).all();

  for (const ex of examples.results || []) {
    await env.DB.prepare("DELETE FROM st_example_geometry WHERE example_id=?").bind(ex.id).run();
    await env.DB.prepare("DELETE FROM st_examples WHERE id=?").bind(ex.id).run();

    const refs = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM st_examples WHERE object_key=?"
    ).bind(ex.object_key).first();

    if (Number(refs?.c || 0)===0) {
      await env.STORAGE.delete(ex.object_key);
    }
  }

  await env.STORAGE.delete(row.object_key);
  await env.DB.prepare("DELETE FROM st_analysis_cache WHERE sticker_id=?").bind(id).run();
  await env.DB.prepare("DELETE FROM st_stickers WHERE id=?").bind(id).run();

  return j({ok:true});
}


async function listExamples(env, stickerId) {
  const sticker = await env.DB.prepare("SELECT id,name FROM st_stickers WHERE id=?")
    .bind(stickerId).first();

  if (!sticker) return j({ok:false,error:"스티커를 찾을 수 없습니다."},404);

  const rows = await env.DB.prepare(`
    SELECT e.id,e.sort_order,e.crop_x,e.crop_y,e.crop_width,e.crop_height,
           e.is_guide,e.created_at,e.updated_at,
           g.plate_x,g.plate_y,g.plate_width,g.plate_height
    FROM st_examples e
    LEFT JOIN st_example_geometry g ON g.example_id=e.id
    WHERE e.sticker_id=?
    ORDER BY e.is_guide DESC,e.sort_order ASC,e.id ASC
  `).bind(stickerId).all();

  return j({
    ok:true,
    sticker,
    items:(rows.results || []).map(x=>({
      ...x,
      image_url:`/api/example/${x.id}/image`,
      calibrated:
        x.crop_x!==null && x.crop_y!==null &&
        x.crop_width!==null && x.crop_height!==null,
      plate_calibrated:
        x.plate_x!==null && x.plate_y!==null &&
        x.plate_width!==null && x.plate_height!==null
    }))
  });
}

async function addExamples(request, env, stickerId) {
  const sticker = await env.DB.prepare("SELECT id FROM st_stickers WHERE id=?")
    .bind(stickerId).first();

  if (!sticker) return j({ok:false,error:"스티커를 찾을 수 없습니다."},404);

  const form=await request.formData();
  const files=form.getAll("files").filter(x=>x && typeof x!=="string" && Number(x.size||0)>0);

  if (!files.length) return j({ok:false,error:"추가할 예시사진을 선택해 주세요."},400);
  if (files.length>8) return j({ok:false,error:"한 번에 최대 8장까지 추가할 수 있습니다."},400);

  const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM st_examples WHERE sticker_id=?")
    .bind(stickerId).first();

  let order=Number(count?.c || 0)+1;
  let hasGuide=Number((await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM st_examples WHERE sticker_id=? AND is_guide=1"
  ).bind(stickerId).first())?.c || 0)>0;

  const created=[];

  try {
    for (const file of files) {
      if (!file.type.startsWith("image/")) throw new Error("예시사진은 이미지 파일만 등록할 수 있습니다.");
      if (file.size>8*1024*1024) throw new Error("예시사진은 장당 8MB 이하로 등록해 주세요.");

      const key=`sticker-compare/examples/${Date.now()}-${crypto.randomUUID()}.${ext(file.type)}`;

      await env.STORAGE.put(key,file.stream(),{
        httpMetadata:{contentType:file.type,cacheControl:"private,max-age=0"}
      });

      created.push(key);

      await env.DB.prepare(`
        INSERT INTO st_examples(
          sticker_id,sort_order,object_key,content_type,is_guide
        ) VALUES(?,?,?,?,?)
      `).bind(stickerId,order,key,file.type,hasGuide?0:1).run();

      hasGuide=true;
      order++;
    }

    await env.DB.prepare("DELETE FROM st_analysis_cache WHERE sticker_id=?").bind(stickerId).run();
    return j({ok:true});
  } catch (e) {
    for (const key of created) {
      try { await env.STORAGE.delete(key); } catch {}
    }
    return j({ok:false,error:e.message||"예시사진 등록에 실패했습니다."},400);
  }
}

async function updateExampleRoi(request, env, exampleId) {
  const body=await request.json().catch(()=>({}));
  const kind=body.kind==="plate" ? "plate" : "sticker";
  const x=Number(body.x),y=Number(body.y),w=Number(body.width),h=Number(body.height);

  if (![x,y,w,h].every(Number.isFinite) || x<0 || y<0 || w<.01 || h<.01 ||
      x+w>1.0001 || y+h>1.0001) {
    return j({ok:false,error:`${kind==="plate"?"번호판":"스티커"} 영역 좌표가 올바르지 않습니다.`},400);
  }

  const ex=await env.DB.prepare("SELECT id,sticker_id FROM st_examples WHERE id=?")
    .bind(exampleId).first();

  if (!ex) return j({ok:false,error:"예시사진을 찾을 수 없습니다."},404);

  if(kind==="plate"){
    await env.DB.prepare(`
      INSERT INTO st_example_geometry(
        example_id,plate_x,plate_y,plate_width,plate_height,updated_at
      ) VALUES(?,?,?,?,?,datetime('now'))
      ON CONFLICT(example_id) DO UPDATE SET
        plate_x=excluded.plate_x,
        plate_y=excluded.plate_y,
        plate_width=excluded.plate_width,
        plate_height=excluded.plate_height,
        updated_at=datetime('now')
    `).bind(exampleId,x,y,w,h).run();
  }else{
    await env.DB.prepare(`
      UPDATE st_examples
      SET crop_x=?,crop_y=?,crop_width=?,crop_height=?,updated_at=datetime('now')
      WHERE id=?
    `).bind(x,y,w,h,exampleId).run();
  }

  await env.DB.prepare("DELETE FROM st_analysis_cache WHERE sticker_id=?").bind(ex.sticker_id).run();

  return j({ok:true,kind});
}

async function setGuideExample(env, exampleId) {
  const ex=await env.DB.prepare("SELECT id,sticker_id FROM st_examples WHERE id=?")
    .bind(exampleId).first();

  if (!ex) return j({ok:false,error:"예시사진을 찾을 수 없습니다."},404);

  await env.DB.batch([
    env.DB.prepare("UPDATE st_examples SET is_guide=0 WHERE sticker_id=?").bind(ex.sticker_id),
    env.DB.prepare("UPDATE st_examples SET is_guide=1,sort_order=1,updated_at=datetime('now') WHERE id=?").bind(exampleId)
  ]);

  return j({ok:true});
}

async function deleteExample(env, exampleId) {
  const ex=await env.DB.prepare(`
    SELECT id,sticker_id,object_key,is_guide
    FROM st_examples WHERE id=?
  `).bind(exampleId).first();

  if (!ex) return j({ok:false,error:"예시사진을 찾을 수 없습니다."},404);

  const count=await env.DB.prepare("SELECT COUNT(*) AS c FROM st_examples WHERE sticker_id=?")
    .bind(ex.sticker_id).first();

  if (Number(count?.c || 0)<=1) {
    return j({ok:false,error:"정상부착 예시사진은 최소 1장을 유지해야 합니다."},409);
  }

  await env.DB.prepare("DELETE FROM st_example_geometry WHERE example_id=?").bind(exampleId).run();
  await env.DB.prepare("DELETE FROM st_examples WHERE id=?").bind(exampleId).run();

  if (Number(ex.is_guide)===1) {
    const next=await env.DB.prepare(`
      SELECT id FROM st_examples WHERE sticker_id=?
      ORDER BY sort_order ASC,id ASC LIMIT 1
    `).bind(ex.sticker_id).first();

    if (next) {
      await env.DB.prepare("UPDATE st_examples SET is_guide=1,sort_order=1 WHERE id=?")
        .bind(next.id).run();
    }
  }

  const refs=await env.DB.prepare("SELECT COUNT(*) AS c FROM st_examples WHERE object_key=?")
    .bind(ex.object_key).first();

  if (Number(refs?.c || 0)===0) await env.STORAGE.delete(ex.object_key);

  await env.DB.prepare("DELETE FROM st_analysis_cache WHERE sticker_id=?").bind(ex.sticker_id).run();

  return j({ok:true});
}

async function getExampleImage(env, id) {
  const row = await env.DB.prepare(`
    SELECT object_key,content_type FROM st_examples WHERE id=?
  `).bind(id).first();

  if (!row) return new Response("Not Found",{status:404});

  const object = await env.STORAGE.get(row.object_key);
  if (!object) return new Response("Not Found",{status:404});

  const h=new Headers();
  object.writeHttpMetadata(h);
  h.set("content-type",row.content_type || "image/jpeg");
  h.set("cache-control","private,max-age=180");

  return new Response(object.body,{headers:h});
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
  const designMin = Number(body.design_similarity_min ?? 82);
  const placementMin = Number(body.placement_similarity_min ?? 55);

  if (![damageNormal,damageReplace,shapeMin,colorMax,designMin,placementMin].every(Number.isFinite)) {
    return j({ok:false,error:"판정기준 값이 올바르지 않습니다."},400);
  }

  if (
    damageNormal < 0 || damageNormal > 100 ||
    damageReplace < 0 || damageReplace > 100 ||
    shapeMin < 0 || shapeMin > 100 ||
    designMin < 0 || designMin > 100 ||
    placementMin < 0 || placementMin > 100 ||
    colorMax < 0 || colorMax > 255
  ) {
    return j({ok:false,error:"판정기준 값의 허용범위를 확인해 주세요."},400);
  }

  if (damageReplace <= damageNormal) {
    return j({ok:false,error:"교체권고 손상률은 정상 허용 손상률보다 커야 합니다."},400);
  }

  await env.DB.batch([
    env.DB.prepare(`
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
    ),
    env.DB.prepare(`
      INSERT INTO st_rule_extensions(
        id,design_similarity_min,placement_similarity_min,
        use_design,use_placement,updated_at
      ) VALUES(1,?,?,?,?,datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        design_similarity_min=excluded.design_similarity_min,
        placement_similarity_min=excluded.placement_similarity_min,
        use_design=excluded.use_design,
        use_placement=excluded.use_placement,
        updated_at=datetime('now')
    `).bind(
      designMin,placementMin,
      body.use_design ? 1 : 0,
      body.use_placement ? 1 : 0
    )
  ]);

  return j({ok:true,rules:await readRules(env)});
}


async function getAnalysisCache(env, url) {
  const stickerId = Number(url.searchParams.get("sticker_id"));
  const algorithmVersion = txt(url.searchParams.get("algorithm_version"),40);
  const imageHash = txt(url.searchParams.get("image_hash"),100);

  if (!stickerId || !algorithmVersion || !imageHash) {
    return j({ok:false,error:"캐시 조회정보가 올바르지 않습니다."},400);
  }

  const row = await env.DB.prepare(`
    SELECT crop_x,crop_y,crop_width,crop_height,
           score,status,recommendation,findings_json,metrics_json,created_at
    FROM st_analysis_cache
    WHERE sticker_id=? AND algorithm_version=? AND image_hash=?
  `).bind(stickerId,algorithmVersion,imageHash).first();

  if (!row) return j({ok:true,hit:false});

  let findings=[];
  let metrics={};

  try { findings=JSON.parse(row.findings_json||"[]"); } catch {}
  try { metrics=JSON.parse(row.metrics_json||"{}"); } catch {}

  return j({
    ok:true,
    hit:true,
    result:{
      score:Number(row.score),
      status:row.status,
      recommendation:row.recommendation||"",
      findings,
      metrics,
      crop:{
        x:Number(row.crop_x),
        y:Number(row.crop_y),
        width:Number(row.crop_width),
        height:Number(row.crop_height)
      },
      cached_at:row.created_at
    }
  });
}

async function saveAnalysisCache(request, env) {
  const body = await request.json().catch(()=>({}));

  const stickerId=Number(body.sticker_id);
  const algorithmVersion=txt(body.algorithm_version,40);
  const imageHash=txt(body.image_hash,100);
  const crop=body.crop||{};
  const result=body.result||{};

  if (!stickerId || !algorithmVersion || !imageHash) {
    return j({ok:false,error:"캐시 저장정보가 올바르지 않습니다."},400);
  }

  const x=Number(crop.x),y=Number(crop.y),w=Number(crop.width),h=Number(crop.height);

  if (![x,y,w,h].every(Number.isFinite) || x<0 || y<0 || w<=0 || h<=0 ||
      x+w>1.0001 || y+h>1.0001) {
    return j({ok:false,error:"분석영역 좌표가 올바르지 않습니다."},400);
  }

  const score=Math.max(0,Math.min(100,Number(result.score)||0));
  const status=result.status==="정상" ? "정상" : "확인필요";

  await env.DB.prepare(`
    INSERT OR IGNORE INTO st_analysis_cache(
      sticker_id,algorithm_version,image_hash,
      crop_x,crop_y,crop_width,crop_height,
      score,status,recommendation,findings_json,metrics_json
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    stickerId,algorithmVersion,imageHash,
    x,y,w,h,
    score,status,txt(result.recommendation,50),
    JSON.stringify(Array.isArray(result.findings)?result.findings.slice(0,30):[]),
    JSON.stringify(result.metrics&&typeof result.metrics==="object"?result.metrics:{})
  ).run();

  return j({ok:true});
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

  try {
    await env.STORAGE.put(key,file.stream(),{
      httpMetadata:{contentType:file.type || "image/jpeg"}
    });
  } catch (e) {
    console.error("inspection R2 upload failed",e);
    return j({
      ok:false,
      error:"점검사진 저장소 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요."
    },500);
  }

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
      meta.status==="정상"
        ? "정상"
        : (meta.status==="판정불가"
            ? "판정불가"
            : (meta.status==="분석대기" ? "분석대기" : "확인필요")),
      JSON.stringify(Array.isArray(meta.findings) ? meta.findings.slice(0,30) : []),
      JSON.stringify(meta.metrics && typeof meta.metrics==="object" ? meta.metrics : {})
    ).first();

    let analysisToken="";
    if (inserted?.id && env.ADMIN_SESSION_SECRET) {
      analysisToken=await sign(
        `inspection-analysis:${inserted.id}:${key}`,
        env.ADMIN_SESSION_SECRET
      );
    }

    return j({
      ok:true,
      id:inserted?.id,
      analysis_token:analysisToken
    });
  } catch (e) {
    console.error("inspection D1 insert failed",e);

    try{
      await env.STORAGE.delete(key);
    }catch(cleanupError){
      console.error("inspection R2 cleanup failed",cleanupError);
    }

    return j({
      ok:false,
      error:"점검정보 저장에 실패했습니다. 잠시 후 다시 시도해 주세요."
    },500);
  }
}


async function updateSubmittedInspectionAnalysis(request, env, id) {
  if (!Number.isInteger(id) || id<=0) {
    return j({ok:false,error:"점검번호가 올바르지 않습니다."},400);
  }

  if (!env.ADMIN_SESSION_SECRET) {
    return j({ok:false,error:"분석결과 저장용 Secret이 설정되지 않았습니다."},503);
  }

  const row=await env.DB.prepare(`
    SELECT id,photo_object_key
    FROM st_inspections
    WHERE id=?
  `).bind(id).first();

  if (!row) return j({ok:false,error:"점검결과를 찾을 수 없습니다."},404);

  const token=String(request.headers.get("x-analysis-token") || "");
  const expected=await sign(
    `inspection-analysis:${id}:${row.photo_object_key}`,
    env.ADMIN_SESSION_SECRET
  );

  if (!token || !safeEqual(token,expected)) {
    return j({ok:false,error:"분석결과 저장 권한이 없습니다."},403);
  }

  const body=await request.json().catch(()=>({}));
  const status=["정상","확인필요","판정불가"].includes(body.status)
    ? body.status
    : "판정불가";

  const score=Math.max(0,Math.min(100,Number(body.score)||0));
  const findings=Array.isArray(body.findings) ? body.findings.slice(0,30) : [];
  const metrics=body.metrics && typeof body.metrics==="object" ? body.metrics : {};

  await env.DB.prepare(`
    UPDATE st_inspections
    SET score=?,status=?,findings_json=?,metrics_json=?
    WHERE id=?
  `).bind(
    score,
    status,
    JSON.stringify(findings),
    JSON.stringify(metrics),
    id
  ).run();

  return j({ok:true,id,status});
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


async function bulkDeleteInspections(request, env) {
  const body = await request.json().catch(()=>({}));
  const rawIds = Array.isArray(body.ids) ? body.ids : [];

  const ids = [...new Set(
    rawIds
      .map(Number)
      .filter(x=>Number.isInteger(x) && x>0)
  )];

  if (!ids.length) {
    return j({ok:false,error:"삭제할 점검결과를 선택해 주세요."},400);
  }

  if (ids.length > 500) {
    return j({ok:false,error:"한 번에 최대 500건까지 삭제할 수 있습니다."},400);
  }

  const placeholders = ids.map(()=>"?").join(",");

  const rows = await env.DB.prepare(`
    SELECT id,photo_object_key
    FROM st_inspections
    WHERE id IN (${placeholders})
  `).bind(...ids).all();

  const found = rows.results || [];

  if (!found.length) {
    return j({ok:false,error:"삭제할 점검결과를 찾을 수 없습니다."},404);
  }

  // Delete DB records first in a single D1 statement.
  // If an R2 object cleanup fails afterwards, the user-visible inspection
  // record is still removed and orphan cleanup can be retried later.
  await env.DB.prepare(`
    DELETE FROM st_inspections
    WHERE id IN (${placeholders})
  `).bind(...ids).run();

  let deletedImages=0;
  let imageDeleteFailed=0;

  for (const row of found) {
    if (!row.photo_object_key) continue;

    try {
      await env.STORAGE.delete(row.photo_object_key);
      deletedImages++;
    } catch (e) {
      console.error("inspection image delete failed", row.id, row.photo_object_key, e);
      imageDeleteFailed++;
    }
  }

  return j({
    ok:true,
    deleted:found.length,
    deleted_images:deletedImages,
    image_delete_failed:imageDeleteFailed
  });
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
