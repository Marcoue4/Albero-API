IF OBJECT_ID(N'dbo.Albero_Orders', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Albero_Orders (
    id nvarchar(80) NOT NULL,
    created_at datetime2(3) NOT NULL,
    updated_at datetime2(3) NOT NULL,
    status nvarchar(20) NOT NULL,
    payment_intent_id nvarchar(255) NULL,
    payment_status nvarchar(40) NULL,
    customer_first_name nvarchar(120) NOT NULL,
    customer_last_name nvarchar(120) NOT NULL,
    customer_email nvarchar(320) NOT NULL,
    customer_phone nvarchar(80) NULL,
    shipping_line1 nvarchar(300) NOT NULL,
    shipping_city nvarchar(160) NOT NULL,
    shipping_postal_code nvarchar(20) NOT NULL,
    shipping_province nvarchar(20) NOT NULL,
    shipping_country nvarchar(2) NOT NULL CONSTRAINT DF_Albero_Orders_shipping_country DEFAULT N'IT',
    subtotal decimal(12, 2) NOT NULL,
    discount decimal(12, 2) NOT NULL CONSTRAINT DF_Albero_Orders_discount DEFAULT 0,
    shipping decimal(12, 2) NOT NULL CONSTRAINT DF_Albero_Orders_shipping DEFAULT 0,
    shipping_discount decimal(12, 2) NOT NULL CONSTRAINT DF_Albero_Orders_shipping_discount DEFAULT 0,
    island_surcharge decimal(12, 2) NOT NULL CONSTRAINT DF_Albero_Orders_island_surcharge DEFAULT 0,
    total decimal(12, 2) NOT NULL,
    currency char(3) NOT NULL CONSTRAINT DF_Albero_Orders_currency DEFAULT 'EUR',
    applied_discounts_json nvarchar(max) NOT NULL CONSTRAINT DF_Albero_Orders_discounts DEFAULT N'[]',
    coupon_json nvarchar(max) NULL,
    CONSTRAINT PK_Albero_Orders PRIMARY KEY CLUSTERED (id),
    CONSTRAINT CK_Albero_Orders_status CHECK (status IN (N'received', N'processing', N'completed', N'failed')),
    CONSTRAINT CK_Albero_Orders_currency CHECK (currency = 'EUR'),
    CONSTRAINT CK_Albero_Orders_discounts_json CHECK (ISJSON(applied_discounts_json) = 1),
    CONSTRAINT CK_Albero_Orders_coupon_json CHECK (coupon_json IS NULL OR ISJSON(coupon_json) = 1)
  );
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'UX_Albero_Orders_payment_intent_id'
    AND object_id = OBJECT_ID(N'dbo.Albero_Orders', N'U')
)
BEGIN
  CREATE UNIQUE INDEX UX_Albero_Orders_payment_intent_id
    ON dbo.Albero_Orders(payment_intent_id)
    WHERE payment_intent_id IS NOT NULL;
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_Albero_Orders_created_at'
    AND object_id = OBJECT_ID(N'dbo.Albero_Orders', N'U')
)
BEGIN
  CREATE INDEX IX_Albero_Orders_created_at
    ON dbo.Albero_Orders(created_at DESC);
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_Albero_Orders_status_created_at'
    AND object_id = OBJECT_ID(N'dbo.Albero_Orders', N'U')
)
BEGIN
  CREATE INDEX IX_Albero_Orders_status_created_at
    ON dbo.Albero_Orders(status, created_at DESC);
END

IF OBJECT_ID(N'dbo.Albero_Order_Items', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Albero_Order_Items (
    order_id nvarchar(80) NOT NULL,
    line_number int NOT NULL,
    product_id nvarchar(120) NOT NULL,
    sku nvarchar(160) NULL,
    name nvarchar(300) NOT NULL,
    image nvarchar(2048) NOT NULL CONSTRAINT DF_Albero_Order_Items_image DEFAULT N'',
    size nvarchar(80) NOT NULL,
    quantity int NOT NULL,
    unit_price decimal(12, 2) NOT NULL,
    base_unit_price decimal(12, 2) NOT NULL,
    final_unit_price decimal(12, 2) NOT NULL,
    line_subtotal decimal(12, 2) NOT NULL,
    line_discount_total decimal(12, 2) NOT NULL CONSTRAINT DF_Albero_Order_Items_discount DEFAULT 0,
    line_total decimal(12, 2) NOT NULL,
    applied_discounts_json nvarchar(max) NOT NULL CONSTRAINT DF_Albero_Order_Items_discounts DEFAULT N'[]',
    CONSTRAINT PK_Albero_Order_Items PRIMARY KEY CLUSTERED (order_id, line_number),
    CONSTRAINT FK_Albero_Order_Items_order FOREIGN KEY (order_id)
      REFERENCES dbo.Albero_Orders(id) ON DELETE CASCADE,
    CONSTRAINT CK_Albero_Order_Items_quantity CHECK (quantity > 0),
    CONSTRAINT CK_Albero_Order_Items_discounts_json CHECK (ISJSON(applied_discounts_json) = 1)
  );
END

-- If the installer is run by a different SQL login, grant these to the API login:
-- GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Albero_Orders TO [your_api_user];
-- GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Albero_Order_Items TO [your_api_user];
