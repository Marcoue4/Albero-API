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

  BEGIN TRY
    IF OBJECT_ID(N'tempdb..#AllowedStores', N'U') IS NOT NULL
    BEGIN
      DROP TABLE #AllowedStores;
    END;

    IF @normalizedStoreScope IS NOT NULL
    BEGIN
      SELECT DISTINCT
        UPPER(LTRIM(RTRIM(value))) AS store_name
      INTO #AllowedStores
      FROM STRING_SPLIT(@normalizedStoreScope, N',')
      WHERE LTRIM(RTRIM(value)) <> N'';

      IF NOT EXISTS (SELECT 1 FROM #AllowedStores)
      BEGIN
        SET @normalizedStoreScope = NULL;
      END;
    END;

    IF OBJECT_ID(N'tempdb..#AlberoStockRefresh', N'U') IS NOT NULL
    BEGIN
      DROP TABLE #AlberoStockRefresh;
    END;

    SELECT
      av.VA_ID,
      CAST(COALESCE(NULLIF(LTRIM(RTRIM(r.TAGLIA)), N''), N'UNI') AS nvarchar(50)) AS size_label,
      CAST(SUM(ISNULL(r.ESI_ETICHETTE, 0)) AS decimal(18, 4)) AS qty,
      MAX(r.TE_DATA) AS source_last_movement_at,
      @normalizedStoreScope AS store_scope,
      @refreshedAt AS refreshed_at
    INTO #AlberoStockRefresh
    FROM (
      SELECT DISTINCT
        VA_ID,
        LTRIM(RTRIM(TI_DES)) AS brand,
        LTRIM(RTRIM(ST_SIGLA)) AS season,
        LTRIM(RTRIM(MD_CODICE)) AS model_code,
        LTRIM(RTRIM(VA_CODICE)) AS variant_code
      FROM dbo.Articoli_Su_Sito_Plus
      WHERE CANCELLATO = 0
    ) av
    INNER JOIN dbo.BARCODE_ESISTENZA_RFID r
      ON LTRIM(RTRIM(r.BRAND)) = av.brand
     AND LTRIM(RTRIM(r.SIGLA_STAGIONE)) = av.season
     AND LTRIM(RTRIM(r.CODICE_MODELLO)) = av.model_code
     AND LTRIM(RTRIM(r.CODICE_VARIANTE)) = av.variant_code
    WHERE @normalizedStoreScope IS NULL
       OR EXISTS (
            SELECT 1
            FROM #AllowedStores s
            WHERE s.store_name = UPPER(LTRIM(RTRIM(r.NE_DES)))
          )
    GROUP BY av.VA_ID, COALESCE(NULLIF(LTRIM(RTRIM(r.TAGLIA)), N''), N'UNI')
    HAVING SUM(ISNULL(r.ESI_ETICHETTE, 0)) > 0;

    SET @rowsRefreshed = @@ROWCOUNT;

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
