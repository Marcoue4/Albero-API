IF OBJECT_ID(N'dbo.Albero_Discount_Rules', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Albero_Discount_Rules (
    id nvarchar(120) NOT NULL,
    sort_order int NOT NULL,
    rule_json nvarchar(max) NOT NULL,
    trigger_type nvarchar(20) NOT NULL,
    is_active bit NOT NULL,
    priority int NOT NULL CONSTRAINT DF_Albero_Discount_Rules_priority DEFAULT 0,
    updated_at datetime2(3) NOT NULL CONSTRAINT DF_Albero_Discount_Rules_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Albero_Discount_Rules PRIMARY KEY CLUSTERED (id),
    CONSTRAINT CK_Albero_Discount_Rules_json CHECK (ISJSON(rule_json) = 1)
  );
END

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'IX_Albero_Discount_Rules_sort_order'
    AND object_id = OBJECT_ID(N'dbo.Albero_Discount_Rules', N'U')
)
BEGIN
  CREATE INDEX IX_Albero_Discount_Rules_sort_order
    ON dbo.Albero_Discount_Rules(sort_order, id);
END

IF OBJECT_ID(N'dbo.Albero_Coupon_Redemptions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Albero_Coupon_Redemptions (
    id nvarchar(160) NOT NULL,
    rule_id nvarchar(120) NOT NULL,
    code nvarchar(80) NOT NULL,
    order_id nvarchar(80) NOT NULL,
    redeemed_at datetime2(3) NOT NULL CONSTRAINT DF_Albero_Coupon_Redemptions_redeemed_at DEFAULT SYSUTCDATETIME(),
    amount decimal(12, 2) NOT NULL CONSTRAINT DF_Albero_Coupon_Redemptions_amount DEFAULT 0,
    customer_email nvarchar(320) NULL,
    user_id nvarchar(120) NULL,
    CONSTRAINT PK_Albero_Coupon_Redemptions PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UQ_Albero_Coupon_Redemptions_rule_order UNIQUE (rule_id, order_id)
  );
END

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'IX_Albero_Coupon_Redemptions_rule_id'
    AND object_id = OBJECT_ID(N'dbo.Albero_Coupon_Redemptions', N'U')
)
BEGIN
  CREATE INDEX IX_Albero_Coupon_Redemptions_rule_id
    ON dbo.Albero_Coupon_Redemptions(rule_id);
END

IF OBJECT_ID(N'dbo.Albero_Admin_Audit_Log', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Albero_Admin_Audit_Log (
    id bigint IDENTITY(1,1) NOT NULL,
    action nvarchar(120) NOT NULL,
    status nvarchar(20) NOT NULL,
    entity nvarchar(120) NOT NULL,
    entity_id nvarchar(160) NULL,
    previous_revision nvarchar(80) NULL,
    next_revision nvarchar(80) NULL,
    detail_json nvarchar(max) NULL,
    created_at datetime2(3) NOT NULL CONSTRAINT DF_Albero_Admin_Audit_Log_created_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Albero_Admin_Audit_Log PRIMARY KEY CLUSTERED (id),
    CONSTRAINT CK_Albero_Admin_Audit_Log_detail_json CHECK (detail_json IS NULL OR ISJSON(detail_json) = 1)
  );
END

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'IX_Albero_Admin_Audit_Log_created_at'
    AND object_id = OBJECT_ID(N'dbo.Albero_Admin_Audit_Log', N'U')
)
BEGIN
  CREATE INDEX IX_Albero_Admin_Audit_Log_created_at
    ON dbo.Albero_Admin_Audit_Log(created_at DESC);
END

IF OBJECT_ID(N'dbo.Albero_Runtime_Documents', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Albero_Runtime_Documents (
    doc_key nvarchar(120) NOT NULL,
    document_json nvarchar(max) NOT NULL,
    revision nvarchar(80) NULL,
    updated_at datetime2(3) NOT NULL CONSTRAINT DF_Albero_Runtime_Documents_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Albero_Runtime_Documents PRIMARY KEY CLUSTERED (doc_key),
    CONSTRAINT CK_Albero_Runtime_Documents_json CHECK (ISJSON(document_json) = 1)
  );
END

-- If the installer is run by a different SQL login, grant these to the API login:
-- GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Albero_Discount_Rules TO [your_api_user];
-- GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Albero_Coupon_Redemptions TO [your_api_user];
-- GRANT INSERT ON dbo.Albero_Admin_Audit_Log TO [your_api_user];
-- GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Albero_Runtime_Documents TO [your_api_user];
