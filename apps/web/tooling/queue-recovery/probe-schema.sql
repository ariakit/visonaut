CREATE TABLE probe_deliveries(id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT,message_id TEXT,transport_attempt INTEGER,action TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE probe_dlq(id TEXT PRIMARY KEY,transport_attempt INTEGER,body_json TEXT,received_at INTEGER NOT NULL);
