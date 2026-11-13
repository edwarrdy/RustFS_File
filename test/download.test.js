const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { Readable } = require("node:stream");
const { inflateRawSync } = require("node:zlib");
const express = require("express");

function loadModule(relativePath, mocks) {
  const filename = path.resolve(__dirname, "..", relativePath);
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  vm.compileFunction(fs.readFileSync(filename, "utf8"), ["require", "module", "exports", "console"], { filename })(
    id => Object.hasOwn(mocks, id) ? mocks[id] : nativeRequire(id),
    module, module.exports, { ...console, error() {} },
  );
  return module.exports;
}

function fixture(readObject = file => Readable.from([`contents:${file.Key}`])) {
  const files = [
    { id: 1, uuidName: "one.txt", originalName: "中文 文件.txt", bucket: "recorded-bucket", folderUuid: "root" },
    { id: 2, uuidName: "two.txt", originalName: "nested.txt", bucket: "other-bucket", folderUuid: "folder" },
    { id: 3, uuidName: "three.txt", originalName: "deep.txt", bucket: "other-bucket", folderUuid: "child" },
  ];
  const folders = [
    { uuid: "folder", displayName: "资料", parentId: null },
    { uuid: "child", displayName: "子目录", parentId: "folder" },
  ];
  const requests = [];
  const service = loadModule("src/services/fileService.js", {
    "../config/db": {
      prepare(sql) {
        return {
          get(id) { return (sql.includes("FROM files") ? files : folders).find(row => row.id === id || row.uuid === id); },
          all(id) { return sql.includes("FROM files") ? files.filter(file => file.folderUuid === id) : folders.filter(folder => folder.parentId === id); },
        };
      },
    },
    "../config/s3": {
      BUCKET_NAME: "default-bucket",
      publicS3Client: {},
      s3Client: {
        async send(command, options) {
          if (command.constructor.name === "CreateBucketCommand") return {};
          requests.push({ ...command.input, type: command.constructor.name, signal: options?.abortSignal });
          return { Body: await readObject(command.input, options?.abortSignal) };
        },
      },
    },
    "@aws-sdk/s3-request-presigner": {
      getSignedUrl: async (client, command) => `https://storage.invalid/${command.input.Bucket}/${command.input.Key}`,
    },
  });
  const controller = loadModule("src/controllers/fileController.js", { "../services/fileService": service });
  const routes = loadModule("src/routes/fileRoutes.js", { "../controllers/fileController": controller });
  return { service, requests, routes };
}

