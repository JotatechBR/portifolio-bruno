-- Pagamento (Cakto), direitos de acesso e vínculo com o Telegram.
-- Incremental: só cria o que não existe. Datas em UTC (DATETIME(3)). Dinheiro em centavos inteiros.
-- IDs do Telegram em BIGINT (grupos são negativos; usuários cabem em 52 bits).

CREATE TABLE IF NOT EXISTS orders (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cakto_order_id   VARCHAR(64)  NOT NULL,
  product_id       VARCHAR(64)  NOT NULL,
  offer_id         VARCHAR(64)  NULL,
  product_name     VARCHAR(160) NULL,
  email            VARCHAR(254) NOT NULL,
  status           VARCHAR(32)  NOT NULL,
  amount_cents     BIGINT       NULL,
  paid_at          DATETIME(3)  NULL,
  -- confirmado na API da Cakto (consulta do pedido) antes de qualquer concessão
  verified_at      DATETIME(3)  NULL,
  -- reembolso/chargeback: definitivo, nenhum evento posterior reativa
  revoked_at       DATETIME(3)  NULL,
  revoked_reason   VARCHAR(32)  NULL,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_cakto (cakto_order_id),
  KEY ix_orders_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS inbound_events (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source         VARCHAR(16)  NOT NULL,          -- cakto | telegram
  dedupe_key     VARCHAR(191) NOT NULL,
  event_type     VARCHAR(64)  NOT NULL,
  external_ref   VARCHAR(64)  NULL,              -- ID do pedido ou update_id
  payload        JSON         NOT NULL,          -- só os campos necessários, validados
  status         VARCHAR(16)  NOT NULL DEFAULT 'received', -- received | processed | ignored | failed
  error          VARCHAR(500) NULL,
  received_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processed_at   DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_events_dedupe (dedupe_key),
  KEY ix_events_ref (source, external_ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS entitlements (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id        BIGINT UNSIGNED NOT NULL,
  group_id        BIGINT       NOT NULL,
  status          VARCHAR(16)  NOT NULL,          -- active | revoked | expired
  starts_at       DATETIME(3)  NOT NULL,
  ends_at         DATETIME(3)  NULL,              -- NULL somente com ACCESS_POLICY=lifetime
  revoke_reason   VARCHAR(32)  NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_entitlement_order (order_id),
  KEY ix_entitlement_group (group_id, status, ends_at),
  CONSTRAINT fk_entitlement_order FOREIGN KEY (order_id) REFERENCES orders (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS email_challenges (
  id              CHAR(32)     NOT NULL,          -- aleatório (hex)
  email           VARCHAR(254) NOT NULL,
  code_hash       CHAR(64)     NOT NULL,          -- HMAC-SHA256; o código legível nunca é gravado
  deliverable     TINYINT(1)   NOT NULL,          -- existe compra conhecida para o e-mail
  attempts        INT          NOT NULL DEFAULT 0,
  expires_at      DATETIME(3)  NOT NULL,
  consumed_at     DATETIME(3)  NULL,
  superseded_at   DATETIME(3)  NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_challenges_email (email, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket        VARCHAR(191) NOT NULL,
  window_start  DATETIME     NOT NULL,
  hits          INT          NOT NULL,
  PRIMARY KEY (bucket, window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS access_sessions (
  id_hash      CHAR(64)     NOT NULL,             -- SHA-256 do identificador do cookie
  email        VARCHAR(254) NOT NULL,
  expires_at   DATETIME(3)  NOT NULL,
  revoked_at   DATETIME(3)  NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id_hash),
  KEY ix_sessions_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  token_hash          CHAR(64)     NOT NULL,
  order_id            BIGINT UNSIGNED NOT NULL,
  expires_at          DATETIME(3)  NOT NULL,
  consumed_at         DATETIME(3)  NULL,
  consumed_by         BIGINT       NULL,          -- telegram_user_id
  superseded_at       DATETIME(3)  NULL,
  created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_link_token (token_hash),
  KEY ix_link_token_order (order_id),
  CONSTRAINT fk_link_token_order FOREIGN KEY (order_id) REFERENCES orders (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS telegram_links (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id          BIGINT UNSIGNED NOT NULL,
  telegram_user_id  BIGINT       NOT NULL,
  linked_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  joined_at         DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_link_order (order_id),             -- uma conta por compra
  KEY ix_link_user (telegram_user_id),
  CONSTRAINT fk_link_order FOREIGN KEY (order_id) REFERENCES orders (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS telegram_invites (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name              VARCHAR(32)  NOT NULL,          -- nome do convite (identifica o registro)
  order_id          BIGINT UNSIGNED NOT NULL,
  group_id          BIGINT       NOT NULL,
  telegram_user_id  BIGINT       NOT NULL,          -- única conta autorizada por este convite
  invite_link       VARCHAR(255) NULL,
  status            VARCHAR(16)  NOT NULL,          -- creating | open | used | revoked
  expires_at        DATETIME(3)  NOT NULL,
  created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_invite_name (name),
  UNIQUE KEY uq_invite_link (invite_link),
  KEY ix_invite_user (telegram_user_id, group_id, status),
  CONSTRAINT fk_invite_order FOREIGN KEY (order_id) REFERENCES orders (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS jobs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  type          VARCHAR(48)  NOT NULL,
  payload       JSON         NOT NULL,
  dedupe_key    VARCHAR(191) NULL,
  status        VARCHAR(16)  NOT NULL DEFAULT 'pending', -- pending | running | done | failed
  attempts      INT          NOT NULL DEFAULT 0,
  max_attempts  INT          NOT NULL DEFAULT 12,
  run_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  locked_until  DATETIME(3)  NULL,
  locked_by     VARCHAR(64)  NULL,
  last_error    VARCHAR(500) NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_jobs_dedupe (dedupe_key),
  KEY ix_jobs_due (status, run_at),
  KEY ix_jobs_lease (status, locked_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
