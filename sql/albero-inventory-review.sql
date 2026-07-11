SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'dbo.Albero_Inventory_Review', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Albero_Inventory_Review (
    id uniqueidentifier NOT NULL,
    idempotency_key nvarchar(120) NOT NULL,
    product_id nvarchar(80) NOT NULL,
    product_name nvarchar(300) NULL,
    product_brand nvarchar(200) NULL,
    product_image nvarchar(2000) NULL,
    variant_id int NOT NULL,
    sku nvarchar(180) NOT NULL,
    size_label nvarchar(50) NOT NULL,
    size_row_id int NOT NULL,
    quantity int NOT NULL,
    source_store_id int NOT NULL,
    source_store_name nvarchar(250) NOT NULL,
    reason_code nvarchar(40) NOT NULL,
    notes nvarchar(1000) NULL,
    status nvarchar(20) NOT NULL,
    created_by nvarchar(120) NOT NULL,
    created_at datetime2(3) NOT NULL CONSTRAINT DF_Albero_Inventory_Review_created_at DEFAULT SYSUTCDATETIME(),
    resolved_by nvarchar(120) NULL,
    resolved_at datetime2(3) NULL,
    source_header_id int NOT NULL,
    destination_header_id int NOT NULL,
    resolution_source_header_id int NULL,
    resolution_destination_header_id int NULL,
    CONSTRAINT PK_Albero_Inventory_Review PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UQ_Albero_Inventory_Review_idempotency UNIQUE (idempotency_key),
    CONSTRAINT CK_Albero_Inventory_Review_status CHECK (status IN (N'in_review', N'restored', N'removed')),
    CONSTRAINT CK_Albero_Inventory_Review_reason CHECK (reason_code IN (N'damaged', N'repair', N'inventory-check', N'other')),
    CONSTRAINT CK_Albero_Inventory_Review_quantity CHECK (quantity > 0)
  );
END;
GO

IF COL_LENGTH(N'dbo.Albero_Inventory_Review', N'product_name') IS NULL
  ALTER TABLE dbo.Albero_Inventory_Review ADD product_name nvarchar(300) NULL;
IF COL_LENGTH(N'dbo.Albero_Inventory_Review', N'product_brand') IS NULL
  ALTER TABLE dbo.Albero_Inventory_Review ADD product_brand nvarchar(200) NULL;
IF COL_LENGTH(N'dbo.Albero_Inventory_Review', N'product_image') IS NULL
  ALTER TABLE dbo.Albero_Inventory_Review ADD product_image nvarchar(2000) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.Albero_Inventory_Review')
    AND name = N'IX_Albero_Inventory_Review_status_created'
)
BEGIN
  CREATE INDEX IX_Albero_Inventory_Review_status_created
    ON dbo.Albero_Inventory_Review(status, created_at DESC);
END;
GO

