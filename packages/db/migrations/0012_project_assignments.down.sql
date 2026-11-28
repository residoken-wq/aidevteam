-- 0012_project_assignments (down) — P2-13.
DROP TABLE IF EXISTS project_assignments;
DELETE FROM role_bindings rb USING roles r WHERE rb.role_id = r.id AND r.key = 'project_member';
DELETE FROM roles WHERE key = 'project_member';
