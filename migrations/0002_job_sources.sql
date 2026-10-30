-- Source task lookups use an indexed projection instead of scanning active job JSON.
CREATE INDEX IF NOT EXISTS jobs_sources ON jobs(json_extract(descriptor_json,'$.source_id')) WHERE status IN ('queued','running');
