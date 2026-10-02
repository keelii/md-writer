// Dump font vertical metrics (head/hhea/OS2) from a binary font file
var fs = require("fs")

function readMetrics(path) {
  var buf = fs.readFileSync(path)
  var tag = buf.toString("latin1", 0, 4)
  var numTables, tables
  if (tag === "ttcf") {
    var offset = buf.readUInt32BE(12)
    numTables = buf.readUInt16BE(offset + 4)
    tables = parseDir(buf, offset)
  } else if (tag === "OTTO" || tag === "\x00\x01\x00\x00" || tag === "true") {
    numTables = buf.readUInt16BE(4)
    tables = parseDir(buf, 0)
  } else {
    console.log(path, ": unknown format", JSON.stringify(tag))
    return
  }
  function parseDir(buf, base) {
    var n = buf.readUInt16BE(base + 4)
    var out = {}
    for (var i = 0; i < n; i++) {
      var rec = base + 12 + i * 16
      var name = buf.toString("latin1", rec, rec + 4)
      out[name] = { off: buf.readUInt32BE(rec + 8), len: buf.readUInt32BE(rec + 12) }
    }
    return out
  }
  var res = { file: path.split("/").pop() }
  if (tables["head"]) {
    var h = tables["head"].off
    res.unitsPerEm = buf.readUInt16BE(h + 18)
  }
  if (tables["hhea"]) {
    var ha = tables["hhea"].off
    res.hheaAscent = buf.readInt16BE(ha + 4)
    res.hheaDescent = buf.readInt16BE(ha + 6)
    res.hheaLineGap = buf.readInt16BE(ha + 8)
  }
  if (tables["OS/2"]) {
    var os = tables["OS/2"].off
    res.winAscent = buf.readUInt16BE(os + 74)
    res.winDescent = buf.readUInt16BE(os + 76)
    res.typoAscent = buf.readInt16BE(os + 68)
    res.typoDescent = buf.readInt16BE(os + 70)
    res.typoLineGap = buf.readInt16BE(os + 72)
  }
  var upm = res.unitsPerEm || 1000
  console.log(JSON.stringify(res))
  if (res.hheaAscent !== undefined) {
    console.log("  hhea  A+D =", ((res.hheaAscent - res.hheaDescent) / upm).toFixed(4) + "em",
      " A-D =", ((res.hheaAscent + res.hheaDescent) / upm).toFixed(4) + "em")
  }
}

readMetrics(process.argv[2])