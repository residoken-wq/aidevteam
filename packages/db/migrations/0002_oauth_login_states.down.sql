-- 0002_oauth_login_states (down) — drops pending login attempts only (users must restart sign-in).
DROP TABLE IF EXISTS oauth_login_states;
