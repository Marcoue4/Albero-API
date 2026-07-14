IF OBJECT_ID(N'dbo.Albero_Stock_Cache', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Albero_Stock_Cache (
    VA_ID int NOT NULL,
    size_label nvarchar(50) NOT NULL,
    qty decimal(18, 4) NOT NULL,
    source_last_movement_at datetime NULL,
    store_scope nvarchar(max) NULL,
    refreshed_at datetime2(0) NOT NULL,
    CONSTRAINT PK_Albero_Stock_Cache PRIMARY KEY CLUSTERED (VA_ID, size_label)
  );
END;
GO

IF COL_LENGTH(N'dbo.Albero_Stock_Cache', N'store_scope') IS NULL
BEGIN
  ALTER TABLE dbo.Albero_Stock_Cache
    ADD store_scope nvarchar(max) NULL;
END;
GO

IF OBJECT_ID(N'dbo.Albero_Stock_Cache_Refresh_Log', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Albero_Stock_Cache_Refresh_Log (
    id bigint IDENTITY(1, 1) NOT NULL,
    started_at datetime2(0) NOT NULL,
    finished_at datetime2(0) NULL,
    rows_refreshed int NULL,
    store_scope nvarchar(max) NULL,
    status varchar(20) NOT NULL,
    error_message nvarchar(4000) NULL,
    CONSTRAINT PK_Albero_Stock_Cache_Refresh_Log PRIMARY KEY CLUSTERED (id)
  );
END;
GO

IF COL_LENGTH(N'dbo.Albero_Stock_Cache_Refresh_Log', N'store_scope') IS NULL
BEGIN
  ALTER TABLE dbo.Albero_Stock_Cache_Refresh_Log
    ADD store_scope nvarchar(max) NULL;
END;
GO

CREATE OR ALTER PROCEDURE dbo.Albero_Refresh_Stock_Cache
  @store_scope nvarchar(max) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @startedAt datetime2(0) = SYSDATETIME();
  DECLARE @refreshedAt datetime2(0) = @startedAt;
  DECLARE @rowsRefreshed int = 0;
  DECLARE @normalizedStoreScope nvarchar(max) = NULLIF(LTRIM(RTRIM(@store_scope)), N'');
  DECLARE @stageRows int = 0;
  DECLARE @progressMessage nvarchar(2048);

  BEGIN TRY
    RAISERROR(N'Preparing store scope', 10, 1) WITH NOWAIT;

    CREATE TABLE #AllowedStores (
      store_name nvarchar(4000) NOT NULL
    );

    IF @normalizedStoreScope IS NOT NULL
    BEGIN
      INSERT INTO #AllowedStores (store_name)
      SELECT DISTINCT
        UPPER(LTRIM(RTRIM(value))) AS store_name
      FROM STRING_SPLIT(@normalizedStoreScope, N',')
      WHERE LTRIM(RTRIM(value)) <> N'';

      IF NOT EXISTS (SELECT 1 FROM #AllowedStores)
      BEGIN
        SET @normalizedStoreScope = NULL;
      END;
    END;

    SELECT
      n.NE_ID
    INTO #AllowedStoreIds
    FROM dbo.Negozi n WITH (NOLOCK)
    WHERE @normalizedStoreScope IS NULL
       OR EXISTS (
            SELECT 1
            FROM #AllowedStores s
            WHERE s.store_name = UPPER(LTRIM(RTRIM(n.NE_DES)))
          );

    SET @stageRows = @@ROWCOUNT;

    CREATE UNIQUE CLUSTERED INDEX IX_AllowedStoreIds
      ON #AllowedStoreIds (NE_ID);

    SET @progressMessage = CONCAT(N'Store scope prepared: ', @stageRows, N' matching stores');
    RAISERROR(@progressMessage, 10, 1) WITH NOWAIT;

    SELECT DISTINCT
      VA_ID
    INTO #ActiveVariants
    FROM dbo.Articoli_Su_Sito_Plus
    WHERE CANCELLATO = 0;

    SET @stageRows = @@ROWCOUNT;

    CREATE UNIQUE CLUSTERED INDEX IX_ActiveVariants
      ON #ActiveVariants (VA_ID);

    SET @progressMessage = CONCAT(N'Active catalog prepared: ', @stageRows, N' variants');
    RAISERROR(@progressMessage, 10, 1) WITH NOWAIT;

    SELECT
      b.BI_VA_ID,
      b.BI_TR_ID
    INTO #EligibleBarcodes
    FROM dbo.Barcode b WITH (NOLOCK)
    INNER JOIN #ActiveVariants av
      ON av.VA_ID = b.BI_VA_ID
    WHERE LEN(b.BI_BARCODE) = 11
      AND ISNUMERIC(b.BI_BARCODE) = 1
      AND (b.BI_CANCELLATO = 0 OR b.BI_CANCELLATO IS NULL)
    GROUP BY b.BI_VA_ID, b.BI_TR_ID;

    SET @stageRows = @@ROWCOUNT;

    CREATE UNIQUE CLUSTERED INDEX IX_EligibleBarcodes
      ON #EligibleBarcodes (BI_VA_ID, BI_TR_ID);

    SET @progressMessage = CONCAT(N'Eligible barcode pairs prepared: ', @stageRows);
    RAISERROR(@progressMessage, 10, 1) WITH NOWAIT;

    RAISERROR(N'Aggregating stock movements', 10, 1) WITH NOWAIT;

    SELECT
      av.VA_ID,
      CAST(COALESCE(NULLIF(LTRIM(RTRIM(tr.TR_DES)), N''), N'UNI') AS nvarchar(50)) AS size_label,
      CAST(SUM(ISNULL(m.MM_QTA, 0) * ISNULL(c.CA_ESI, 0)) AS decimal(18, 4)) AS qty,
      MAX(t.TE_DATA) AS source_last_movement_at,
      @normalizedStoreScope AS store_scope,
      @refreshedAt AS refreshed_at
    INTO #AlberoStockRefresh
    FROM #ActiveVariants av
    INNER JOIN dbo.Movimenti m WITH (NOLOCK)
      ON m.MM_ID_ARTICOLI = av.VA_ID
     AND m.MM_CANCELLATO = 0
    INNER JOIN #EligibleBarcodes eb
      ON eb.BI_VA_ID = m.MM_ID_ARTICOLI
     AND eb.BI_TR_ID = m.MM_ID_TAGLIE_RIGHE
    INNER JOIN dbo.Testate t WITH (NOLOCK)
      ON t.TE_ID_ANALYSIS = m.MM_ID_TESTATE
    INNER JOIN #AllowedStoreIds asi
      ON asi.NE_ID = t.TE_ID_NEGOZI
    INNER JOIN dbo.Causali c
      ON c.CA_ID = t.TE_ID_CAUSALI
    INNER JOIN dbo.Taglie_righe tr WITH (NOLOCK)
      ON tr.TR_ID = m.MM_ID_TAGLIE_RIGHE
    GROUP BY av.VA_ID, COALESCE(NULLIF(LTRIM(RTRIM(tr.TR_DES)), N''), N'UNI')
    HAVING SUM(ISNULL(m.MM_QTA, 0) * ISNULL(c.CA_ESI, 0)) > 0
    OPTION (RECOMPILE);

    SET @rowsRefreshed = @@ROWCOUNT;
    SET @progressMessage = CONCAT(N'Stock aggregation complete: ', @rowsRefreshed, N' cache rows');
    RAISERROR(@progressMessage, 10, 1) WITH NOWAIT;

    RAISERROR(N'Replacing cached stock rows', 10, 1) WITH NOWAIT;

    BEGIN TRANSACTION;

    DELETE FROM dbo.Albero_Stock_Cache;

    INSERT INTO dbo.Albero_Stock_Cache (
      VA_ID,
      size_label,
      qty,
      source_last_movement_at,
      store_scope,
      refreshed_at
    )
    SELECT
      VA_ID,
      size_label,
      qty,
      source_last_movement_at,
      store_scope,
      refreshed_at
    FROM #AlberoStockRefresh;

    COMMIT TRANSACTION;

    RAISERROR(N'Cache rows committed', 10, 1) WITH NOWAIT;

    INSERT INTO dbo.Albero_Stock_Cache_Refresh_Log (
      started_at,
      finished_at,
      rows_refreshed,
      store_scope,
      status
    )
    VALUES (
      @startedAt,
      SYSDATETIME(),
      @rowsRefreshed,
      @normalizedStoreScope,
      'success'
    );

    SELECT
      @rowsRefreshed AS rows_refreshed,
      @refreshedAt AS refreshed_at;
  END TRY
  BEGIN CATCH
    IF XACT_STATE() <> 0
    BEGIN
      ROLLBACK TRANSACTION;
    END;

    INSERT INTO dbo.Albero_Stock_Cache_Refresh_Log (
      started_at,
      finished_at,
      rows_refreshed,
      store_scope,
      status,
      error_message
    )
    VALUES (
      @startedAt,
      SYSDATETIME(),
      NULL,
      @normalizedStoreScope,
      'failed',
      ERROR_MESSAGE()
    );

    THROW;
  END CATCH;
END;
GO

-- Optional grants for the API SQL login, run by a DBA after replacing the user name:
-- GRANT SELECT ON dbo.Albero_Stock_Cache TO [your_api_user];
-- GRANT INSERT, UPDATE, DELETE ON dbo.Albero_Stock_Cache TO [your_api_user];
-- GRANT INSERT ON dbo.Albero_Stock_Cache_Refresh_Log TO [your_api_user];
-- GRANT EXECUTE ON dbo.Albero_Refresh_Stock_Cache TO [your_api_user];
