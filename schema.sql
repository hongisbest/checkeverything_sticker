-- 별도 비교사이트 전용 테이블
-- 기존 vc2_* 테이블 및 기존 R2 파일은 건드리지 않습니다.

CREATE TABLE IF NOT EXISTS st_stickers (
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
);

CREATE TABLE IF NOT EXISTS st_rules (
  id INTEGER PRIMARY KEY CHECK (id=1),
  damage_normal_max REAL NOT NULL DEFAULT 10,
  damage_replace_min REAL NOT NULL DEFAULT 30,
  shape_similarity_min REAL NOT NULL DEFAULT 70,
  color_difference_max REAL NOT NULL DEFAULT 35,
  use_damage INTEGER NOT NULL DEFAULT 1,
  use_shape INTEGER NOT NULL DEFAULT 1,
  use_color INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO st_rules (
  id,damage_normal_max,damage_replace_min,shape_similarity_min,color_difference_max,
  use_damage,use_shape,use_color
) VALUES (1,10,30,70,35,1,1,1);

CREATE TABLE IF NOT EXISTS st_inspections (
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
);

CREATE INDEX IF NOT EXISTS idx_st_stickers_active ON st_stickers(group_key,is_active);
CREATE INDEX IF NOT EXISTS idx_st_insp_status ON st_inspections(status,admin_state);

CREATE TABLE IF NOT EXISTS st_analysis_cache (
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
);

CREATE TABLE IF NOT EXISTS st_examples (
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
);

CREATE INDEX IF NOT EXISTS idx_st_examples_sticker
ON st_examples(sticker_id, sort_order, id);
CREATE TABLE IF NOT EXISTS st_rule_extensions (
  id INTEGER PRIMARY KEY CHECK (id=1),
  design_similarity_min REAL NOT NULL DEFAULT 82,
  placement_similarity_min REAL NOT NULL DEFAULT 55,
  use_design INTEGER NOT NULL DEFAULT 1,
  use_placement INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO st_rule_extensions (
  id,design_similarity_min,placement_similarity_min,use_design,use_placement
) VALUES (1,82,55,1,1);

CREATE TABLE IF NOT EXISTS st_example_geometry (
  example_id INTEGER PRIMARY KEY,
  plate_x REAL,
  plate_y REAL,
  plate_width REAL,
  plate_height REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS st_example_vehicle (
  example_id INTEGER PRIMARY KEY,
  vehicle_type TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS st_example_logo (
  example_id INTEGER PRIMARY KEY,
  logo_x REAL,
  logo_y REAL,
  logo_width REAL,
  logo_height REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_st_example_vehicle_type
ON st_example_vehicle(vehicle_type);


CREATE TABLE IF NOT EXISTS st_rear_rules (
  id INTEGER PRIMARY KEY CHECK (id=1),
  rear_geometry_min REAL NOT NULL DEFAULT 62,
  rear_size_difference_max REAL NOT NULL DEFAULT 18,
  use_rear_geometry INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO st_rear_rules (
  id,rear_geometry_min,rear_size_difference_max,use_rear_geometry
) VALUES (1,62,18,1);

-- 차량/임직원 등록데이터
-- 성명·사번·부서·차량번호 4개 항목만 현재 점검에 사용합니다.
CREATE TABLE IF NOT EXISTS st_vehicle_registry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_name TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  department TEXT NOT NULL,
  vehicle_no TEXT NOT NULL,
  employee_name_key TEXT NOT NULL,
  employee_id_key TEXT NOT NULL,
  department_key TEXT NOT NULL,
  vehicle_no_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(employee_id_key,vehicle_no_key)
);

CREATE INDEX IF NOT EXISTS idx_st_vehicle_registry_department
ON st_vehicle_registry(department_key);

CREATE INDEX IF NOT EXISTS idx_st_vehicle_registry_name
ON st_vehicle_registry(employee_name_key);

CREATE INDEX IF NOT EXISTS idx_st_vehicle_registry_vehicle
ON st_vehicle_registry(vehicle_no_key);

-- 연도별 접수번호
-- 예: 2026-001, 2026-002 ... / 다음 해에는 2027-001부터 새로 시작
CREATE TABLE IF NOT EXISTS st_receipt_sequences (
  receipt_year INTEGER PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS st_inspection_receipts (
  inspection_id INTEGER PRIMARY KEY,
  receipt_year INTEGER NOT NULL,
  receipt_seq INTEGER NOT NULL,
  receipt_no TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(receipt_year, receipt_seq)
);

CREATE INDEX IF NOT EXISTS idx_st_inspection_receipts_year_seq
ON st_inspection_receipts(receipt_year, receipt_seq);


-- V42 통합 차량점검
-- 신규 점검만 1대=1접수 / 운전석·조수석·후면 3개 결과로 저장합니다.
-- 기존 st_inspections 및 기존 접수번호/사진은 그대로 보존합니다.
CREATE TABLE IF NOT EXISTS st_vehicle_inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_year INTEGER NOT NULL,
  receipt_seq INTEGER NOT NULL,
  receipt_no TEXT NOT NULL UNIQUE,
  employee_name TEXT NOT NULL,
  employee_id TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  vehicle_no TEXT NOT NULL,
  vehicle_type TEXT NOT NULL,
  overall_status TEXT NOT NULL DEFAULT '분석대기',
  admin_state TEXT NOT NULL DEFAULT '미확인',
  admin_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(receipt_year,receipt_seq)
);

CREATE TABLE IF NOT EXISTS st_vehicle_inspection_sides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id INTEGER NOT NULL,
  side TEXT NOT NULL,
  sticker_id INTEGER NOT NULL,
  photo_object_key TEXT NOT NULL UNIQUE,
  plate_x REAL NOT NULL DEFAULT 0,
  plate_y REAL NOT NULL DEFAULT 0,
  plate_width REAL NOT NULL DEFAULT 1,
  plate_height REAL NOT NULL DEFAULT 1,
  score REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '분석대기',
  findings_json TEXT NOT NULL DEFAULT '[]',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(inspection_id,side)
);

CREATE INDEX IF NOT EXISTS idx_st_vehicle_inspections_status
ON st_vehicle_inspections(overall_status,admin_state);

CREATE INDEX IF NOT EXISTS idx_st_vehicle_inspections_vehicle
ON st_vehicle_inspections(vehicle_no,created_at);

CREATE INDEX IF NOT EXISTS idx_st_vehicle_inspection_sides_parent
ON st_vehicle_inspection_sides(inspection_id,side);


-- V42.4 통합점검 전용 연도별 접수번호 시퀀스
-- 기존 개별점검(st_receipt_sequences)과 분리합니다.
-- 최초 생성 시 통합점검 기록이 없으면 다음 접수는 YYYY-001부터 시작합니다.
CREATE TABLE IF NOT EXISTS st_vehicle_receipt_sequences (
  receipt_year INTEGER PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT 0
);
