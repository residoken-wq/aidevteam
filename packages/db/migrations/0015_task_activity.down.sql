-- 0015_task_activity (down) — P3-07: Task activity timeline and comments.
DROP TRIGGER IF EXISTS task_comments_no_truncate ON task_comments;
DROP TRIGGER IF EXISTS task_comments_no_update_delete ON task_comments;
DROP TABLE IF EXISTS task_comments;
