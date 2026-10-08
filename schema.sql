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
