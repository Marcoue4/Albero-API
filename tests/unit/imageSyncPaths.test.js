const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildBlobPathname,
  createSourceKey,
  normalizeSourcePath,
  resolveLocalSourcePath,
} = require("../../src/lib/imageSyncPaths");

test("normalizeSourcePath keeps a stable Windows-style path", () => {
  assert.equal(
    normalizeSourcePath("//SERVER-ATELIER/Foto/261/brand/Test.JPG"),
    "\\\\SERVER-ATELIER\\Foto\\261\\brand\\Test.JPG"
  );
  assert.equal(createSourceKey("\\\\SERVER-ATELIER\\Foto\\A.JPG"), "\\\\server-atelier\\foto\\a.jpg");
});

test("resolveLocalSourcePath rewrites the DB root to the local root", () => {
  const localPath = resolveLocalSourcePath(
    "\\\\SERVER-ATELIER\\Foto\\261\\brand\\Test Image.JPG",
    {
      sourceDbRoot: "\\\\SERVER-ATELIER\\Foto",
      sourceLocalRoot: "D:\\Foto",
    }
  );

  assert.equal(localPath, "D:\\Foto\\261\\brand\\Test Image.JPG");
});

test("buildBlobPathname creates a deterministic sanitized blob path", () => {
  const pathname = buildBlobPathname(
    "\\\\SERVER-ATELIER\\Foto\\261\\ax armani exchange\\XM002694AF22942U6200MAJORBROWN.JPG",
    {
      sourceRoot: "\\\\SERVER-ATELIER\\Foto",
      prefix: "catalog",
    }
  );

  assert.equal(
    pathname,
    "catalog/261/ax-armani-exchange/xm002694af22942u6200majorbrown.jpg"
  );
});