CREATE OR ALTER PROCEDURE dbo.Albero_Move_Inventory_Review
  @operation varchar(12),
  @reviewId uniqueidentifier = NULL,
  @idempotencyKey nvarchar(120) = NULL,
  @productId nvarchar(80) = NULL,
  @productName nvarchar(300) = NULL,
  @productBrand nvarchar(200) = NULL,
  @productImage nvarchar(2000) = NULL,
  @modelId int = NULL,
  @sku nvarchar(180) = NULL,
  @sizeLabel nvarchar(50) = NULL,
  @quantity int = NULL,
  @sourceStoreId int = NULL,
  @reasonCode nvarchar(40) = NULL,
  @notes nvarchar(1000) = NULL,
  @actor nvarchar(120),
  @reviewLocationName nvarchar(250),
  @storeScope nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

  DECLARE @normalizedOperation varchar(12) = LOWER(LTRIM(RTRIM(@operation)));
  DECLARE @now datetime2(3) = SYSUTCDATETIME();
  DECLARE @today date = CONVERT(date, @now);
  DECLARE @dbId int = 1001;
  DECLARE @reviewStoreId int;
  DECLARE @defectiveStoreId int;
  DECLARE @destinationStoreId int;
  DECLARE @sourceStoreName nvarchar(250);
  DECLARE @variantId int;
  DECLARE @sizeRowId int;
  DECLARE @seasonId int;
  DECLARE @sourceHeaderId int;
  DECLARE @destinationHeaderId int;
  DECLARE @sourceMovementId int;
  DECLARE @destinationMovementId int;
  DECLARE @available int;
  DECLARE @lockResult int;

  IF @normalizedOperation NOT IN ('place', 'restore', 'remove')
    THROW 51000, 'INVENTORY_REVIEW_INVALID_OPERATION', 1;

  IF NULLIF(LTRIM(RTRIM(@reviewLocationName)), N'') IS NULL
    THROW 51000, 'INVENTORY_REVIEW_LOCATION_NOT_CONFIGURED', 1;

  IF (SELECT COUNT(*) FROM dbo.Negozi WHERE NE_DES = @reviewLocationName AND ISNULL(NE_CANCELLATO, 0) = 0) <> 1
    THROW 51000, 'INVENTORY_REVIEW_LOCATION_NOT_CONFIGURED', 1;

  IF (SELECT COUNT(*) FROM dbo.Negozi WHERE NE_DES = N'xResi Difettosi' AND ISNULL(NE_CANCELLATO, 0) = 0) <> 1
    THROW 51000, 'INVENTORY_REVIEW_DEFECTIVE_LOCATION_NOT_CONFIGURED', 1;

  IF NOT EXISTS (SELECT 1 FROM dbo.Causali WHERE CA_ID = 13 AND CA_ESI = -1 AND CA_TRU = 1)
     OR NOT EXISTS (SELECT 1 FROM dbo.Causali WHERE CA_ID = 12 AND CA_ESI = 1 AND CA_TRE = 1)
    THROW 51000, 'INVENTORY_REVIEW_TRANSFER_CAUSES_NOT_CONFIGURED', 1;

  SELECT @reviewStoreId = NE_ID FROM dbo.Negozi WHERE NE_DES = @reviewLocationName AND ISNULL(NE_CANCELLATO, 0) = 0;
  SELECT @defectiveStoreId = NE_ID FROM dbo.Negozi WHERE NE_DES = N'xResi Difettosi' AND ISNULL(NE_CANCELLATO, 0) = 0;

  BEGIN TRANSACTION;
  EXEC @lockResult = sys.sp_getapplock
    @Resource = N'Albero_Inventory_Review_Ledger_1001',
    @LockMode = N'Exclusive',
    @LockOwner = N'Transaction',
    @LockTimeout = 15000;
  IF @lockResult < 0 THROW 51000, 'INVENTORY_REVIEW_LOCK_TIMEOUT', 1;

  IF @normalizedOperation = 'place'
  BEGIN
    IF @idempotencyKey IS NULL OR LTRIM(RTRIM(@idempotencyKey)) = N''
      THROW 51000, 'INVENTORY_REVIEW_IDEMPOTENCY_REQUIRED', 1;

    IF EXISTS (SELECT 1 FROM dbo.Albero_Inventory_Review WHERE idempotency_key = @idempotencyKey)
    BEGIN
      COMMIT TRANSACTION;
      SELECT * FROM dbo.Albero_Inventory_Review WHERE idempotency_key = @idempotencyKey;
      RETURN;
    END;

    IF @quantity IS NULL OR @quantity < 1
      THROW 51000, 'INVENTORY_REVIEW_INVALID_QUANTITY', 1;
    IF @reasonCode NOT IN (N'damaged', N'repair', N'inventory-check', N'other')
      THROW 51000, 'INVENTORY_REVIEW_INVALID_REASON', 1;
    IF @reasonCode = N'other' AND NULLIF(LTRIM(RTRIM(@notes)), N'') IS NULL
      THROW 51000, 'INVENTORY_REVIEW_NOTES_REQUIRED', 1;

    SELECT @sourceStoreName = NE_DES
    FROM dbo.Negozi
    WHERE NE_ID = @sourceStoreId AND ISNULL(NE_CANCELLATO, 0) = 0;

    IF @sourceStoreName IS NULL OR NOT EXISTS (
      SELECT 1 FROM STRING_SPLIT(@storeScope, N',')
      WHERE UPPER(LTRIM(RTRIM(value))) = UPPER(LTRIM(RTRIM(@sourceStoreName)))
    )
      THROW 51000, 'INVENTORY_REVIEW_SOURCE_STORE_NOT_ALLOWED', 1;

    SET @destinationStoreId = @reviewStoreId;
    SET @reviewId = NEWID();
  END
  ELSE
  BEGIN
    SELECT
      @productId = product_id,
      @variantId = variant_id,
      @sku = sku,
      @sizeLabel = size_label,
      @sizeRowId = size_row_id,
      @quantity = quantity,
      @sourceStoreId = source_store_id,
      @sourceStoreName = source_store_name,
      @reasonCode = reason_code,
      @notes = notes
    FROM dbo.Albero_Inventory_Review WITH (UPDLOCK, HOLDLOCK)
    WHERE id = @reviewId;

    IF @variantId IS NULL THROW 51001, 'INVENTORY_REVIEW_NOT_FOUND', 1;

    IF EXISTS (
      SELECT 1 FROM dbo.Albero_Inventory_Review
      WHERE id = @reviewId AND status = CASE @normalizedOperation WHEN 'restore' THEN N'restored' ELSE N'removed' END
    )
    BEGIN
      COMMIT TRANSACTION;
      SELECT * FROM dbo.Albero_Inventory_Review WHERE id = @reviewId;
      RETURN;
    END;

    IF NOT EXISTS (SELECT 1 FROM dbo.Albero_Inventory_Review WHERE id = @reviewId AND status = N'in_review')
      THROW 51002, 'INVENTORY_REVIEW_STATE_CONFLICT', 1;

    SET @destinationStoreId = CASE @normalizedOperation WHEN 'restore' THEN @sourceStoreId ELSE @defectiveStoreId END;
    SET @sourceStoreId = @reviewStoreId;
  END;

  IF @variantId IS NULL
  BEGIN
    SELECT TOP 1
      @variantId = VA_ID,
      @seasonId = ST_ID
    FROM dbo.Articoli
    WHERE MD_ID = @modelId
      AND UPPER(LTRIM(RTRIM(MD_CODICE)) + LTRIM(RTRIM(VA_CODICE))) = UPPER(LTRIM(RTRIM(@sku)));
  END
  ELSE
    SELECT @seasonId = ST_ID FROM dbo.Articoli WHERE VA_ID = @variantId;

  IF @variantId IS NULL THROW 51000, 'INVENTORY_REVIEW_VARIANT_NOT_FOUND', 1;

  IF @sizeRowId IS NULL
  BEGIN
    SELECT TOP 1 @sizeRowId = b.BI_TR_ID
    FROM dbo.Barcode b
    INNER JOIN dbo.Taglie_righe tr ON tr.TR_ID = b.BI_TR_ID
    WHERE b.BI_VA_ID = @variantId
      AND UPPER(LTRIM(RTRIM(tr.TR_DES))) = UPPER(LTRIM(RTRIM(@sizeLabel)))
      AND ISNULL(b.BI_CANCELLATO, 0) = 0
    ORDER BY b.BI_ID_DB DESC;
  END;
  IF @sizeRowId IS NULL THROW 51000, 'INVENTORY_REVIEW_SIZE_NOT_FOUND', 1;

  SELECT @available = CAST(SUM(ISNULL(r.ESI_ETICHETTE, 0)) AS int)
  FROM dbo.BARCODE_ESISTENZA_RFID r
  INNER JOIN dbo.Articoli a
    ON LTRIM(RTRIM(r.BRAND)) = LTRIM(RTRIM(a.TI_DES))
   AND LTRIM(RTRIM(r.SIGLA_STAGIONE)) = LTRIM(RTRIM(a.ST_SIGLA))
   AND LTRIM(RTRIM(r.CODICE_MODELLO)) = LTRIM(RTRIM(a.MD_CODICE))
   AND LTRIM(RTRIM(r.CODICE_VARIANTE)) = LTRIM(RTRIM(a.VA_CODICE))
  INNER JOIN dbo.Negozi n ON UPPER(LTRIM(RTRIM(n.NE_DES))) = UPPER(LTRIM(RTRIM(r.NE_DES)))
  WHERE a.VA_ID = @variantId
    AND n.NE_ID = @sourceStoreId
    AND UPPER(LTRIM(RTRIM(r.TAGLIA))) = UPPER(LTRIM(RTRIM(@sizeLabel)));

  IF ISNULL(@available, 0) < @quantity
    THROW 51003, 'INVENTORY_REVIEW_INSUFFICIENT_STOCK', 1;

  DECLARE
    @collaboratorId int = 0,
    @sizeOrder smallint = 0,
    @currency char(3) = 'EUR',
    @exchange float = 1,
    @vatPercent float = -22,
    @movementType smallint = 0,
    @priceList varchar(10) = '',
    @basePrice float = 0,
    @netPrice float = 0,
    @vatCodeId int = 3,
    @discount1 float = 0,
    @discount2 float = 0;

  SELECT TOP 1
    @collaboratorId = ISNULL(m.MM_ID_COLLABORATORI, 0),
    @sizeOrder = ISNULL(m.MM_ORDINE_TAGLIA, 0),
    @currency = ISNULL(m.MM_SIMBOLO_VALUTA, 'EUR'),
    @exchange = ISNULL(m.MM_CAMBIO, 1),
    @vatPercent = ISNULL(m.MM_PERC_IVA, -22),
    @movementType = ISNULL(m.MM_TIPO, 0),
    @priceList = ISNULL(m.MM_LISTINO, ''),
    @basePrice = ISNULL(m.MM_PREZZO_BASE, 0),
    @netPrice = ISNULL(m.MM_PREZZO_NETTO, ISNULL(m.MM_PREZZO_BASE, 0)),
    @vatCodeId = ISNULL(m.MM_ID_CODICI_IVA, 3),
    @discount1 = ISNULL(m.MM_SCONTO1, 0),
    @discount2 = ISNULL(m.MM_SCONTO2, 0)
  FROM dbo.Movimenti m
  INNER JOIN dbo.Testate t ON t.TE_ID_ANALYSIS = m.MM_ID_TESTATE
  WHERE m.MM_ID_ARTICOLI = @variantId
    AND m.MM_ID_TAGLIE_RIGHE = @sizeRowId
    AND ISNULL(m.MM_CANCELLATO, 0) = 0
  ORDER BY t.TE_DATA DESC, m.MM_ID_ANALYSIS DESC;

  SET @sourceHeaderId = dbo.atw_NewidTestate(-1, @dbId);
  SET @destinationHeaderId = @sourceHeaderId + 1;
  SET @sourceMovementId = dbo.atw_NewidMovimenti(-1, @dbId);
  SET @destinationMovementId = @sourceMovementId + 1;

  INSERT dbo.Testate (
    TE_ID_ANALYSIS, TE_GUID, TE_ID_DB, TE_ID_CAUSALI, TE_ID_STAGIONI,
    TE_ID_NEGOZI, TE_ID_NEGOZI2, TE_ID_TRASFERIMENTI, TE_ID_TEMPO,
    TE_NDOC, TE_DATA, TE_DATA_EVA, TE_CANCELLATO, TE_NOTE
  ) VALUES (
    @sourceHeaderId, NEWID(), @dbId, 13, @seasonId,
    @sourceStoreId, @destinationStoreId, @destinationHeaderId,
    (SELECT TOP 1 TM_ID FROM dbo.Tempo WHERE TM_DATA = @today),
    '', @today, @now, 0, CONCAT('Albero In revisione ', CONVERT(nvarchar(36), @reviewId))
  );

  INSERT dbo.Testate (
    TE_ID_ANALYSIS, TE_GUID, TE_ID_DB, TE_ID_CAUSALI, TE_ID_STAGIONI,
    TE_ID_NEGOZI, TE_ID_NEGOZI2, TE_ID_TRASFERIMENTI, TE_ID_TEMPO,
    TE_NDOC, TE_DATA, TE_DATA_EVA, TE_CANCELLATO, TE_NOTE
  ) VALUES (
    @destinationHeaderId, NEWID(), @dbId, 12, @seasonId,
    @destinationStoreId, @sourceStoreId, @destinationHeaderId,
    (SELECT TOP 1 TM_ID FROM dbo.Tempo WHERE TM_DATA = @today),
    '', @today, @now, 0, CONCAT('Albero In revisione ', CONVERT(nvarchar(36), @reviewId))
  );

  INSERT dbo.Movimenti (
    MM_ID_ANALYSIS, MM_GUID, MM_ID_DB, MM_ID_TESTATE, MM_ID_COLLABORATORI,
    MM_ID_ARTICOLI, MM_ID_TAGLIE_RIGHE, MM_TAGLIA, MM_ORDINE_TAGLIA,
    MM_SIMBOLO_VALUTA, MM_CAMBIO, MM_PERC_IVA, MM_TIPO, MM_LISTINO,
    MM_QTA, MM_PREZZO_BASE, MM_PREZZO_NETTO, MM_NOTE, MM_CANCELLATO,
    MM_SCONTO1, MM_SCONTO2, MM_ID_CODICI_IVA, MM_ID_TRA
  ) VALUES (
    @sourceMovementId, NEWID(), @dbId, @sourceHeaderId, @collaboratorId,
    @variantId, @sizeRowId, @sizeLabel, @sizeOrder,
    @currency, @exchange, @vatPercent, @movementType, @priceList,
    @quantity, @basePrice, @netPrice, '', 0,
    @discount1, @discount2, @vatCodeId, @sourceMovementId
  );

  INSERT dbo.Movimenti (
    MM_ID_ANALYSIS, MM_GUID, MM_ID_DB, MM_ID_TESTATE, MM_ID_COLLABORATORI,
    MM_ID_ARTICOLI, MM_ID_TAGLIE_RIGHE, MM_TAGLIA, MM_ORDINE_TAGLIA,
    MM_SIMBOLO_VALUTA, MM_CAMBIO, MM_PERC_IVA, MM_TIPO, MM_LISTINO,
    MM_QTA, MM_PREZZO_BASE, MM_PREZZO_NETTO, MM_NOTE, MM_CANCELLATO,
    MM_SCONTO1, MM_SCONTO2, MM_ID_CODICI_IVA, MM_ID_TRA
  ) VALUES (
    @destinationMovementId, NEWID(), @dbId, @destinationHeaderId, @collaboratorId,
    @variantId, @sizeRowId, @sizeLabel, @sizeOrder,
    @currency, @exchange, @vatPercent, @movementType, @priceList,
    @quantity, @basePrice, @netPrice, '', 0,
    @discount1, @discount2, @vatCodeId, @sourceMovementId
  );

  IF @normalizedOperation = 'place'
  BEGIN
    INSERT dbo.Albero_Inventory_Review (
      id, idempotency_key, product_id, product_name, product_brand, product_image, variant_id, sku, size_label, size_row_id,
      quantity, source_store_id, source_store_name, reason_code, notes, status,
      created_by, created_at, source_header_id, destination_header_id
    ) VALUES (
      @reviewId, @idempotencyKey, @productId, @productName, @productBrand, @productImage, @variantId, UPPER(@sku), @sizeLabel, @sizeRowId,
      @quantity, @sourceStoreId, @sourceStoreName, @reasonCode, @notes, N'in_review',
      @actor, @now, @sourceHeaderId, @destinationHeaderId
    );
  END
  ELSE
  BEGIN
    UPDATE dbo.Albero_Inventory_Review
    SET status = CASE @normalizedOperation WHEN 'restore' THEN N'restored' ELSE N'removed' END,
        resolved_by = @actor,
        resolved_at = @now,
        resolution_source_header_id = @sourceHeaderId,
        resolution_destination_header_id = @destinationHeaderId
    WHERE id = @reviewId;
  END;

  DELETE FROM dbo.Albero_Stock_Cache
  WHERE VA_ID = @variantId
    AND size_label = @sizeLabel
    AND ((@storeScope IS NULL AND store_scope IS NULL) OR store_scope = @storeScope);

  INSERT dbo.Albero_Stock_Cache (
    VA_ID, size_label, qty, source_last_movement_at, store_scope, refreshed_at
  )
  SELECT
    @variantId,
    @sizeLabel,
    CAST(SUM(ISNULL(r.ESI_ETICHETTE, 0)) AS decimal(18,4)),
    @now,
    @storeScope,
    @now
  FROM dbo.BARCODE_ESISTENZA_RFID r
  INNER JOIN dbo.Articoli a
    ON LTRIM(RTRIM(r.BRAND)) = LTRIM(RTRIM(a.TI_DES))
   AND LTRIM(RTRIM(r.SIGLA_STAGIONE)) = LTRIM(RTRIM(a.ST_SIGLA))
   AND LTRIM(RTRIM(r.CODICE_MODELLO)) = LTRIM(RTRIM(a.MD_CODICE))
   AND LTRIM(RTRIM(r.CODICE_VARIANTE)) = LTRIM(RTRIM(a.VA_CODICE))
  WHERE a.VA_ID = @variantId
    AND UPPER(LTRIM(RTRIM(r.TAGLIA))) = UPPER(LTRIM(RTRIM(@sizeLabel)))
    AND (@storeScope IS NULL OR EXISTS (
      SELECT 1 FROM STRING_SPLIT(@storeScope, N',') s
      WHERE UPPER(LTRIM(RTRIM(s.value))) = UPPER(LTRIM(RTRIM(r.NE_DES)))
    ))
  HAVING SUM(ISNULL(r.ESI_ETICHETTE, 0)) > 0;

  COMMIT TRANSACTION;
  SELECT * FROM dbo.Albero_Inventory_Review WHERE id = @reviewId;
END;
GO

-- Create the writer principal separately, then grant only:
-- GRANT EXECUTE ON dbo.Albero_Move_Inventory_Review TO [your_inventory_writer_user];
-- The normal read/runtime login needs:
-- GRANT SELECT ON dbo.Albero_Inventory_Review TO [your_api_user];