async function withServer(fixture, action) {
  const app = express();
  app.use("/files", fixture.routes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    await action(`http://127.0.0.1:${server.address().port}/files`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function batchUrl(base, fileIds = [1], folderUuuids = []) {
  return `${base}/batch-download?${new URLSearchParams({ fileIds: JSON.stringify(fileIds), folderUuuids: JSON.stringify(folderUuuids) })}`;
}

// Read the central directory and extract each entry to verify names and data.
function unzip(buffer) {
  const eocd = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(eocd), 0x06054b50);
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const compression = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString();
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const data = buffer.subarray(start, start + size);
    entries[name] = (compression === 8 ? inflateRawSync(data) : data).toString();
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test("selected files and nested folders produce a valid ZIP using each recorded bucket", async () => {
  const f = fixture();
  await withServer(f, async base => {
    const res = await fetch(batchUrl(base, [1], ["folder"]));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "application/zip");
    assert.match(res.headers.get("Content-Disposition"), /attachment/);
    assert.deepEqual(unzip(Buffer.from(await res.arrayBuffer())), {
      "中文 文件.txt": "contents:one.txt",
      "资料/nested.txt": "contents:two.txt",
      "资料/子目录/deep.txt": "contents:three.txt",
    });
    assert.deepEqual(f.requests.map(({ Bucket, Key }) => [Bucket, Key]), [
      ["recorded-bucket", "one.txt"], ["other-bucket", "two.txt"], ["other-bucket", "three.txt"],
    ]);
  });
});

test("folder ZIP preserves nested paths and its Chinese download name", async () => {
  await withServer(fixture(), async base => {
    const res = await fetch(`${base}/folders/download/folder`);
    assert.match(res.headers.get("Content-Disposition"), new RegExp(encodeURIComponent("资料.zip")));
    assert.deepEqual(unzip(Buffer.from(await res.arrayBuffer())), {
      "nested.txt": "contents:two.txt", "子目录/deep.txt": "contents:three.txt",
    });
  });
});

test("NoSuchBucket returns a JSON error instead of an empty successful ZIP", async () => {
  const f = fixture(() => { throw Object.assign(new Error("missing bucket"), { name: "NoSuchBucket" }); });
  await withServer(f, async base => {
    for (const url of [batchUrl(base), `${base}/folders/download/folder`]) {
      const res = await fetch(url);
      assert.equal(res.status, 502);
      assert.match(res.headers.get("Content-Type"), /json/);
      assert.equal(res.headers.get("Content-Disposition"), null);
      assert.match((await res.json()).error, /存储桶不存在/);
    }
  });
});

test("missing records and missing objects return 404", async () => {
  await withServer(fixture(), async base => {
    for (const url of [batchUrl(base, [999]), batchUrl(base, [], ["missing"]), `${base}/folders/download/missing`]) {
      const res = await fetch(url);
      assert.equal(res.status, 404);
      await res.json();
    }
  });
  await withServer(fixture(() => { throw Object.assign(new Error("missing object"), { name: "NoSuchKey" }); }), async base => {
    const res = await fetch(batchUrl(base));
    assert.equal(res.status, 404);
    await res.json();
  });
});

test("invalid or empty selections return 400 without fetching storage", async () => {
  const f = fixture();
  await withServer(f, async base => {
    for (const query of ["", "fileIds=invalid", "fileIds=null", "fileIds={}", "fileIds=[0]", 'fileIds=["1"]', 'folderUuuids=[null]']) {
      const res = await fetch(`${base}/batch-download?${query}`);
      assert.equal(res.status, 400, query);
      await res.json();
    }
    assert.equal(f.requests.length, 0);
  });
});

test("single-file links are generated only after checking the stored bucket and object", async () => {
  const f = fixture();
  await withServer(f, async base => {
    const res = await fetch(`${base}/presigned/download/1`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).url, "https://storage.invalid/recorded-bucket/one.txt");
    assert.equal(f.requests[0].type, "HeadObjectCommand");
    assert.equal(f.requests[0].Bucket, "recorded-bucket");
    assert.equal(f.requests[0].Key, "one.txt");
  });
});

test("a missing bucket, missing object or inaccessible storage never returns a signed link", async () => {
  for (const [name, status] of [["NoSuchBucket", 502], ["NotFound", 404], ["AccessDenied", 502]]) {
    await withServer(fixture(() => { throw Object.assign(new Error(name), { name }); }), async base => {
      const res = await fetch(`${base}/presigned/download/1`);
      assert.equal(res.status, status);
      const body = await res.json();
      assert.equal(body.url, undefined);
      assert.ok(body.error);
    });
  }
});

test("an object stream failure ends the request instead of hanging or crashing", async () => {
  await withServer(fixture(() => new Readable({ read() { this.destroy(new Error("source disconnected")); } })), async base => {
    // A ZIP header may already have been sent; either way the transfer must fail.
    await assert.rejects(async () => {
      const res = await fetch(batchUrl(base), { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error((await res.json()).error);
      await res.arrayBuffer();
    });
  });
});

test("failure after the first entry aborts the ZIP rather than silently omitting a file", async () => {
  await withServer(fixture(input => {
    if (input.Key === "two.txt") throw Object.assign(new Error("missing bucket"), { name: "NoSuchBucket" });
    return Readable.from(["first entry"]);
  }), async base => {
    await assert.rejects(async () => {
      const res = await fetch(batchUrl(base, [1, 2]), { signal: AbortSignal.timeout(3000) });
      await res.arrayBuffer();
    });
  });
});

test("disconnecting a download aborts the S3 request signal and destroys the active source", async () => {
  let source;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const f = fixture(() => {
    source = new Readable({ read() {} });
    started();
    return source;
  });
  await withServer(f, async base => {
    const controller = new AbortController();
    const request = fetch(batchUrl(base), { signal: controller.signal });
    await ready;
    const aborted = new Promise(resolve => f.requests[0].signal.addEventListener("abort", resolve, { once: true }));
    controller.abort();
    await assert.rejects(request);
    await aborted;
    assert.equal(f.requests[0].signal.aborted, true);
    assert.equal(source.destroyed, true);
  });
});

function pageFixture(fetchImpl, selected = []) {
  const events = [];
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('      loadContent("root");', "");
  const context = vm.createContext({
    fetch: fetchImpl, URLSearchParams,
    URL: { createObjectURL() { events.push("blob"); return "blob:test"; }, revokeObjectURL() {} },
    setTimeout() {},
    window: { location: { protocol: "http:", hostname: "localhost" }, addEventListener() {}, open(url) { events.push(["open", url]); } },
    document: {
      getElementById() { return {}; },
      querySelectorAll() { return selected; },
      body: { appendChild() {} },
      createElement() { return { click() { events.push(["save", this.download]); }, remove() {} }; },
    },
    record: event => events.push(event),
  });
  vm.runInContext(script, context);
  vm.runInContext(`
    createTaskItem = () => "task";
    updateTaskProgress = (...args) => record(["progress", ...args]);
    completeTask = (...args) => record(["complete", ...args]);
    log = (...args) => record(["log", ...args]);
    unselectAll = () => record("unselect");
  `, context);
  return { context, events };
}

test("selected download encodes parameters and waits for the whole ZIP before succeeding", async () => {
  let release;
  let requestedUrl;
  const pending = new Promise(resolve => { release = resolve; });
  const f = pageFixture(async url => {
    requestedUrl = url;
    return {
      ok: true, status: 200,
      headers: new Headers({ "Content-Type": "application/zip", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("选中资料.zip")}` }),
      blob: () => pending,
    };
  }, [{ dataset: { type: "file", id: "1" } }, { dataset: { type: "folder", uuid: "a&b" } }]);
  const downloading = vm.runInContext("batchDownload()", f.context);
  await Promise.resolve();
  assert.equal(f.events.some(event => event[0] === "complete"), false);
  const query = new URL(requestedUrl).searchParams;
  assert.equal(query.get("fileIds"), "[1]");
  assert.equal(query.get("folderUuuids"), '["a&b"]');
  release(new Blob(["zip"]));
  await downloading;
  assert.deepEqual(f.events.find(event => event[0] === "save"), ["save", "选中资料.zip"]);
  assert.equal(f.events.find(event => event[0] === "complete")[2], true);
  assert.ok(f.events.includes("unselect"));
});

test("XML errors, JSON errors, wrong endpoints and interrupted bodies never save a ZIP or clear selections", async () => {
  const responses = [
    new Response("<Error><Code>NoSuchBucket</Code></Error>", { status: 404, headers: { "Content-Type": "application/xml" } }),
    new Response(JSON.stringify({ error: "存储桶不存在" }), { status: 502, headers: { "Content-Type": "application/json" } }),
    new Response("<html>Wrong endpoint</html>", { headers: { "Content-Type": "text/html" } }),
    { ok: true, headers: new Headers({ "Content-Type": "application/zip" }), blob: async () => { throw new Error("connection reset"); } },
  ];
  for (const response of responses) {
    const f = pageFixture(async () => response, [{ dataset: { type: "file", id: "1" } }]);
    await vm.runInContext("batchDownload()", f.context);
    assert.equal(f.events.some(event => event[0] === "save"), false);
    assert.equal(f.events.find(event => event[0] === "complete")[2], false);
    assert.equal(f.events.includes("unselect"), false);
    assert.ok(f.events.some(event => event[0] === "log" && event[2] === "error"));
  }
});

test("supported browsers stream ZIP data to disk without buffering the entire archive", async () => {
  const chunks = [];
  let closed = false;
  const f = pageFixture(async () => new Response("ZIP bytes", { headers: { "Content-Type": "application/zip" } }), [{ dataset: { type: "file", id: "1" } }]);
  f.context.window.showSaveFilePicker = async () => ({
    name: "保存资料.zip",
    createWritable: async () => new WritableStream({
      write(chunk) { chunks.push(Buffer.from(chunk)); },
      close() { closed = true; },
    }),
  });
  await vm.runInContext("batchDownload()", f.context);
  assert.equal(Buffer.concat(chunks).toString(), "ZIP bytes");
  assert.equal(closed, true);
  assert.equal(f.events.includes("blob"), false);
  assert.equal(f.events.find(event => event[0] === "complete")[2], true);
});

test("canceling the save dialog never requests storage or clears selections", async () => {
  let requested = false;
  const f = pageFixture(async () => { requested = true; }, [{ dataset: { type: "file", id: "1" } }]);
  f.context.window.showSaveFilePicker = async () => { throw Object.assign(new Error("cancel"), { name: "AbortError" }); };
  await vm.runInContext("batchDownload()", f.context);
  assert.equal(requested, false);
  assert.equal(f.events.includes("unselect"), false);
  assert.ok(f.events.some(event => event[0] === "progress" && event[3] === "已取消"));
});

test("single-file download displays storage errors instead of opening an invalid link", async () => {
  const f = pageFixture(async () => new Response(JSON.stringify({ error: "存储桶不存在" }), {
    status: 502, headers: { "Content-Type": "application/json" },
  }));
  await vm.runInContext("downloadModeB(1)", f.context);
  assert.equal(f.events.some(event => event[0] === "open"), false);
  assert.ok(f.events.some(event => event[0] === "log" && event[1] === "存储桶不存在"));
});

test("single-file download still opens a valid signed link", async () => {
  const f = pageFixture(async () => new Response(JSON.stringify({ url: "https://storage.invalid/file.zip" }), {
    headers: { "Content-Type": "application/json" },
  }));
  await vm.runInContext("downloadModeB(1)", f.context);
  assert.deepEqual(f.events.find(event => event[0] === "open"), ["open", "https://storage.invalid/file.zip"]);
});
