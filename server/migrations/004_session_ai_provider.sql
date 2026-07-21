-- Proveedor AI por sesión (chat Planificar / Consultar). Default DeepSeek.
ALTER TABLE ai_sessions ADD COLUMN ai_provider TEXT NOT NULL DEFAULT 'deepseek';
